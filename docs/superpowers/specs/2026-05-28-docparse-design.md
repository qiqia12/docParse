# DocParse — 文档结构化解析服务 设计文档

> 日期: 2026-05-28 | 状态: 已确认

## 概述

将 txt、docx、pdf、pptx 等格式的文件解析为结构化 Markdown 的 Web 服务。用户通过浏览器上传文件，实时流式查看解析结果，支持下载/复制 Markdown。

## 技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| Web 前端 | React + TypeScript + Vite | 生态成熟，文件上传/预览组件丰富 |
| API 网关 | Fastify + TypeScript | Node.js 性能最优框架，流式响应原生支持好 |
| 解析引擎 | Python + gRPC | 文档解析库生态最完善（Docling/MarkItDown/pymupdf） |
| 通信协议 | gRPC (protobuf) | 比 JSON 快 5-10 倍，流式传输原生支持，强类型契约 |
| 数据库 | PostgreSQL 16 | 任务元数据、去重索引、JSONB 灵活字段 |
| 缓存/限流 | Redis | 限流计数器 + 可选结果缓存 |
| 部署 | Docker Compose | 单机部署，架构预留 K8s 迁移能力 |

## 架构

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React 前端   │────▶│ Fastify API  │────▶│ Python gRPC     │
│  (Nginx 静态) │     │  (Node.js)   │     │  解析服务        │
│              │◀────│              │◀────│  (Docling+       │
│  上传/预览    │     │  鉴权/调度    │     │   MarkItDown)    │
└──────────────┘     └──────┬───────┘     └─────────────────┘
                            │
                   ┌────────▼───────┐
                   │   PostgreSQL   │
                   │  (任务/文件元数据)│
                   └────────────────┘
```

**三个核心服务**：前端（React + Nginx）、API 网关（Fastify）、解析引擎（Python gRPC）。

**数据流**：用户上传 → Fastify 接收 → 去重检查 → 发起 gRPC 解析 → Python 流式返回逐页 Markdown → Fastify 通过 SSE 推前端 → 前端实时渲染。

## gRPC 协议

```protobuf
syntax = "proto3";

service DocumentParser {
  rpc Parse(ParseRequest) returns (stream ParseChunk);
  rpc GetSupportedFormats(Empty) returns (FormatList);
}

message ParseRequest {
  bytes file_content = 1;
  string filename = 2;
  string task_id = 3;
  ParseOptions options = 4;
}

message ParseOptions {
  bool extract_images = 1;
  bool extract_tables = 2;
  int32 max_pages = 3;
  string output_style = 4;  // "github" | "commonmark" | "raw"
}

message ParseChunk {
  int32 page_number = 1;
  int32 total_pages = 2;
  string markdown = 3;
  repeated ImageInfo images = 4;
  float confidence = 5;      // 0-1，Docling OCR/布局置信度
  bool is_complete = 6;
}

message ImageInfo {
  int32 index = 1;
  string image_id = 2;     // 图片存储 ID，前端通过 /api/v1/images/:id 获取
  string alt_text = 3;
  int32 width = 4;
  int32 height = 5;
}
```

**关键设计**：服务端流式，逐页返回。图片用引用模式（单独存储），gRPC 流只传文本 Markdown + 元数据。

## Python 解析引擎

### 解析器路由器

```
                    ┌─────────────────┐
                    │   FormatRouter  │
                    │  (MIME检测)      │
                    └───────┬─────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  PDF Parser   │   │ DOCX Parser   │   │  PPTX Parser  │
