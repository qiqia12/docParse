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
        file_content=b"\x00\x01\x02\x03\xff\xfe\xfd\xfc",
        filename="test.xyz",
        task_id="test-002",
        options=pb2.ParseOptions(),
    )
    with pytest.raises(grpc.RpcError) as exc:
        list(grpc_stub.Parse(request))
    assert exc.value.code() == grpc.StatusCode.INVALID_ARGUMENT
