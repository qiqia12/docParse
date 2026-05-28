# DocParse — 文档结构化解析服务

将 TXT / DOCX / PDF / PPTX 文件解析为结构化 Markdown 的 Web 服务。

## 快速开始

```bash
make up       # 启动所有服务
# 浏览器打开 http://localhost:8080
make down     # 停止
```

## 架构

```
浏览器 → Nginx(:8080) → Fastify API(:3000) → Python gRPC Parser(:50051)
                            ↓
                       PostgreSQL + Redis
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/documents | 上传文件 |
| GET | /api/v1/documents/:id | 查询任务 |
| GET | /api/v1/documents/:id/stream | SSE 流式进度 |
| GET | /api/v1/documents/:id/download | 下载 .md |
| DELETE | /api/v1/documents/:id | 删除 |
| GET | /api/v1/formats | 支持格式 |

## 开发

```bash
# 解析引擎
cd parser && pip install -r requirements.txt && make proto && make run

# API 网关
cd api && cp ../config/fastify.env .env && npm install && npm run dev

# 前端
cd web && npm install && npm run dev
```

## 测试

```bash
make test
```
