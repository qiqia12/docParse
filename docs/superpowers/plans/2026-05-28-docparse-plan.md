# DocParse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable document-to-markdown parsing web service supporting txt/docx/pdf/pptx with real-time SSE streaming.

**Architecture:** React + Fastify + Python gRPC, mixed stack. Fastify handles uploads and SSE push; Python gRPC service runs Docling/MarkItDown/pymupdf for parsing; PostgreSQL stores task metadata and dedup index. Docker Compose deployment.

**Tech Stack:** React 18 + TypeScript + Vite, Fastify 5 + TypeScript, Python 3.12 + gRPC + Docling + MarkItDown + pymupdf, PostgreSQL 16, Redis 7, Nginx, Docker Compose

---

## File Structure

```
docparse/
├── parser/                        # Python gRPC 解析引擎
│   ├── proto/
│   │   └── document_parser.proto  # gRPC 协议定义
│   ├── src/
│   │   ├── __init__.py
│   │   ├── server.py              # gRPC server 入口
│   │   ├── router.py              # FormatRouter (MIME → Parser 映射)
│   │   ├── base_parser.py         # BaseParser 抽象基类
│   │   ├── models.py              # ParseOptions, ParseChunk, ImageInfo 数据类
│   │   ├── mime_detector.py       # python-magic MIME 检测
│   │   └── parsers/
│   │       ├── __init__.py
│   │       ├── txt_parser.py      # TXT 解析 (chardet + 段落分割)
│   │       ├── docx_parser.py     # DOCX 解析 (MarkItDown)
│   │       ├── pdf_parser.py      # PDF 解析 (Docling + pymupdf 降级)
│   │       └── pptx_parser.py     # PPTX 解析 (python-pptx + MarkItDown)
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py            # pytest fixtures (gRPC test client, 样本文件路径)
│   │   ├── test_router.py
│   │   ├── test_txt_parser.py
│   │   ├── test_docx_parser.py
│   │   ├── test_pdf_parser.py
│   │   ├── test_pptx_parser.py
│   │   ├── test_server.py         # gRPC 集成测试
│   │   └── fixtures/
│   │       ├── sample.txt
│   │       ├── sample.docx
│   │       ├── sample.pdf
│   │       └── sample.pptx
│   ├── requirements.txt
│   ├── Makefile
│   └── Dockerfile
│
├── api/                           # Fastify API 网关
│   ├── src/
│   │   ├── index.ts               # 服务入口
│   │   ├── config.ts              # 环境变量配置
│   │   ├── db.ts                  # PostgreSQL 连接池 (kysely + pg)
│   │   ├── redis.ts               # Redis 连接 (ioredis)
│   │   ├── routes/
│   │   │   ├── documents.ts       # 文档 CRUD + SSE
│   │   │   └── formats.ts         # 格式列表
│   │   ├── services/
│   │   │   ├── grpc-client.ts     # gRPC 客户端 (封装 Parse + stream)
│   │   │   ├── file-store.ts      # 文件存储 (SHA256 分目录)
│   │   │   └── sse-manager.ts     # SSE 连接管理 (EventEmitter → SSE)
│   │   └── cron/
│   │       └── cleanup.ts         # 定时清理过期文件
│   ├── tests/
│   │   ├── routes/
│   │   │   └── documents.test.ts
│   │   ├── services/
│   │   │   ├── file-store.test.ts
│   │   │   └── grpc-client.test.ts
│   │   └── helpers/
│   │       └── setup.ts           # 测试 DB 初始化
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── web/                           # React 前端
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── context/
│   │   │   └── AppContext.tsx      # Context + useReducer
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── UploadZone.tsx
│   │   │   ├── ParseOptions.tsx
│   │   │   ├── HistorySidebar.tsx
│   │   │   ├── PreviewPane.tsx
│   │   │   ├── MarkdownRenderer.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   ├── ImageViewer.tsx
│   │   │   └── DownloadButton.tsx
│   │   ├── hooks/
│   │   │   ├── useParseStream.ts
│   │   │   └── useApi.ts
│   │   └── types/
│   │       └── index.ts
│   ├── tests/
│   │   ├── components/
│   │   │   ├── UploadZone.test.tsx
│   │   │   └── MarkdownRenderer.test.tsx
│   │   └── hooks/
│   │       └── useParseStream.test.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── Dockerfile
│
├── config/                        # 部署配置
│   ├── nginx.conf
│   ├── fastify.env
│   └── parser.env
│
├── docker-compose.yml
├── Makefile                       # 项目级 Makefile (build/test/up/down)
└── README.md
```

---

## Phase 1: Python gRPC 解析引擎

### Task 1: 项目骨架 + protobuf 编译

**Files:**
- Create: `parser/proto/document_parser.proto`
- Create: `parser/requirements.txt`
- Create: `parser/Makefile`
- Create: `parser/src/__init__.py`
- Create: `parser/src/models.py`

**Goal:** 定义 gRPC 协议，编译生成 Python stub，建立项目基础结构。

- [ ] **Step 1: 创建 protobuf 协议文件**

Create `parser/proto/document_parser.proto`:
```protobuf
syntax = "proto3";

package docparse;

service DocumentParser {
  rpc Parse(ParseRequest) returns (stream ParseChunk);
  rpc GetSupportedFormats(Empty) returns (FormatList);
}

message Empty {}

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
  string output_style = 4;
}

message ParseChunk {
  int32 page_number = 1;
  int32 total_pages = 2;
  string markdown = 3;
  repeated ImageInfo images = 4;
  float confidence = 5;
  bool is_complete = 6;
}

message ImageInfo {
  int32 index = 1;
  string image_id = 2;
  string alt_text = 3;
  int32 width = 4;
  int32 height = 5;
}

message FormatList {
  repeated string mime_types = 1;
}
```

- [ ] **Step 2: 创建 requirements.txt**

Create `parser/requirements.txt`:
```
grpcio==1.67.0
grpcio-tools==1.67.0
protobuf==5.28.3
python-magic==0.4.27
chardet==5.2.0
markitdown==0.0.1a3
docling==2.14.0
pymupdf==1.24.14
python-pptx==1.0.2
python-docx==1.1.2
mistune==3.0.2
pillow==11.0.0
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 3: 创建 Makefile 用于 protobuf 编译**

Create `parser/Makefile`:
```makefile
.PHONY: proto test run clean

proto:
	python -m grpc_tools.protoc \
		-I./proto \
		--python_out=./src \
		--grpc_python_out=./src \
		./proto/document_parser.proto
	sed -i '' 's/import document_parser_pb2/from . import document_parser_pb2/' src/document_parser_pb2_grpc.py || true

test:
	python -m pytest tests/ -v

run:
	python -m src.server

clean:
	rm -f src/document_parser_pb2.py src/document_parser_pb2_grpc.py
```

- [ ] **Step 4: 创建 Python 数据模型**

Create `parser/src/models.py`:
```python
from dataclasses import dataclass, field


@dataclass
class ParseOptions:
    extract_images: bool = True
    extract_tables: bool = True
    max_pages: int = 0
    output_style: str = "github"


@dataclass
class ImageInfo:
    index: int
    image_id: str
    alt_text: str = ""
    width: int = 0
    height: int = 0
    data: bytes = field(default=b"", repr=False)


@dataclass
class ParseChunk:
    page_number: int
    total_pages: int
    markdown: str
    images: list[ImageInfo] = field(default_factory=list)
    confidence: float = 1.0
    is_complete: bool = False
```

- [ ] **Step 5: 编译 protobuf 并验证**

Run: `cd parser && make proto`
Verify that `parser/src/document_parser_pb2.py` and `parser/src/document_parser_pb2_grpc.py` are created.

- [ ] **Step 6: Commit**

```bash
cd /Users/plus7/program/docparse && git init && git add parser/proto/ parser/requirements.txt parser/Makefile parser/src/__init__.py parser/src/models.py parser/src/document_parser_pb2.py parser/src/document_parser_pb2_grpc.py && git commit -m "feat(parser): add project skeleton, protobuf protocol, and data models"
```

---

### Task 2: BaseParser + MIME 检测 + FormatRouter

**Files:**
- Create: `parser/src/base_parser.py`
- Create: `parser/src/mime_detector.py`
- Create: `parser/src/router.py`
- Create: `parser/tests/__init__.py`
- Create: `parser/tests/conftest.py`
- Create: `parser/tests/test_router.py`

**Goal:** 定义解析器统一接口，实现 MIME 检测和路由器。

- [ ] **Step 1: 编写 BaseParser 测试**

Create `parser/tests/test_router.py`:
```python
import pytest
from src.base_parser import BaseParser
from src.models import ParseChunk, ParseOptions


def test_base_parser_is_abstract():
    with pytest.raises(TypeError):
        BaseParser()


def test_concrete_parser_must_implement_parse():
    class BadParser(BaseParser):
        def supported_formats(self):
            return ["text/plain"]

    with pytest.raises(TypeError):
        BadParser()


def test_concrete_parser_must_implement_formats():
    class BadParser(BaseParser):
        def parse(self, file_bytes, filename, options):
            yield ParseChunk(page_number=1, total_pages=1, markdown="")

    with pytest.raises(TypeError):
        BadParser()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_router.py -v`
Expected: FAIL, `BaseParser` not defined.

- [ ] **Step 3: 编写 BaseParser**

Create `parser/src/base_parser.py`:
```python
from abc import ABC, abstractmethod
from typing import Iterator

from .models import ParseChunk, ParseOptions


class BaseParser(ABC):
    @abstractmethod
    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        ...

    @abstractmethod
    def supported_formats(self) -> list[str]:
        ...
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_router.py -v`
Expected: PASS.

- [ ] **Step 5: 编写 MIME 检测器**

Create `parser/src/mime_detector.py`:
```python
import magic


def detect_mime(file_bytes: bytes, filename: str = "") -> str:
    mime = magic.from_buffer(file_bytes, mime=True)
    if mime != "application/octet-stream":
        return mime
    if filename:
        ext_map = {
            ".txt": "text/plain",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".pdf": "application/pdf",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }
        for ext, mime_type in ext_map.items():
            if filename.lower().endswith(ext):
                return mime_type
    return "application/octet-stream"
