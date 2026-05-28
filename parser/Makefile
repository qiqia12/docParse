.PHONY: proto test run clean

proto:
	python -m grpc_tools.protoc \
		-I./proto \
		--python_out=./src \
		--grpc_python_out=./src \
		./proto/document_parser.proto
	sed -i '' 's/import document_parser_pb2/from . import document_parser_pb2/' src/document_parser_pb2_grpc.py || true

test:
	python -m pytest tests/ -v

run:
	python -m src.server

clean:
	rm -f src/document_parser_pb2.py src/document_parser_pb2_grpc.py
