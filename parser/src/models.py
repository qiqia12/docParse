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