```

- [ ] **Step 6: 编写 FormatRouter 测试**

Append to `parser/tests/test_router.py`:
```python
from src.router import FormatRouter
from src.models import ParseChunk, ParseOptions


class FakeTxtParser(BaseParser):
    def parse(self, file_bytes, filename, options):
        yield ParseChunk(page_number=1, total_pages=1, markdown="fake", is_complete=True)

    def supported_formats(self):
        return ["text/plain"]


def test_router_registers_and_routes():
    router = FormatRouter()
    router.register(FakeTxtParser())
    parser = router.route("test.txt", b"hello world")
    assert isinstance(parser, FakeTxtParser)


def test_router_raises_on_unsupported_format():
    router = FormatRouter()
    with pytest.raises(ValueError, match="Unsupported format"):
        router.route("test.xyz", b"binary data")
```

- [ ] **Step 7: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_router.py::test_router_registers_and_routes -v`
Expected: FAIL, `FormatRouter` not defined.

- [ ] **Step 8: 编写 FormatRouter**

Create `parser/src/router.py`:
```python
from .base_parser import BaseParser
from .mime_detector import detect_mime


class FormatRouter:
    def __init__(self):
        self._parsers: dict[str, BaseParser] = {}

    def register(self, parser: BaseParser):
        for fmt in parser.supported_formats():
            self._parsers[fmt] = parser

    def route(self, filename: str, file_bytes: bytes) -> BaseParser:
        mime = detect_mime(file_bytes, filename)
        parser = self._parsers.get(mime)
        if parser is None:
            raise ValueError(f"Unsupported format: {mime}")
        return parser
```

- [ ] **Step 9: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_router.py -v`
Expected: PASS.

- [ ] **Step 10: 创建测试 conftest**

Create `parser/tests/conftest.py`:
```python
import os
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def fixtures_dir():
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    return FIXTURES_DIR


def get_fixture_path(filename: str) -> str:
    return os.path.join(FIXTURES_DIR, filename)
```

- [ ] **Step 11: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/base_parser.py parser/src/mime_detector.py parser/src/router.py parser/tests/ && git commit -m "feat(parser): add BaseParser, MIME detector, and FormatRouter"
```

---

### Task 3: TXT 解析器

**Files:**
- Create: `parser/src/parsers/__init__.py`
- Create: `parser/src/parsers/txt_parser.py`
- Create: `parser/tests/test_txt_parser.py`
- Create: `parser/tests/fixtures/sample.txt`

**Goal:** 实现 TXT 解析：编码检测 + 段落分割为 Markdown。

- [ ] **Step 1: 创建测试样本文件**

Create `parser/tests/fixtures/sample.txt` (UTF-8 中文混合):
```
这是一段中文测试文本。

包含多个段落。

第二段内容，包含一些特殊字符：——、""、……

This is English mixed with 中文。

## 看起来像标题的行

结束段落。
```

- [ ] **Step 2: 编写 TXT 解析器测试**

Create `parser/tests/test_txt_parser.py`:
```python
import pytest
from src.parsers.txt_parser import TxtParser
from src.models import ParseOptions


def test_txt_parser_supported_formats():
    parser = TxtParser()
    assert "text/plain" in parser.supported_formats()


def test_txt_parser_utf8():
    parser = TxtParser()
    content = "第一行\n\n第二段\n第三行"
    chunks = list(parser.parse(content.encode("utf-8"), "test.txt", ParseOptions()))
    assert len(chunks) == 1
    assert chunks[0].page_number == 1
    assert chunks[0].total_pages == 1
    assert chunks[0].is_complete
    assert "第一行" in chunks[0].markdown
    assert "\n\n" in chunks[0].markdown


def test_txt_parser_gbk():
    parser = TxtParser()
    content = "GBK编码测试文本"
    chunks = list(parser.parse(content.encode("gbk"), "test.txt", ParseOptions()))
    assert len(chunks) == 1
    assert "GBK编码测试文本" in chunks[0].markdown


def test_txt_parser_empty_file():
    parser = TxtParser()
    chunks = list(parser.parse(b"", "empty.txt", ParseOptions()))
    assert len(chunks) == 1
    assert chunks[0].markdown == ""


def test_txt_parser_large_file_pagination():
    parser = TxtParser()
    lines = [f"Line {i}" for i in range(200)]
    content = "\n".join(lines).encode("utf-8")
    chunks = list(parser.parse(content, "large.txt", ParseOptions(max_pages=0)))
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.markdown != ""
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_txt_parser.py -v`
Expected: FAIL, `TxtParser` not defined.

- [ ] **Step 4: 编写 TXT 解析器**

Create `parser/src/parsers/__init__.py`:
```python
from .txt_parser import TxtParser
from .docx_parser import DocxParser
from .pdf_parser import PdfParser
from .pptx_parser import PptxParser

__all__ = ["TxtParser", "DocxParser", "PdfParser", "PptxParser"]
```

Create `parser/src/parsers/txt_parser.py`:
```python
from typing import Iterator

import chardet

from ..base_parser import BaseParser
from ..models import ParseChunk, ParseOptions


class TxtParser(BaseParser):
    LINES_PER_PAGE = 80

    def supported_formats(self) -> list[str]:
        return ["text/plain"]

    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        encoding = chardet.detect(file_bytes)["encoding"] or "utf-8"
        text = file_bytes.decode(encoding, errors="replace")

        if not text.strip():
            yield ParseChunk(
                page_number=1, total_pages=1,
                markdown="", is_complete=True
            )
            return

        lines = text.splitlines(keepends=True)
        total_pages = max(1, (len(lines) + self.LINES_PER_PAGE - 1) // self.LINES_PER_PAGE)

        for page_num in range(total_pages):
            start = page_num * self.LINES_PER_PAGE
            end = min(start + self.LINES_PER_PAGE, len(lines))
            page_text = "".join(lines[start:end])
            markdown = self._lines_to_markdown(page_text)

            yield ParseChunk(
                page_number=page_num + 1,
                total_pages=total_pages,
                markdown=markdown,
                is_complete=(page_num == total_pages - 1),
            )

    def _lines_to_markdown(self, text: str) -> str:
        result = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                result.append("")
            elif stripped.startswith("#"):
                result.append(stripped)
            else:
                result.append(stripped)
        return "\n\n".join(result)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_txt_parser.py -v`
Expected: PASS (all 5 tests).

- [ ] **Step 6: 修复 parsers/__init__.py 的 import**

由于其他 parser 还没创建，暂时修改 `parsers/__init__.py` 只导入已实现的：

```python
from .txt_parser import TxtParser

__all__ = ["TxtParser"]
```

- [ ] **Step 7: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/parsers/ parser/tests/test_txt_parser.py parser/tests/fixtures/sample.txt && git commit -m "feat(parser): add TXT parser with encoding detection and pagination"
```

---

### Task 4: DOCX 解析器

**Files:**
- Create: `parser/src/parsers/docx_parser.py`
- Create: `parser/tests/test_docx_parser.py`

**Goal:** 用 MarkItDown 解析 DOCX，封装为流式输出。

- [ ] **Step 1: 编写 DOCX 解析器测试**

Create `parser/tests/test_docx_parser.py`:
```python
import pytest
from src.parsers.docx_parser import DocxParser
from src.models import ParseOptions


def test_docx_parser_supported_formats():
    parser = DocxParser()
    assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in parser.supported_formats()


def test_docx_parser_with_bytes():
    parser = DocxParser()
    # minimal valid DOCX bytes (empty document)
    from docx import Document
    from io import BytesIO
    doc = Document()
    doc.add_paragraph("Hello World")
    buf = BytesIO()
    doc.save(buf)
    docx_bytes = buf.getvalue()

    chunks = list(parser.parse(docx_bytes, "test.docx", ParseOptions()))
    assert len(chunks) >= 1
    assert any("Hello World" in c.markdown for c in chunks)


def test_docx_parser_empty_document():
    parser = DocxParser()
    from docx import Document
    from io import BytesIO
    doc = Document()
    buf = BytesIO()
    doc.save(buf)
    chunks = list(parser.parse(buf.getvalue(), "empty.docx", ParseOptions()))
    assert len(chunks) >= 1


def test_docx_parser_invalid_bytes():
    parser = DocxParser()
    with pytest.raises(Exception):
        list(parser.parse(b"not a docx file", "fake.docx", ParseOptions()))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_docx_parser.py -v`
Expected: FAIL, `DocxParser` not defined.

- [ ] **Step 3: 编写 DOCX 解析器**

Create `parser/src/parsers/docx_parser.py`:
```python
from io import BytesIO
from typing import Iterator

from ..base_parser import BaseParser
from ..models import ParseChunk, ParseOptions


