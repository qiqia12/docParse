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
