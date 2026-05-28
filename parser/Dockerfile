FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 libgl1 libglib2.0-0 file && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY proto/ proto/
COPY src/ src/
COPY tests/ tests/

RUN python -m grpc_tools.protoc -I./proto --python_out=./src --grpc_python_out=./src ./proto/document_parser.proto && \
    sed -i 's/import document_parser_pb2/from . import document_parser_pb2/' src/document_parser_pb2_grpc.py

RUN mkdir -p /data/files /data/images /models

ENV GRPC_PORT=50051 MAX_WORKERS=4

EXPOSE 50051
CMD ["python", "-m", "src.server"]
