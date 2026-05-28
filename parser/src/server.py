import logging
import traceback

import grpc
from concurrent import futures

from . import document_parser_pb2 as pb2
from . import document_parser_pb2_grpc as pb2_grpc
from .router import FormatRouter
from .parsers import TxtParser, DocxParser, PdfParser, PptxParser
from .models import ParseOptions, ImageInfo, ParseChunk

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DocumentParserServicer(pb2_grpc.DocumentParserServicer):
    def __init__(self):
        self.router = FormatRouter()
        self.router.register(TxtParser())
        self.router.register(DocxParser())
        self.router.register(PdfParser())
        self.router.register(PptxParser())

    def Parse(self, request: pb2.ParseRequest, context):
        logger.info(f"Parse request: task_id={request.task_id} file={request.filename}")
        try:
            parser = self.router.route(request.filename, request.file_content)
        except ValueError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return

        options = ParseOptions(
            extract_images=request.options.extract_images,
            extract_tables=request.options.extract_tables,
            max_pages=request.options.max_pages,
            output_style=request.options.output_style or "github",
        )

        try:
            for chunk in parser.parse(request.file_content, request.filename, options):
                yield pb2.ParseChunk(
                    page_number=chunk.page_number,
                    total_pages=chunk.total_pages,
                    markdown=chunk.markdown,
                    images=[
                        pb2.ImageInfo(
                            index=img.index,
                            image_id=img.image_id,
                            alt_text=img.alt_text,
                            width=img.width,
                            height=img.height,
                        )
                        for img in chunk.images
                    ],
                    confidence=chunk.confidence,
                    is_complete=chunk.is_complete,
                )
        except Exception as e:
            logger.error(f"Parse error: {e}\n{traceback.format_exc()}")
            context.abort(grpc.StatusCode.INTERNAL, str(e))

    def GetSupportedFormats(self, request, context):
        mime_types = []
        for parser_cls in [TxtParser, DocxParser, PdfParser, PptxParser]:
            mime_types.extend(parser_cls().supported_formats())
        return pb2.FormatList(mime_types=mime_types)


def serve(port: int = 50051, max_workers: int = 4):
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=max_workers),
        options=[
            ("grpc.max_send_message_length", 100 * 1024 * 1024),
            ("grpc.max_receive_message_length", 100 * 1024 * 1024),
        ],
    )
    pb2_grpc.add_DocumentParserServicer_to_server(DocumentParserServicer(), server)
    server.add_insecure_port(f"[::]:{port}")
    logger.info(f"gRPC server listening on port {port}")
    server.start()
    return server


if __name__ == "__main__":
    import os
    port = int(os.environ.get("GRPC_PORT", "50051"))
    workers = int(os.environ.get("MAX_WORKERS", "4"))
    srv = serve(port=port, max_workers=workers)
    srv.wait_for_termination()
