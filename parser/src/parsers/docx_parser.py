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
        result = md.convert_stream(BytesIO(file_bytes), file_extension=".docx")
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
