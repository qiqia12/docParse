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