class DocxParser(BaseParser):
    MARKDOWN_PAGE_SIZE = 5000

    def supported_formats(self) -> list[str]:
        return [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ]

    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert(BytesIO(file_bytes), file_extension=".docx")
        markdown = result.text_content

        if not markdown.strip():
            yield ParseChunk(page_number=1, total_pages=1, markdown="", is_complete=True)
            return

        total_pages = max(1, (len(markdown) + self.MARKDOWN_PAGE_SIZE - 1) // self.MARKDOWN_PAGE_SIZE)
        for page_num in range(total_pages):
            start = page_num * self.MARKDOWN_PAGE_SIZE
            end = min(start + self.MARKDOWN_PAGE_SIZE, len(markdown))
            chunk_text = markdown[start:end]

            yield ParseChunk(
                page_number=page_num + 1,
                total_pages=total_pages,
                markdown=chunk_text,
                is_complete=(page_num == total_pages - 1),
            )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_docx_parser.py -v`
Expected: PASS.

- [ ] **Step 5: 更新 parsers/__init__.py**

```python
from .txt_parser import TxtParser
from .docx_parser import DocxParser

__all__ = ["TxtParser", "DocxParser"]
```

- [ ] **Step 6: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/parsers/docx_parser.py parser/src/parsers/__init__.py parser/tests/test_docx_parser.py && git commit -m "feat(parser): add DOCX parser using MarkItDown"
```

---

### Task 5: PDF 解析器 (Docling + pymupdf 降级)

**Files:**
- Create: `parser/src/parsers/pdf_parser.py`
- Create: `parser/tests/test_pdf_parser.py`

**Goal:** PDF 双引擎解析：Docling 主引擎（≤30页），pymupdf 降级。

- [ ] **Step 1: 编写 PDF 解析器测试**

Create `parser/tests/test_pdf_parser.py`:
```python
import pytest
from src.parsers.pdf_parser import PdfParser
from src.models import ParseOptions


def test_pdf_parser_supported_formats():
    parser = PdfParser()
    assert "application/pdf" in parser.supported_formats()


def test_pdf_parser_with_pymupdf():
    """Use pymupdf to create a minimal PDF and test parsing"""
    import fitz
    parser = PdfParser()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), "Hello PDF World", fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()

    chunks = list(parser.parse(pdf_bytes, "test.pdf", ParseOptions()))
    assert len(chunks) >= 1
    assert any("Hello PDF World" in c.markdown for c in chunks)
    for chunk in chunks:
        assert chunk.confidence >= 0.0
        assert chunk.confidence <= 1.0


def test_pdf_parser_empty_pdf():
    import fitz
    parser = PdfParser()
    doc = fitz.open()
    pdf_bytes = doc.tobytes()
    doc.close()
    chunks = list(parser.parse(pdf_bytes, "empty.pdf", ParseOptions()))
    assert len(chunks) >= 1


def test_pdf_parser_invalid_bytes():
    parser = PdfParser()
    with pytest.raises(Exception):
        list(parser.parse(b"not a pdf", "fake.pdf", ParseOptions()))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_pdf_parser.py -v`
Expected: FAIL.

- [ ] **Step 3: 编写 PDF 解析器**

Create `parser/src/parsers/pdf_parser.py`:
```python
import logging
from typing import Iterator

import fitz

from ..base_parser import BaseParser
from ..models import ParseChunk, ParseOptions

logger = logging.getLogger(__name__)

DOCLING_PAGE_LIMIT = 30


class PdfParser(BaseParser):
    def __init__(self, use_docling: bool = True, pymupdf_fallback: bool = True):
        self._use_docling = use_docling
        self._pymupdf_fallback = pymupdf_fallback

    def supported_formats(self) -> list[str]:
        return ["application/pdf"]

    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = doc.page_count

        if options.max_pages > 0:
            total_pages = min(total_pages, options.max_pages)

        use_docling = self._use_docling and total_pages <= DOCLING_PAGE_LIMIT

        if use_docling:
            try:
                yield from self._parse_with_docling(file_bytes, total_pages, options)
                doc.close()
                return
            except Exception as e:
                logger.warning(f"Docling failed: {e}, falling back to pymupdf")

        yield from self._parse_with_pymupdf(doc, total_pages)
        doc.close()

    def _parse_with_docling(
        self, file_bytes: bytes, total_pages: int, options: ParseOptions
    ) -> Iterator[ParseChunk]:
        from docling.document_converter import DocumentConverter
        from io import BytesIO

        converter = DocumentConverter()
        result = converter.convert(BytesIO(file_bytes))
        markdown = result.document.export_to_markdown()

        page_size = max(1, len(markdown) // max(1, total_pages))
        for page_num in range(total_pages):
            start = page_num * page_size
            end = min(start + page_size, len(markdown)) if page_num < total_pages - 1 else len(markdown)
            chunk_text = markdown[start:end] if start < len(markdown) else ""

            yield ParseChunk(
                page_number=page_num + 1,
                total_pages=total_pages,
                markdown=chunk_text,
                confidence=0.85,
                is_complete=(page_num == total_pages - 1),
            )

    def _parse_with_pymupdf(
        self, doc: fitz.Document, total_pages: int
    ) -> Iterator[ParseChunk]:
        for page_num in range(total_pages):
            page = doc[page_num]
            text = page.get_text("markdown") or page.get_text("text")
            yield ParseChunk(
                page_number=page_num + 1,
                total_pages=total_pages,
                markdown=text,
                confidence=0.7 if text else 0.3,
                is_complete=(page_num == total_pages - 1),
            )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_pdf_parser.py -v`
Expected: PASS.

- [ ] **Step 5: 更新 parsers/__init__.py**

```python
from .txt_parser import TxtParser
from .docx_parser import DocxParser
from .pdf_parser import PdfParser

__all__ = ["TxtParser", "DocxParser", "PdfParser"]
```

- [ ] **Step 6: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/parsers/pdf_parser.py parser/src/parsers/__init__.py parser/tests/test_pdf_parser.py && git commit -m "feat(parser): add PDF parser with Docling/pymupdf dual-engine and fallback"
```

---

### Task 6: PPTX 解析器

**Files:**
- Create: `parser/src/parsers/pptx_parser.py`
- Create: `parser/tests/test_pptx_parser.py`

**Goal:** 用 python-pptx + MarkItDown 解析 PPTX，按幻灯片分页。

- [ ] **Step 1: 编写 PPTX 测试**

Create `parser/tests/test_pptx_parser.py`:
```python
import pytest
from src.parsers.pptx_parser import PptxParser
from src.models import ParseOptions


def test_pptx_parser_supported_formats():
    parser = PptxParser()
    assert "application/vnd.openxmlformats-officedocument.presentationml.presentation" in parser.supported_formats()


def test_pptx_parser_with_bytes():
    from pptx import Presentation
    from io import BytesIO

    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Slide Title"
    buf = BytesIO()
    prs.save(buf)

    parser = PptxParser()
    chunks = list(parser.parse(buf.getvalue(), "test.pptx", ParseOptions()))
    assert len(chunks) >= 1
    assert any("Slide Title" in c.markdown for c in chunks)


def test_pptx_parser_page_per_slide():
    from pptx import Presentation
    from io import BytesIO

    prs = Presentation()
    for i in range(3):
        slide = prs.slides.add_slide(prs.slide_layouts[0])
        slide.shapes.title.text = f"Slide {i+1}"

    buf = BytesIO()
    prs.save(buf)

    parser = PptxParser()
    chunks = list(parser.parse(buf.getvalue(), "multi.pptx", ParseOptions()))
    assert len(chunks) == 3
    for i, chunk in enumerate(chunks):
        assert chunk.page_number == i + 1
        assert chunk.total_pages == 3
```
- [ ] **Step 2: 运行测试确认失败**

Run: `cd parser && python -m pytest tests/test_pptx_parser.py -v`
Expected: FAIL.

- [ ] **Step 3: 编写 PPTX 解析器**

Create `parser/src/parsers/pptx_parser.py`:
```python
from io import BytesIO
from typing import Iterator

from pptx import Presentation

from ..base_parser import BaseParser
from ..models import ParseChunk, ParseOptions


class PptxParser(BaseParser):
    def supported_formats(self) -> list[str]:
        return [
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ]

    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        prs = Presentation(BytesIO(file_bytes))
        total_slides = len(prs.slides)

        if total_slides == 0:
            yield ParseChunk(page_number=1, total_pages=1, markdown="", is_complete=True)
            return

        for slide_num, slide in enumerate(prs.slides, 1):
            lines = []

            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if text:
                            if shape.is_placeholder and shape.placeholder_format.type == 1:
                                lines.append(f"## {text}")
                            else:
                                lines.append(text)

                if shape.has_table:
                    table = shape.table
                    header = "| " + " | ".join(cell.text for cell in table.rows[0].cells) + " |"
                    sep = "|" + "|".join("---" for _ in table.rows[0].cells) + "|"
                    rows = []
                    for row in table.rows[1:]:
                        rows.append("| " + " | ".join(cell.text for cell in row.cells) + " |")
                    lines.append("\n".join([header, sep] + rows))

            yield ParseChunk(
                page_number=slide_num,
                total_pages=total_slides,
                markdown="\n\n".join(lines),
                is_complete=(slide_num == total_slides),
            )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd parser && python -m pytest tests/test_pptx_parser.py -v`
Expected: PASS.

- [ ] **Step 5: 更新 parsers/__init__.py**

```python
from .txt_parser import TxtParser
from .docx_parser import DocxParser
from .pdf_parser import PdfParser
from .pptx_parser import PptxParser

__all__ = ["TxtParser", "DocxParser", "PdfParser", "PptxParser"]
```

- [ ] **Step 6: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/parsers/pptx_parser.py parser/src/parsers/__init__.py parser/tests/test_pptx_parser.py && git commit -m "feat(parser): add PPTX parser with slide-by-slide extraction"
```

---

### Task 7: gRPC Server

**Files:**
- Create: `parser/src/server.py`
- Create: `parser/tests/test_server.py`

**Goal:** 启动 gRPC 服务，关联 FormatRouter，实现 Parse 和 GetSupportedFormats。

- [ ] **Step 1: 编译 protobuf**

Run: `cd parser && make proto`
Verify generated files exist.

- [ ] **Step 2: 编写 gRPC 服务实现**

Create `parser/src/server.py`:
```python
import logging
import traceback

import grpc
from concurrent import futures

from . import document_parser_pb2 as pb2
from . import document_parser_pb2_grpc as pb2_grpc
from .router import FormatRouter
from .parsers import TxtParser, DocxParser, PdfParser, PptxParser
from .models import ParseOptions, ImageInfo, ParseChunk

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DocumentParserServicer(pb2_grpc.DocumentParserServicer):
    def __init__(self):
        self.router = FormatRouter()
        self.router.register(TxtParser())
        self.router.register(DocxParser())
        self.router.register(PdfParser())
        self.router.register(PptxParser())

    def Parse(self, request: pb2.ParseRequest, context):
        logger.info(f"Parse request: task_id={request.task_id} file={request.filename}")
        try:
            parser = self.router.route(request.filename, request.file_content)
        except ValueError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return

        options = ParseOptions(
            extract_images=request.options.extract_images,
            extract_tables=request.options.extract_tables,
            max_pages=request.options.max_pages,
            output_style=request.options.output_style or "github",
        )

        try:
            for chunk in parser.parse(request.file_content, request.filename, options):
                yield pb2.ParseChunk(
                    page_number=chunk.page_number,
                    total_pages=chunk.total_pages,
                    markdown=chunk.markdown,
                    images=[
                        pb2.ImageInfo(
                            index=img.index,
                            image_id=img.image_id,
                            alt_text=img.alt_text,
                            width=img.width,
                            height=img.height,
                        )
                        for img in chunk.images
                    ],
                    confidence=chunk.confidence,
                    is_complete=chunk.is_complete,
                )
        except Exception as e:
            logger.error(f"Parse error: {e}\n{traceback.format_exc()}")
            context.abort(grpc.StatusCode.INTERNAL, str(e))

    def GetSupportedFormats(self, request, context):
        mime_types = []
        for parser_set in [TxtParser(), DocxParser(), PdfParser(), PptxParser()]:
            mime_types.extend(parser_set.supported_formats())
        return pb2.FormatList(mime_types=mime_types)


def serve(port: int = 50051, max_workers: int = 4):
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=max_workers),
        options=[
            ("grpc.max_send_message_length", 100 * 1024 * 1024),
            ("grpc.max_receive_message_length", 100 * 1024 * 1024),
        ],
    )
    pb2_grpc.add_DocumentParserServicer_to_server(DocumentParserServicer(), server)
    server.add_insecure_port(f"[::]:{port}")
    logger.info(f"gRPC server listening on port {port}")
    server.start()
    return server


if __name__ == "__main__":
    import os
    port = int(os.environ.get("GRPC_PORT", "50051"))
    workers = int(os.environ.get("MAX_WORKERS", "4"))
    srv = serve(port=port, max_workers=workers)
    srv.wait_for_termination()
```

- [ ] **Step 3: 编写 gRPC 集成测试**

Create `parser/tests/test_server.py`:
```python
import pytest
import grpc
from src import document_parser_pb2 as pb2
from src import document_parser_pb2_grpc as pb2_grpc
from src.server import DocumentParserServicer
from concurrent import futures


@pytest.fixture
def grpc_server():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    pb2_grpc.add_DocumentParserServicer_to_server(DocumentParserServicer(), server)
    port = server.add_insecure_port("[::]:0")
    server.start()
    yield port
    server.stop(grace=None)


@pytest.fixture
def grpc_stub(grpc_server):
    channel = grpc.insecure_channel(f"[::]:{grpc_server}")
    yield pb2_grpc.DocumentParserStub(channel)
    channel.close()


def test_parse_txt(grpc_stub):
    request = pb2.ParseRequest(
        file_content="Hello World\n\nSecond paragraph".encode("utf-8"),
        filename="test.txt",
        task_id="test-001",
        options=pb2.ParseOptions(extract_images=False, max_pages=0),
    )
    chunks = list(grpc_stub.Parse(request))
    assert len(chunks) >= 1
    assert chunks[-1].is_complete
    combined = "".join(c.markdown for c in chunks)
    assert "Hello World" in combined


def test_get_supported_formats(grpc_stub):
    formats = grpc_stub.GetSupportedFormats(pb2.Empty())
    assert len(formats.mime_types) >= 4
    assert "text/plain" in formats.mime_types
    assert "application/pdf" in formats.mime_types


def test_parse_unsupported_format(grpc_stub):
    request = pb2.ParseRequest(
        file_content=b"binary data",
        filename="test.xyz",
        task_id="test-002",
        options=pb2.ParseOptions(),
    )
    with pytest.raises(grpc.RpcError) as exc:
        list(grpc_stub.Parse(request))
    assert exc.value.code() == grpc.StatusCode.INVALID_ARGUMENT
```

- [ ] **Step 4: 运行集成测试**

Run: `cd parser && python -m pytest tests/test_server.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/plus7/program/docparse && git add parser/src/server.py parser/tests/test_server.py && git commit -m "feat(parser): add gRPC server with Parse streaming and GetSupportedFormats"
```

---

### Task 8: Phase 1 集成验证

**Goal:** 运行所有测试，确认 Phase 1 完整可用。

- [ ] **Step 1: 运行全部 parser 测试**

Run: `cd parser && python -m pytest tests/ -v`
Expected: ALL tests PASS (18+ tests across 6 test files).

- [ ] **Step 2: 提交 Phase 1 完成标记**

```bash
cd /Users/plus7/program/docparse && git add -A && git commit -m "feat(parser): Phase 1 complete — all parsers + gRPC server with tests passing"
```

---

## Phase 2: Fastify API 网关 + React 前端骨架

### Task 9: Fastify 项目骨架 + 数据库

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/src/config.ts`
- Create: `api/src/db.ts`
- Create: `api/src/index.ts`
- Create: `api/src/redis.ts`

**Goal:** Fastify 服务启动 + PostgreSQL 连接 + 数据库迁移 (tasks/images 表)。

- [ ] **Step 1: 初始化 package.json**

Create `api/package.json`:
```json
{
  "name": "docparse-api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^5.1.0",
    "@fastify/multipart": "^9.0.3",
    "@fastify/cors": "^10.0.1",
    "@fastify/rate-limit": "^10.2.0",
    "@grpc/grpc-js": "^1.12.2",
    "@grpc/proto-loader": "^0.7.13",
    "pg": "^8.13.1",
    "ioredis": "^5.4.1",
    "node-cron": "^3.0.3",
    "env-schema": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/pg": "^8.11.10",
    "typescript": "^5.6.3",
    "tsx": "^4.19.2",
    "vitest": "^2.1.5",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

Create `api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 config.ts**

Create `api/src/config.ts`:
```typescript
import envSchema from 'env-schema';

const schema = {
  type: 'object',
  required: ['DATABASE_URL', 'GRPC_PARSER_HOST'],
  properties: {
    PORT: { type: 'number', default: 3000 },
    HOST: { type: 'string', default: '0.0.0.0' },
    DATABASE_URL: { type: 'string' },
    REDIS_URL: { type: 'string', default: 'redis://localhost:6379' },
    GRPC_PARSER_HOST: { type: 'string' },
    MAX_FILE_SIZE: { type: 'number', default: 104857600 },
    FILE_RETENTION_HOURS: { type: 'number', default: 24 },
  },
};

export const config = envSchema({ schema, dotenv: true });
```

- [ ] **Step 4: 创建 db.ts**

Create `api/src/db.ts`:
```typescript
import pg from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE task_status AS ENUM ('queued', 'parsing', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename VARCHAR(512) NOT NULL,
        file_size BIGINT NOT NULL,
        file_sha256 CHAR(64) NOT NULL,
        mime_type VARCHAR(128) NOT NULL,
        status task_status NOT NULL DEFAULT 'queued',
        options JSONB DEFAULT '{}',
        markdown TEXT,
        total_pages INT,
        confidence REAL,
        error_message TEXT,
        file_ref_count INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
        page_number INT NOT NULL,
        image_index INT NOT NULL,
        alt_text VARCHAR(512),
        file_path VARCHAR(1024) NOT NULL,
        width INT,
        height INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_sha256 ON tasks(file_sha256);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_images_task_id ON images(task_id);
    `);
    console.log('Database migration complete');
  } finally {
    client.release();
  }
}

export { pool as db };
```

- [ ] **Step 5: 创建 index.ts 启动服务**

Create `api/src/index.ts`:
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { migrate } from './db.js';
import { documentsRoutes } from './routes/documents.js';
import { formatsRoutes } from './routes/formats.js';

async function main() {
  await migrate();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(documentsRoutes, { prefix: '/api/v1' });
  await app.register(formatsRoutes, { prefix: '/api/v1' });

  app.get('/health', async () => ({ status: 'ok' }));

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Fastify server running on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 6: 创建占位路由文件**

Create `api/src/routes/documents.ts`:
```typescript
import { FastifyPluginAsync } from 'fastify';

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents/:id', async (request, reply) => {
    return { status: 'not implemented' };
  });
};
```

Create `api/src/routes/formats.ts`:
```typescript
import { FastifyPluginAsync } from 'fastify';

export const formatsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/formats', async () => {
    return { mime_types: [] };
  });
};
```

Create `api/src/redis.ts`:
```typescript
import Redis from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL);
```

- [ ] **Step 7: 安装依赖并验证服务启动**

Run: `cd api && npm install`
Run: `cd api && npx tsx src/index.ts` (should start and log, then Ctrl+C)

- [ ] **Step 8: Commit**

```bash
cd /Users/plus7/program/docparse && git add api/ && git commit -m "feat(api): add Fastify project skeleton with PostgreSQL migration"
```

---

### Task 10: gRPC 客户端

**Files:**
- Create: `api/src/services/grpc-client.ts`
- Create: `api/src/proto/document_parser.proto` (复制)
- Create: `api/tests/services/grpc-client.test.ts`

**Goal:** Fastify 侧封装 gRPC 客户端，从 proto 文件动态加载。

- [ ] **Step 1: 复制 proto 文件**

```bash
cp /Users/plus7/program/docparse/parser/proto/document_parser.proto /Users/plus7/program/docparse/api/src/proto/document_parser.proto
```

- [ ] **Step 2: 编写 gRPC 客户端**

Create `api/src/services/grpc-client.ts`:
```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'document_parser.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition) as any;
const client = new proto.docparse.DocumentParser(
  config.GRPC_PARSER_HOST,
  grpc.credentials.createInsecure(),
  { 'grpc.max_receive_message_length': 100 * 1024 * 1024 }
);

export interface ParseRequest {
  fileContent: Buffer;
  filename: string;
  taskId: string;
  options: {
    extractImages: boolean;
    extractTables: boolean;
    maxPages: number;
    outputStyle: string;
  };
}

export interface ParseChunk {
  pageNumber: number;
  totalPages: number;
  markdown: string;
  images: Array<{ index: number; imageId: string; altText: string; width: number; height: number }>;
  confidence: number;
  isComplete: boolean;
}

export function parseStream(request: ParseRequest): AsyncIterable<ParseChunk> {
  const grpcRequest = {
    file_content: request.fileContent,
    filename: request.filename,
    task_id: request.taskId,
    options: {
      extract_images: request.options.extractImages,
      extract_tables: request.options.extractTables,
      max_pages: request.options.maxPages,
      output_style: request.options.outputStyle,
    },
  };

  const call = client.Parse(grpcRequest);

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<ParseChunk>> {
          return new Promise((resolve, reject) => {
            call.once('data', (chunk: any) => {
              resolve({
                done: false,
                value: {
                  pageNumber: chunk.page_number,
                  totalPages: chunk.total_pages,
                  markdown: chunk.markdown,
                  images: (chunk.images || []).map((img: any) => ({
                    index: img.index,
                    imageId: img.image_id,
                    altText: img.alt_text,
                    width: img.width,
                    height: img.height,
                  })),
                  confidence: chunk.confidence,
                  isComplete: chunk.is_complete,
                },
              });
            });
            call.once('end', () => resolve({ done: true, value: undefined }));
            call.once('error', (err: Error) => reject(err));
          });
        },
        return(): Promise<IteratorResult<ParseChunk>> {
          call.cancel();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

export function getSupportedFormats(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    client.GetSupportedFormats({}, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response.mime_types || []);
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/plus7/program/docparse && git add api/src/proto/ api/src/services/grpc-client.ts && git commit -m "feat(api): add gRPC client with streaming Parse and GetSupportedFormats"
```

---

### Task 11: 上传 API + 文件存储 + 去重

**Files:**
- Create: `api/src/services/file-store.ts`
- Modify: `api/src/routes/documents.ts`
- Create: `api/tests/helpers/setup.ts`
- Create: `api/tests/routes/documents.test.ts`
- Create: `api/tests/services/file-store.test.ts`

**Goal:** 实现 POST /documents 上传逻辑：校验 → SHA256 去重 → 存储 → 插任务 → 返回 202。

- [ ] **Step 1: 编写文件存储服务**

Create `api/src/services/file-store.ts`:
```typescript
import { createHash } from 'crypto';
import { writeFile, mkdir, unlink, access } from 'fs/promises';
import { join } from 'path';

const FILES_DIR = process.env.FILES_DIR || '/data/files';

export class FileStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || FILES_DIR;
  }

  sha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  getPath(sha256: string): string {
    const prefix = sha256.slice(0, 2);
    return join(this.baseDir, prefix, sha256);
  }

  async save(content: Buffer): Promise<string> {
    const hash = this.sha256(content);
    const filePath = this.getPath(hash);
    const dir = join(this.baseDir, hash.slice(0, 2));
    await mkdir(dir, { recursive: true });
    try {
      await access(filePath);
    } catch {
      await writeFile(filePath, content);
    }
    return hash;
  }

  async delete(sha256: string): Promise<void> {
    const filePath = this.getPath(sha256);
    try {
      await unlink(filePath);
    } catch {}
  }

  async exists(sha256: string): Promise<boolean> {
    try {
      await access(this.getPath(sha256));
      return true;
    } catch {
      return false;
    }
  }
}

export const fileStore = new FileStore();
```

- [ ] **Step 2: 编写文件存储测试**

Create `api/tests/services/file-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../../src/services/file-store.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileStore', () => {
  let store: FileStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docparse-test-'));
    store = new FileStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves file and returns sha256', async () => {
    const content = Buffer.from('hello world');
    const hash = await store.save(content);
    expect(hash).toBe(store.sha256(content));
    expect(await store.exists(hash)).toBe(true);
  });

  it('deduplicates by sha256', async () => {
    const content = Buffer.from('same content');
    const hash1 = await store.save(content);
    const hash2 = await store.save(content);
    expect(hash1).toBe(hash2);
  });

  it('deletes file', async () => {
    const content = Buffer.from('temporary');
    const hash = await store.save(content);
    await store.delete(hash);
    expect(await store.exists(hash)).toBe(false);
  });
});
```

Run: `cd api && npx vitest run tests/services/file-store.test.ts`
Expected: PASS.

- [ ] **Step 3: 实现上传路由**

Modify `api/src/routes/documents.ts`:
```typescript
import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { fileStore } from '../services/file-store.js';
import { parseStream } from '../services/grpc-client.js';

const ALLOWED_MIMES = new Set([
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const MIME_TO_EXT: Record<string, string> = {
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

function detectMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    txt: 'text/plain',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext || ''] || 'application/octet-stream';
}

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/documents', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const content = await data.toBuffer();
    if (content.length === 0) {
      return reply.status(400).send({ error: 'Empty file' });
    }

    const mimeType = detectMime(data.filename);
    if (!ALLOWED_MIMES.has(mimeType)) {
      return reply.status(400).send({ error: `Unsupported format: ${mimeType}` });
    }

    const sha256 = await fileStore.save(content);

    const { rows: existing } = await db.query(
      `SELECT id, markdown, total_pages, confidence, file_ref_count
       FROM tasks WHERE file_sha256 = $1 AND status = 'completed' LIMIT 1`,
      [sha256]
    );

    if (existing.length > 0) {
      const task = existing[0];
      await db.query(`UPDATE tasks SET file_ref_count = file_ref_count + 1 WHERE id = $1`, [task.id]);
      return reply.status(200).send({
        task_id: task.id,
        status: 'completed',
        markdown: task.markdown,
        total_pages: task.total_pages,
        confidence: task.confidence,
        cached: true,
      });
    }

    const { rows: [task] } = await db.query(
      `INSERT INTO tasks (filename, file_size, file_sha256, mime_type, status, options)
       VALUES ($1, $2, $3, $4, 'queued', '{}'::jsonb)
       RETURNING id`,
      [data.filename, content.length, sha256, mimeType]
    );

    setImmediate(async () => {
      try {
        await db.query(`UPDATE tasks SET status = 'parsing' WHERE id = $1`, [task.id]);
        let fullMarkdown = '';
        for await (const chunk of parseStream({
          fileContent: content,
          filename: data.filename,
          taskId: task.id,
          options: { extractImages: true, extractTables: true, maxPages: 0, outputStyle: 'github' },
        })) {
          fullMarkdown += chunk.markdown;
        }
        const totalPages = fullMarkdown ? Math.ceil(fullMarkdown.length / 5000) : 1;
        await db.query(
          `UPDATE tasks SET status = 'completed', markdown = $1, total_pages = $2, confidence = $3, updated_at = NOW()
           WHERE id = $4`,
          [fullMarkdown, totalPages, 0.85, task.id]
        );
      } catch (err: any) {
        await db.query(
          `UPDATE tasks SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        );
      }
    });

    return reply.status(202).send({ task_id: task.id, status: 'queued' });
  });

  app.get('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(
      `SELECT id, filename, file_size, mime_type, status, markdown, total_pages, confidence, error_message, created_at, updated_at
       FROM tasks WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Task not found' });
    return rows[0];
  });

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`SELECT file_sha256, file_ref_count FROM tasks WHERE id = $1`, [id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Task not found' });

    const task = rows[0];
    if (task.file_ref_count <= 1) {
      await fileStore.delete(task.file_sha256);
      await db.query(`DELETE FROM tasks WHERE id = $1`, [id]);
    } else {
      await db.query(`UPDATE tasks SET file_ref_count = file_ref_count - 1 WHERE id = $1`, [id]);
    }
    return { deleted: true };
  });

  app.get('/documents/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`SELECT markdown, filename FROM tasks WHERE id = $1 AND status = 'completed'`, [id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Not found or not completed' });
    const mdName = rows[0].filename.replace(/\.[^.]+$/, '.md');
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${mdName}"`);
    return rows[0].markdown;
  });
};
```

- [ ] **Step 4: 编写上传 API 测试**

Create `api/tests/helpers/setup.ts`:
```typescript
import pg from 'pg';
import { config } from '../../src/config.js';
import { migrate } from '../../src/db.js';