│ Docling (主)  │   │ python-docx   │   │ python-pptx   │
│ pymupdf (降级)│   │ + MarkItDown  │   │ + MarkItDown  │
└───────────────┘   └───────────────┘   └───────────────┘
```

- **格式检测**：`python-magic` 做 MIME 检测，不信任文件扩展名
- **并发模型**：`ProcessPoolExecutor`（CPU 密集型 + GIL），默认 4 worker
- **每个 worker**：独立加载模型，约 2GB 内存/进程

### PDF 双引擎策略

```
PDF → 页数 ≤ 30 → Docling（视觉模型，质量最高）
    → 页数 > 30 → 前 N 页 Docling + 剩余页 pymupdf（纯文本提取）
    → Docling OOM → 全部降级 pymupdf
    → pymupdf 失败 → text extraction → 报错
```

### 质量保障

| 机制 | 说明 |
|------|------|
| MIME 检测 | `python-magic`，不信任扩展名 |
| 置信度标记 | 每页带 0-1 置信度，<0.7 前端高亮 |
| 降级链 | 每步失败有 fallback + 日志 |
| Markdown 校验 | `mistune` 验证输出语法 |

### 统一解析器接口

```python
class BaseParser(ABC):
    @abstractmethod
    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        """逐页流式解析"""
        ...

    @abstractmethod
    def supported_formats(self) -> list[str]:
        """返回支持的 MIME 类型"""
        ...
```

## Fastify API 网关

### 路由

```
POST   /api/v1/documents               # 上传文件
GET    /api/v1/documents/:id           # 查询任务
GET    /api/v1/documents/:id/stream    # SSE 解析进度
GET    /api/v1/documents/:id/download  # 下载 .md
DELETE /api/v1/documents/:id           # 删除
GET    /api/v1/formats                 # 支持格式
```

### 上传流程

1. 校验文件大小（默认上限 100MB，可配置）
2. MIME 白名单校验
3. SHA256 去重——已存在且 completed 则直接返回已有 task_id
4. 写入本地存储 `/data/files/{sha256[:2]}/{sha256}`
5. 插入 task（status=queued），异步发起 gRPC
6. 返回 202

### SSE 流式推送

gRPC stream 回调直接映射到 SSE 事件：

```
event: progress   → {"page": 3, "total": 20, "confidence": 0.92}
event: chunk      → {"page": 3, "markdown": "## Chapter 1\n..."}
event: complete   → {"total_pages": 20, "overall_confidence": 0.88}
event: error      → {"code": "PARSE_FAILED", "message": "..."}
```

关键配置：`proxy_buffering off`（Nginx 不能缓冲 SSE）、`proxy_read_timeout 600s`。

### 定时清理

Fastify 内嵌 `node-cron`，每 6 小时：
- 删除 `status=completed AND created_at > 24h` 的任务
- 引用计数 > 1 则只减计数，引用计数 = 1 则同时删文件

## React 前端

### 页面布局

```
┌──────────────────────────────────────┐
│  Header (Logo + 格式说明)              │
├──────────────────────────────────────┤
│  ┌──────────────────────────────┐    │
│  │  拖拽/点击上传                  │    │
│  └──────────────────────────────┘    │
│  解析选项面板（折叠）                   │
├────────────┬─────────────────────────┤
│ 历史列表    │  Markdown 渲染预览       │
│ (左侧280px)│  实时流式更新 + 置信度标记 │
└────────────┴─────────────────────────┘
```

### 组件树

```
App
├── Header
├── UploadZone (react-dropzone)
│   ├── DragDropArea
│   └── ParseOptions (collapsible)
├── MainPanel
│   ├── HistorySidebar
│   │   └── HistoryItem[]
│   └── PreviewPane
│       ├── StatusBar (进度 + 置信度)
│       ├── MarkdownRenderer (react-markdown + remark-gfm + rehype-highlight)
│       ├── ImageViewer (lightbox)
│       └── DownloadButton
```

### 状态管理

React Context + useReducer：

```typescript
interface Task {
  id: string;
  filename: string;
  status: 'queued' | 'parsing' | 'completed' | 'failed';
  progress: { page: number; total: number };
  confidence: number;
  markdown: string;   // SSE 累积追加
  images: ImageMeta[];
  error?: string;
}
```

### SSE Hook

```typescript
function useParseStream(taskId: string) {
  // 挂载 → new EventSource → 监听 chunk/complete/error → 更新状态
  // 卸载 → close()
}
```

## 数据库

```sql
CREATE TYPE task_status AS ENUM ('queued', 'parsing', 'completed', 'failed');

