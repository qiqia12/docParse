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


from src.router import FormatRouter


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