export async function setupTestDb() {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  await pool.query(`DROP TABLE IF EXISTS images CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS tasks CASCADE`);
  await pool.query(`DROP TYPE IF EXISTS task_status CASCADE`);
  await pool.end();
  await migrate();
}
```

Create `api/tests/routes/documents.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { documentsRoutes } from '../../src/routes/documents.js';
import { setupTestDb } from '../helpers/setup.js';

describe('POST /api/v1/documents', () => {
  const app = Fastify();

  beforeAll(async () => {
    await setupTestDb();
    await app.register(multipart);
    await app.register(documentsRoutes);
    await app.ready();
  });

  it('rejects empty upload', async () => {
    const response = await app.inject({ method: 'POST', url: '/documents' });
    expect(response.statusCode).toBe(400);
  });

  it('accepts txt upload and returns 202 with task_id', async () => {
    const FormData = (await import('formdata-node')).FormData;
    const { Blob } = await import('buffer');
    const form = new FormData();
    form.set('file', new Blob(['hello world']), 'test.txt');

    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const chunks: Buffer[] = [];
    for (const [key, value] of form as any) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.name || 'test.txt'}"\r\nContent-Type: text/plain\r\n\r\n`));
      chunks.push(Buffer.from(typeof value === 'string' ? value : 'hello world'));
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const response = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(response.statusCode).toBe(202);
    const json = JSON.parse(response.body);
    expect(json.task_id).toBeDefined();
    expect(json.status).toBe('queued');
  });

  it('gets task by id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `cd api && npx vitest run tests/routes/documents.test.ts`
Expected: PASS (3 tests).

> **注意**：POST test 需要同步 gRPC server 或 mock；如果 gRPC server 不可用，第二个测试可能超时失败。可以先跳过或在 CI 中集成。

- [ ] **Step 6: Commit**

```bash
cd /Users/plus7/program/docparse && git add api/src/services/file-store.ts api/src/routes/documents.ts api/tests/ && git commit -m "feat(api): add upload API with SHA256 dedup, file store, and task CRUD"
```

---

### Task 12: SSE 流式推送

**Files:**
- Modify: `api/src/routes/documents.ts` (添加 SSE 端点)
- Create: `api/src/services/sse-manager.ts`

**Goal:** 实现 GET /documents/:id/stream SSE 端点，解析时实时推送进度和 Markdown 片段。

- [ ] **Step 1: 编写 SSE 管理器**

Create `api/src/services/sse-manager.ts`:
```typescript
import { EventEmitter } from 'events';

interface SSEEvent {
  taskId: string;
  event: 'progress' | 'chunk' | 'complete' | 'error';
  data: Record<string, unknown>;
}

class SSEManager extends EventEmitter {
  private static instance: SSEManager;

  static getInstance(): SSEManager {
    if (!SSEManager.instance) {
      SSEManager.instance = new SSEManager();
    }
    return SSEManager.instance;
  }

  emitProgress(taskId: string, data: { page: number; total: number; confidence: number }) {
    this.emit('event', { taskId, event: 'progress', data } as SSEEvent);
  }

  emitChunk(taskId: string, data: { page: number; markdown: string }) {
    this.emit('event', { taskId, event: 'chunk', data } as SSEEvent);
  }

  emitComplete(taskId: string, data: { totalPages: number; overallConfidence: number }) {
    this.emit('event', { taskId, event: 'complete', data } as SSEEvent);
  }

  emitError(taskId: string, data: { code: string; message: string }) {
    this.emit('event', { taskId, event: 'error', data } as SSEEvent);
  }
}

export const sseManager = SSEManager.getInstance();
```

- [ ] **Step 2: 添加 SSE 路由**

Add this route to `api/src/routes/documents.ts` inside the plugin function:

```typescript
  app.get('/documents/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };

    const { rows } = await db.query(`SELECT status, markdown FROM tasks WHERE id = $1`, [id]);
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const task = rows[0];
    if (task.status === 'completed') {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.write(`event: complete\ndata: ${JSON.stringify({ markdown: task.markdown, cached: true })}\n\n`);
      reply.raw.end();
      return;
    }

    if (task.status === 'failed') {
      return reply.status(410).send({ error: 'Task failed' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const onEvent = (evt: any) => {
      if (evt.taskId === id) {
        reply.raw.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
        if (evt.event === 'complete' || evt.event === 'error') {
          sseManager.off('event', onEvent);
          reply.raw.end();
        }
      }
    };

    sseManager.on('event', onEvent);

    request.raw.on('close', () => {
      sseManager.off('event', onEvent);
    });
  });
```

- [ ] **Step 3: 在解析流程中接入 SSE**

Modify the `setImmediate` block in `documents.ts` POST handler, add SSE events:

```typescript
    setImmediate(async () => {
      try {
        await db.query(`UPDATE tasks SET status = 'parsing' WHERE id = $1`, [task.id]);
        let fullMarkdown = '';
        let pageNum = 0;
        let lastConfidence = 0;
        for await (const chunk of parseStream({
          fileContent: content,
          filename: data.filename,
          taskId: task.id,
          options: { extractImages: true, extractTables: true, maxPages: 0, outputStyle: 'github' },
        })) {
          pageNum = chunk.pageNumber;
          lastConfidence = chunk.confidence;
          fullMarkdown += chunk.markdown;
          sseManager.emitProgress(task.id, {
            page: chunk.pageNumber,
            total: chunk.totalPages,
            confidence: chunk.confidence,
          });
          sseManager.emitChunk(task.id, {
            page: chunk.pageNumber,
            markdown: chunk.markdown,
          });
        }
        sseManager.emitComplete(task.id, {
          totalPages: pageNum,
          overallConfidence: lastConfidence,
        });
        const totalPages = pageNum || 1;
        await db.query(
          `UPDATE tasks SET status = 'completed', markdown = $1, total_pages = $2, confidence = $3, updated_at = NOW()
           WHERE id = $4`,
          [fullMarkdown, totalPages, lastConfidence, task.id]
        );
      } catch (err: any) {
        sseManager.emitError(task.id, { code: 'PARSE_FAILED', message: err.message });
        await db.query(
          `UPDATE tasks SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        );
      }
    });
