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
