from typing import Iterator

import chardet

from ..base_parser import BaseParser
from ..models import ParseChunk, ParseOptions

# Fallback encoding chain for when chardet is unreliable (e.g., short files)
_FALLBACK_ENCODINGS = ["utf-8", "gbk", "gb2312", "shift_jis", "euc-kr", "latin-1"]


class TxtParser(BaseParser):
    LINES_PER_PAGE = 80

    def supported_formats(self) -> list[str]:
        return ["text/plain"]

    @staticmethod
    def _detect_encoding(file_bytes: bytes) -> str:
        result = chardet.detect(file_bytes)
        encoding = result["encoding"]
        confidence = result.get("confidence", 0)

        if encoding and confidence >= 0.5:
            return encoding

        # chardet confidence too low, try common encodings
        for enc in _FALLBACK_ENCODINGS:
            try:
                file_bytes.decode(enc)
                return enc
            except (UnicodeDecodeError, LookupError):
                continue
        return "utf-8"

    def parse(self, file_bytes: bytes, filename: str, options: ParseOptions) -> Iterator[ParseChunk]:
        encoding = self._detect_encoding(file_bytes)
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