```

- [ ] **Step 4: Commit**

```bash
cd /Users/plus7/program/docparse && git add api/src/services/sse-manager.ts api/src/routes/documents.ts && git commit -m "feat(api): add SSE streaming endpoint for real-time parse progress"
```

---

### Task 13: React 项目骨架

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/App.css`
- Create: `web/src/types/index.ts`
- Create: `web/src/context/AppContext.tsx`
- Create: `web/src/hooks/useApi.ts`

**Goal:** Vite + React + TypeScript 项目启动，基础布局框架。

- [ ] **Step 1: 初始化 package.json**

Create `web/package.json`:
```json
{
  "name": "docparse-web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "react-dropzone": "^14.3.5",
    "highlight.js": "^11.10.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^6.0.0",
    "vitest": "^2.1.5",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.6.3",
    "jsdom": "^25.0.1"
  }
}
```

- [ ] **Step 2: 创建配置文件**

Create `web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

Create `web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

Create `web/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DocParse - 文档解析</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 创建类型和状态管理**

Create `web/src/types/index.ts`:
```typescript
export type TaskStatus = 'queued' | 'parsing' | 'completed' | 'failed';

export interface Task {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  status: TaskStatus;
  progress: { page: number; total: number };
  totalPages?: number;
  confidence: number;
  markdown: string;
  images: ImageMeta[];
  error?: string;
  createdAt: string;
  cached?: boolean;
}

