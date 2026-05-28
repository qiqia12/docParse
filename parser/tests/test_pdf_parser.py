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
    doc.new_page(width=595, height=842)  # one blank page
    pdf_bytes = doc.tobytes()
    doc.close()
    chunks = list(parser.parse(pdf_bytes, "empty.pdf", ParseOptions()))
    assert len(chunks) >= 1


def test_pdf_parser_invalid_bytes():
    parser = PdfParser()
    with pytest.raises(Exception):
        list(parser.parse(b"not a pdf", "fake.pdf", ParseOptions()))
