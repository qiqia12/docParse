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

    def parse(
        self, file_bytes: bytes, filename: str, options: ParseOptions
    ) -> Iterator[ParseChunk]:
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
            end = (
                min(start + page_size, len(markdown))
                if page_num < total_pages - 1
                else len(markdown)
            )
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