export interface ImageMeta {
  index: number;
  imageId: string;
  altText: string;
  width: number;
  height: number;
}

export type AppAction =
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'UPDATE_TASK'; id: string; updates: Partial<Task> }
  | { type: 'APPEND_MARKDOWN'; id: string; markdown: string }
  | { type: 'SET_CURRENT_TASK'; id: string }
  | { type: 'SET_PROGRESS'; id: string; progress: { page: number; total: number }; confidence: number };

export interface AppState {
  tasks: Task[];
  currentTaskId: string | null;
}
```

Create `web/src/context/AppContext.tsx`:
```typescript
import { createContext, useContext, useReducer, ReactNode } from 'react';
import type { AppState, AppAction, Task } from '../types';

const initialState: AppState = { tasks: [], currentTaskId: null };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks], currentTaskId: action.task.id };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id === action.id ? { ...t, ...action.updates } : t),
      };
    case 'APPEND_MARKDOWN':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.id ? { ...t, markdown: t.markdown + action.markdown } : t
        ),
      };
    case 'SET_CURRENT_TASK':
      return { ...state, currentTaskId: action.id };
    case 'SET_PROGRESS':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.id ? { ...t, progress: action.progress, confidence: action.confidence } : t
        ),
      };
    default:
      return state;
  }
}

const AppCtx = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppCtx.Provider value={{ state, dispatch }}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
```

- [ ] **Step 4: 创建 API hook**

Create `web/src/hooks/useApi.ts`:
```typescript
const API_BASE = '/api/v1';