CREATE TABLE tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename      VARCHAR(512) NOT NULL,
    file_size     BIGINT NOT NULL,
    file_sha256   CHAR(64) NOT NULL,
    mime_type     VARCHAR(128) NOT NULL,
    status        task_status NOT NULL DEFAULT 'queued',
    options       JSONB DEFAULT '{}',
    markdown      TEXT,
    total_pages   INT,
    confidence    REAL,
    error_message TEXT,
    file_ref_count INT DEFAULT 1,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID REFERENCES tasks(id) ON DELETE CASCADE,
    page_number   INT NOT NULL,
    image_index   INT NOT NULL,
    alt_text      VARCHAR(512),
    file_path     VARCHAR(1024) NOT NULL,
    width         INT,
    height        INT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_sha256 ON tasks(file_sha256);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_images_task_id ON images(task_id);
```

- **去重**：上传时按 SHA256 查已完成任务，命中则引用计数 +1，直接返回
- **JSONB options**：不按格式拆列，避免列膨胀
- **markdown 存表**：百万字级别完全够用

## 部署

### Docker Compose 编排

```
docker-compose.yml
├── nginx      → 反向代理 + 前端静态文件
├── fastify    → API 网关
├── parser     → Python gRPC 解析引擎
├── postgres   → PostgreSQL 16
└── redis      → 限流 + 缓存
```

### 挂载目录

```
./data/
├── files/      # 原始文件（按 SHA256 前 2 字符分目录）
├── images/     # 解析提取的图片
└── postgres/   # PG 数据

./config/
├── nginx.conf
├── fastify.env
└── parser.env
```

### 关键环境变量

```bash
# fastify
GRPC_PARSER_HOST=parser:50051
DATABASE_URL=postgresql://docparse:password@postgres:5432/docparse
MAX_FILE_SIZE=104857600
FILE_RETENTION_HOURS=24

# parser
MAX_WORKERS=4
DOCLING_MODEL_PATH=/models
PYMUPDOC_FALLBACK=true
```

### 健康检查链

postgres（pg_isready） → parser（grpc_health_probe） → fastify（/health HTTP endpoint）

## 开发路线

### Phase 1：核心解析（Python 独立可跑）
- protobuf 编译 + gRPC server 启动
- FormatRouter + TXT/DOCX/PDF/PPTX 解析器
- 集成测试：每种格式 5 个样本

### Phase 2：API 网关 + 前端骨架
- Fastify + gRPC 客户端 + PostgreSQL
- 上传 API + 去重 + 文件存储
- SSE 流式推送
- React 拖拽上传 + Markdown 渲染

### Phase 3：完善体验
- 图片提取/存储/灯箱
- 历史列表 + 搜索
- 置信度 UI + 错误状态
- 复制/下载 Markdown
- Redis 限流

### Phase 4：部署和文档
- Dockerfile × 3 + docker-compose.yml
- 健康检查 + 启动脚本
- 定时清理
- 开发文档 + API 文档 + 部署文档
- 性能基准测试

## 测试策略

| 层级 | 框架 | 覆盖 |
|------|------|------|
| Python 单元测试 | pytest | 每个 Parser + 降级逻辑 |
| Python 集成测试 | pytest + grpc-testing | gRPC 全流程 + 异常文件 |
| Fastify 单元测试 | vitest | 路由/中间件/去重 |
| Fastify E2E | vitest + supertest | HTTP → gRPC → DB |
| React 组件测试 | vitest + testing-library | UploadZone/MarkdownRenderer/SSE hook |
| React E2E | Playwright | 上传 → 等待 → 验证预览 |