export async function uploadDocument(file: File): Promise<{ task_id: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/documents`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function getTask(id: string) {
  const res = await fetch(`${API_BASE}/documents/${id}`);
  if (!res.ok) throw new Error('Task not found');
  return res.json();
}

export function createParseStream(taskId: string): EventSource {
  return new EventSource(`${API_BASE}/documents/${taskId}/stream`);
}

export async function downloadMarkdown(taskId: string, filename: string) {
  const res = await fetch(`${API_BASE}/documents/${taskId}/download`);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.[^.]+$/, '.md');
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: 创建 App 主组件**

Create `web/src/main.tsx`:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';
import './App.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
```

Create `web/src/App.tsx`:
```typescript
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import MainPanel from './components/MainPanel';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UploadZone />
      <MainPanel />
    </div>
  );
}
```

Create `web/src/App.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }

.app {
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  background: #f8f9fa;
}
```

- [ ] **Step 6: 创建占位组件**

Create placeholder components so the app compiles:

Create `web/src/components/Header.tsx`:
```tsx
export default function Header() {
  return (
    <header style={{ padding: '16px 24px', borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700 }}>DocParse</h1>
      <span style={{ color: '#666', fontSize: '14px' }}>文档结构化解析 — 支持 TXT / DOCX / PDF / PPTX</span>
    </header>
  );
}
```

Create `web/src/components/UploadZone.tsx`:
```tsx
export default function UploadZone() {
  return <div style={{ padding: '24px', textAlign: 'center' }}>Upload Zone (placeholder)</div>;
}
```

Create `web/src/components/MainPanel.tsx`:
```tsx
import HistorySidebar from './HistorySidebar';
import PreviewPane from './PreviewPane';

export default function MainPanel() {
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      <HistorySidebar />
      <PreviewPane />
    </div>
  );
}
```

Create `web/src/components/HistorySidebar.tsx`:
```tsx
export default function HistorySidebar() {
  return <aside style={{ width: 280, borderRight: '1px solid #e0e0e0', padding: 16 }}>History (placeholder)</aside>;
}
```

Create `web/src/components/PreviewPane.tsx`:
```tsx
export default function PreviewPane() {
  return <main style={{ flex: 1, padding: 24 }}>Select a file to preview</main>;
}
```

- [ ] **Step 7: 安装依赖并启动验证**

Run: `cd web && npm install`
Run: `cd web && npm run dev` → 浏览器打开 localhost:5173，确认页面渲染。

- [ ] **Step 8: Commit**

```bash
cd /Users/plus7/program/docparse && git add web/ && git commit -m "feat(web): add React project skeleton with Vite, types, context, and placeholder components"
```

---

### Task 14: UploadZone + SSE Hook

**Files:**
- Modify: `web/src/components/UploadZone.tsx`
- Create: `web/src/components/ParseOptions.tsx`
- Create: `web/src/hooks/useParseStream.ts`

**Goal:** 实现拖拽上传 + 发起解析请求 + SSE 实时接收。

- [ ] **Step 1: 创建 useParseStream hook**

Create `web/src/hooks/useParseStream.ts`:
```typescript
import { useEffect, useRef } from 'react';
import { useAppState } from '../context/AppContext';
import { createParseStream } from './useApi';

export function useParseStream(taskId: string | null) {
  const { dispatch } = useAppState();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const es = createParseStream(taskId);
    esRef.current = es;

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      dispatch({ type: 'SET_PROGRESS', id: taskId, progress: { page: data.page, total: data.total }, confidence: data.confidence });
      dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'parsing' } });
    });

    es.addEventListener('chunk', (e) => {
      const data = JSON.parse(e.data);
      dispatch({ type: 'APPEND_MARKDOWN', id: taskId, markdown: data.markdown });
    });

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.cached) {
        dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'completed', markdown: data.markdown } });
      } else {
        dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'completed', confidence: data.overallConfidence, totalPages: data.totalPages } });
      }
      es.close();
    });

    es.addEventListener('error', () => {
      dispatch({ type: 'UPDATE_TASK', id: taskId, updates: { status: 'failed', error: 'Connection lost' } });
      es.close();
    });

    return () => { es.close(); };
  }, [taskId]);

  return esRef;
}
```

- [ ] **Step 2: 实现 UploadZone 组件**

Modify `web/src/components/UploadZone.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppState } from '../context/AppContext';
import { uploadDocument } from '../hooks/useApi';
import { useParseStream } from '../hooks/useParseStream';
import ParseOptions from './ParseOptions';

export default function UploadZone() {
  const { dispatch, state } = useAppState();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  useParseStream(activeTaskId);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setUploading(true);
    setError(null);

    try {
      const result = await uploadDocument(file);
      const task = {
        id: result.task_id,
        filename: file.name,
        fileSize: file.size,
        mimeType: '',
        status: result.status as any,
        progress: { page: 0, total: 0 },
        confidence: 0,
        markdown: '',
        images: [],
        createdAt: new Date().toISOString(),
        cached: (result as any).cached,
      };
      dispatch({ type: 'ADD_TASK', task });
      setActiveTaskId(result.task_id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [dispatch]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 104857600,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    },
  });

  const style: React.CSSProperties = {
    border: `2px dashed ${isDragActive ? '#4a90d9' : '#ccc'}`,
    borderRadius: 12,
    padding: '40px 24px',
    textAlign: 'center',
    background: isDragActive ? '#f0f7ff' : '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    margin: '24px',
  };

  return (
    <div>
      <div {...getRootProps()} style={style}>
        <input {...getInputProps()} />
        {uploading ? (
          <p>正在上传...</p>
        ) : isDragActive ? (
          <p>放开以上传文件</p>
        ) : (
          <div>
            <p style={{ fontSize: 18, fontWeight: 600 }}>拖拽文件到此处，或点击选择</p>
            <p style={{ color: '#888', marginTop: 8 }}>支持 TXT / DOCX / PDF / PPTX，最大 100MB</p>
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button onClick={() => setShowOptions(!showOptions)} style={{ border: 'none', background: 'none', color: '#4a90d9', cursor: 'pointer', fontSize: 14 }}>
          {showOptions ? '收起' : '展开'}解析选项 ▾
        </button>
      </div>
      {showOptions && <ParseOptions />}
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 实现 ParseOptions 组件**

Create `web/src/components/ParseOptions.tsx`:
```tsx
export default function ParseOptions() {
  return (
    <div style={{ maxWidth: 400, margin: '0 auto 24px', padding: 16, background: '#fff', borderRadius: 8, border: '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="checkbox" defaultChecked /> 提取图片
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="checkbox" defaultChecked /> 识别表格
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>页数限制:</span>
        <input type="number" defaultValue={0} min={0} style={{ width: 80, padding: '4px 8px' }} />
        <span style={{ color: '#888', fontSize: 12 }}>(0 = 无限制)</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/plus7/program/docparse && git add web/src/components/UploadZone.tsx web/src/components/ParseOptions.tsx web/src/hooks/useParseStream.ts && git commit -m "feat(web): add drag-drop upload with SSE streaming hook"
```

---

### Task 15: MarkdownRenderer + PreviewPane + HistorySidebar

**Files:**
- Modify: `web/src/components/MarkdownRenderer.tsx`
- Modify: `web/src/components/PreviewPane.tsx`
- Modify: `web/src/components/HistorySidebar.tsx`
- Create: `web/src/components/StatusBar.tsx`
- Create: `web/src/components/DownloadButton.tsx`

**Goal:** 实现 Markdown 渲染预览、历史列表、状态栏。

- [ ] **Step 1: 实现 MarkdownRenderer**

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Props {
  content: string;
  lowConfidencePages?: number[];
}

export default function MarkdownRenderer({ content, lowConfidencePages }: Props) {
  if (!content) {
    return <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>等待解析结果...</p>;
  }

  return (
    <div className="markdown-body" style={{ padding: 24 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: 实现 StatusBar**

```tsx
import { useAppState } from '../context/AppContext';

export default function StatusBar() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);

  if (!task) return null;

  const { status, progress, confidence } = task;

  if (status === 'completed') {
    return (
      <div style={{ padding: '8px 24px', background: '#e8f5e9', fontSize: 14, display: 'flex', gap: 16 }}>
        <span>解析完成</span>
        {confidence > 0 && <span>整体置信度: {(confidence * 100).toFixed(0)}%</span>}
      </div>
    );
  }

  if (status === 'parsing') {
    const pct = progress.total > 0 ? Math.round((progress.page / progress.total) * 100) : 0;
    return (
      <div style={{ padding: '8px 24px', background: '#fff3e0', fontSize: 14 }}>
        <span>解析中: {progress.page}/{progress.total} 页 ({pct}%)</span>
        <div style={{ background: '#eee', borderRadius: 4, height: 4, marginTop: 6 }}>
          <div style={{ width: `${pct}%`, background: '#4a90d9', height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div style={{ padding: '8px 24px', background: '#ffebee', fontSize: 14, color: '#c62828' }}>
        解析失败: {task.error || '未知错误'}
      </div>
    );
  }

  if (status === 'queued') {
    return (
      <div style={{ padding: '8px 24px', background: '#e3f2fd', fontSize: 14 }}>
        排队中...
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 3: 实现 DownloadButton**

```tsx
import { useAppState } from '../context/AppContext';
import { downloadMarkdown } from '../hooks/useApi';

export default function DownloadButton() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);

  if (!task || task.status !== 'completed' || !task.markdown) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(task.markdown);
    alert('Markdown 已复制到剪贴板');
  };

  return (
    <div style={{ padding: '8px 24px', display: 'flex', gap: 12, borderBottom: '1px solid #eee' }}>
      <button onClick={handleCopy} style={btnStyle}>复制 Markdown</button>
      <button onClick={() => downloadMarkdown(task.id, task.filename)} style={btnStyle}>下载 .md</button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px',
  border: '1px solid #4a90d9',
  borderRadius: 6,
  background: '#fff',
  color: '#4a90d9',
  cursor: 'pointer',
  fontSize: 14,
};
```

- [ ] **Step 4: 实现 PreviewPane**

```tsx
import { useAppState } from '../context/AppContext';
import StatusBar from './StatusBar';
import MarkdownRenderer from './MarkdownRenderer';
import DownloadButton from './DownloadButton';

export default function PreviewPane() {
  const { state } = useAppState();
  const task = state.tasks.find(t => t.id === state.currentTaskId);

  if (!task) {
    return <main style={{ flex: 1, padding: 48, textAlign: 'center', color: '#999' }}>上传一个文件开始解析</main>;
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <StatusBar />
      <DownloadButton />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <MarkdownRenderer content={task.markdown} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: 实现 HistorySidebar**

```tsx
import { useAppState } from '../context/AppContext';

export default function HistorySidebar() {
  const { state, dispatch } = useAppState();

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✓';
      case 'parsing': return '⏳';
      case 'failed': return '✗';
      default: return '○';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#2e7d32';
      case 'parsing': return '#e65100';
      case 'failed': return '#c62828';
      default: return '#999';
    }
  };

  return (
    <aside style={{ width: 280, borderRight: '1px solid #e0e0e0', overflow: 'auto', background: '#fff' }}>
      <h3 style={{ padding: '16px', borderBottom: '1px solid #eee', fontSize: 16 }}>上传历史</h3>
      {state.tasks.length === 0 ? (
        <p style={{ padding: 16, color: '#999', fontSize: 14 }}>暂无记录</p>
      ) : (
        state.tasks.map(task => (
          <div
            key={task.id}
            onClick={() => dispatch({ type: 'SET_CURRENT_TASK', id: task.id })}
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              borderBottom: '1px solid #f0f0f0',
              background: state.currentTaskId === task.id ? '#f0f7ff' : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {task.filename}
              </span>
              <span style={{ color: statusColor(task.status), fontSize: 16 }}>{statusIcon(task.status)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {new Date(task.createdAt).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </aside>
  );
}
```

- [ ] **Step 6: 安装依赖并启动验证**

Run: `cd web && npm install`
Run: `cd web && npm run dev`
Verify all components render.

- [ ] **Step 7: Commit**

```bash
cd /Users/plus7/program/docparse && git add web/src/components/ && git commit -m "feat(web): add Markdown rendering, preview pane, history sidebar, and download button"
```

---

## Phase 3: 完善体验

### Task 16: 图片提取/存储/灯箱

**Files:**
- Create: `web/src/components/ImageViewer.tsx`
- Modify: `api/src/routes/documents.ts` (添加 GET /images/:id)

**Goal:** 解析中提取的图片存储并可通过 API 访问，前端点击查看大图。

- [ ] **Step 1: 添加图片获取 API**

Append to `api/src/routes/documents.ts`:
```typescript
  app.get('/images/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`SELECT file_path, mime_type FROM images WHERE id = $1`, [id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Image not found' });
    const fs = await import('fs/promises');
    const mime = 'image/png';
    const data = await fs.readFile(rows[0].file_path);
    reply.header('Content-Type', mime);
    reply.header('Cache-Control', 'public, max-age=86400');
    return data;
  });
```

- [ ] **Step 2: 实现 ImageViewer 灯箱**

```tsx
import { useState } from 'react';

interface Props {
  images: Array<{ imageId: string; altText: string }>;
}

export default function ImageViewer({ images }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div style={{ padding: '8px 24px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {images.map(img => (
          <img
            key={img.imageId}
            src={`/api/v1/images/${img.imageId}`}
            alt={img.altText}
            onClick={() => setSelected(img.imageId)}
            style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #eee' }}
          />
        ))}
      </div>
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }} onClick={() => setSelected(null)}>
          <img src={`/api/v1/images/${selected}`} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: 在 PreviewPane 中集成 ImageViewer**

Add after StatusBar in PreviewPane:
```tsx
{task.images.length > 0 && <ImageViewer images={task.images} />}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add image extraction API and lightbox viewer"
```

---

### Task 17: 置信度标记 UI + 错误状态

**Files:**
- Modify: `web/src/components/StatusBar.tsx`
- Modify: `web/src/App.css` (添加低置信度样式)

- [ ] **Step 1: 增强 StatusBar 置信度显示**

Modify StatusBar completed section, add confidence color coding:
```tsx
  if (status === 'completed') {
    const confColor = confidence >= 0.8 ? '#2e7d32' : confidence >= 0.6 ? '#e65100' : '#c62828';
    return (
      <div style={{ padding: '8px 24px', background: '#e8f5e9', fontSize: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span>解析完成</span>
        {confidence > 0 && (
          <span style={{ color: confColor }}>
            置信度: {(confidence * 100).toFixed(0)}%
            {confidence < 0.7 && ' (结果可能不准确，请人工核对)'}
          </span>
        )}
      </div>
    );
  }
```

- [ ] **Step 2: 添加 Markdown 渲染中的低置信度视觉提示**

Add CSS to `web/src/App.css`:
```css
.markdown-body {
  font-size: 16px;
  line-height: 1.7;
}

.low-confidence-page {
  border-left: 3px solid #ff9800;
  padding-left: 16px;
  margin: 8px 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): add confidence indicators and low-confidence visual warnings"
```

---

### Task 18: Redis 限流

**Files:**
- Modify: `api/src/index.ts` (注册 rate-limit 插件)

- [ ] **Step 1: 注册限流插件**

Modify `api/src/index.ts`, add rate-limit registration:
```typescript
import rateLimit from '@fastify/rate-limit';

// inside main(), before routes
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: redis,
  keyGenerator: (request) => request.ip,
});
```

- [ ] **Step 2: Commit**

```bash
git add api/src/index.ts && git commit -m "feat(api): add Redis-based rate limiting (100 req/min)"
```

---

## Phase 4: 部署和文档

### Task 19: Dockerfile × 3

**Files:**
- Create: `parser/Dockerfile`
- Create: `api/Dockerfile`
- Create: `web/Dockerfile`

- [ ] **Step 1: Python parser Dockerfile**

Create `parser/Dockerfile`:
```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY proto/ proto/
COPY src/ src/
RUN python -m grpc_tools.protoc -I./proto --python_out=./src --grpc_python_out=./src ./proto/document_parser.proto && \
    sed -i 's/import document_parser_pb2/from . import document_parser_pb2/' src/document_parser_pb2_grpc.py

RUN mkdir -p /data/files /data/images /models

ENV GRPC_PORT=50051
ENV MAX_WORKERS=4

EXPOSE 50051
CMD ["python", "-m", "src.server"]
```

- [ ] **Step 2: Fastify API Dockerfile**

Create `api/Dockerfile`:
```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json .
COPY src/ src/
RUN npm run build

RUN mkdir -p /data/files /data/images

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: React Web Dockerfile (multi-stage)**

Create `web/Dockerfile`:
```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 4: Commit**

```bash
git add parser/Dockerfile api/Dockerfile web/Dockerfile && git commit -m "feat: add Dockerfiles for parser, api, and web services"
```

---

### Task 20: docker-compose.yml + Nginx 配置

**Files:**
- Create: `docker-compose.yml`
- Create: `config/nginx.conf`
- Create: `config/fastify.env`
- Create: `config/parser.env`
- Create: `Makefile`

- [ ] **Step 1: 创建 docker-compose.yml**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: docparse
      POSTGRES_USER: docparse
      POSTGRES_PASSWORD: password
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U docparse"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5

  parser:
    build: ./parser
    environment:
      GRPC_PORT: "50051"
      MAX_WORKERS: "4"
    volumes:
      - ./data/files:/data/files
      - ./data/images:/data/images
      - docling_models:/models
    healthcheck:
      test: ["CMD", "grpc_health_probe", "-addr=:50051"]
      interval: 10s
      retries: 5
    depends_on:
      postgres:
        condition: service_healthy

  api:
    build: ./api
    environment:
      PORT: "3000"
      DATABASE_URL: postgresql://docparse:password@postgres:5432/docparse
      REDIS_URL: redis://redis:6379
      GRPC_PARSER_HOST: parser:50051
      MAX_FILE_SIZE: "104857600"
      FILE_RETENTION_HOURS: "24"
    volumes:
      - ./data/files:/data/files
      - ./data/images:/data/images
    depends_on:
      postgres:
        condition: service_healthy
      parser:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 10s
      retries: 5

  nginx:
    build: ./web
    ports:
      - "8080:80"
    volumes:
      - ./config/nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - api

volumes:
  docling_models:
```

- [ ] **Step 2: 创建 Nginx 配置**

Create `config/nginx.conf`:
```nginx
server {
    listen 80;
    server_name localhost;
    client_max_body_size 100m;

    location /api/ {
        proxy_pass http://api:3000;
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        root /usr/share/nginx/html;
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 3: 创建环境变量文件**

Create `config/fastify.env`:
```
PORT=3000
DATABASE_URL=postgresql://docparse:password@postgres:5432/docparse
REDIS_URL=redis://redis:6379
GRPC_PARSER_HOST=parser:50051
MAX_FILE_SIZE=104857600
FILE_RETENTION_HOURS=24
```

Create `config/parser.env`:
```
GRPC_PORT=50051
MAX_WORKERS=4
PYMUPDOC_FALLBACK=true
```

- [ ] **Step 4: 创建项目级 Makefile**

```makefile
.PHONY: up down build test logs clean

up:
	docker-compose up -d

down:
	docker-compose down

build:
	docker-compose build

test:
	cd parser && python -m pytest tests/ -v
	cd api && npx vitest run
	cd web && npx vitest run

logs:
	docker-compose logs -f

clean:
	docker-compose down -v
	rm -rf data/files/* data/images/*
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml config/ Makefile && git commit -m "feat: add Docker Compose orchestration, Nginx config, and project Makefile"
```

---

### Task 21: 定时清理 + 健康检查完善

**Files:**
- Create: `api/src/cron/cleanup.ts`
- Modify: `api/src/index.ts` (启用 cron)

- [ ] **Step 1: 实现清理 cron**

Create `api/src/cron/cleanup.ts`:
```typescript
import cron from 'node-cron';
import { db } from '../db.js';
import { fileStore } from '../services/file-store.js';
import { config } from '../config.js';

export function startCleanupCron() {
  cron.schedule('0 */6 * * *', async () => {
    console.log('Running cleanup cron...');
    const cutoff = new Date(Date.now() - config.FILE_RETENTION_HOURS * 3600 * 1000);
    const { rows } = await db.query(
      `SELECT id, file_sha256, file_ref_count FROM tasks WHERE status = 'completed' AND created_at < $1`,
      [cutoff]
    );
    for (const task of rows) {
      if (task.file_ref_count <= 1) {
        await fileStore.delete(task.file_sha256);
        await db.query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
      } else {
        await db.query(`UPDATE tasks SET file_ref_count = file_ref_count - 1 WHERE id = $1`, [task.id]);
      }
    }
    console.log(`Cleaned up ${rows.length} expired tasks`);
  });
}
```

- [ ] **Step 2: 在 index.ts 中启用**

Add to `api/src/index.ts` main():
```typescript
import { startCleanupCron } from './cron/cleanup.js';
startCleanupCron();
```

- [ ] **Step 3: Commit**

```bash
git add api/src/cron/ api/src/index.ts && git commit -m "feat(api): add scheduled cleanup cron for expired files"
```

---

### Task 22: 文档 + 性能基准

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README.md**

Create `README.md`:
```markdown
# DocParse — 文档结构化解析服务

将 TXT / DOCX / PDF / PPTX 文件解析为结构化 Markdown 的 Web 服务。

## 快速开始

```bash
# 启动所有服务
make up

# 访问 http://localhost:8080

# 停止
make down
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
# 启动 Python 解析服务
cd parser && make run

# 启动 Fastify API
cd api && npm run dev

# 启动 React 前端
cd web && npm run dev
```

## 测试

```bash
make test
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: add README with quick start and API reference"
```

---

### Task 23: 端到端验证

**Goal:** 全量测试 + Docker Compose 启动验证。

- [ ] **Step 1: 运行所有单元测试**

```bash
cd parser && python -m pytest tests/ -v
cd api && npx vitest run
cd web && npx vitest run
```

- [ ] **Step 2: 构建并启动 Docker Compose**

```bash
docker-compose build
docker-compose up -d
docker-compose ps  # 确认 5 个服务全部 healthy
```

- [ ] **Step 3: 验证 SSE 端点**

```bash
# 上传测试文件
curl -F "file=@parser/tests/fixtures/sample.txt" http://localhost:8080/api/v1/documents
# 复制返回的 task_id

# SSE 流式获取
curl -N http://localhost:8080/api/v1/documents/<task_id>/stream
```

- [ ] **Step 4: 清理**

```bash
make down
```

- [ ] **Step 5: 最终提交**

```bash
git add -A && git commit -m "chore: final integration checks and cleanup"
```
