import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'document_parser.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition) as any;

const client = new proto.docparse.DocumentParser(
  config.GRPC_PARSER_HOST,
  grpc.credentials.createInsecure(),
  {
    'grpc.max_receive_message_length': 100 * 1024 * 1024,
    'grpc.max_send_message_length': 100 * 1024 * 1024,
  }
);

export interface ParseRequest {
  fileContent: Buffer;
  filename: string;
  taskId: string;
  options: {
    extractImages: boolean;
    extractTables: boolean;
    maxPages: number;
    outputStyle: string;
  };
}

export interface ParseChunk {
  pageNumber: number;
  totalPages: number;
  markdown: string;
  images: Array<{
    index: number;
    imageId: string;
    altText: string;
    width: number;
    height: number;
  }>;
  confidence: number;
  isComplete: boolean;
}

export function parseStream(request: ParseRequest): AsyncIterable<ParseChunk> {
  const grpcRequest = {
    file_content: request.fileContent,
    filename: request.filename,
    task_id: request.taskId,
    options: {
      extract_images: request.options.extractImages,
      extract_tables: request.options.extractTables,
      max_pages: request.options.maxPages,
      output_style: request.options.outputStyle,
    },
  };

  const call = client.Parse(grpcRequest);

  let buffer: ParseChunk[] = [];
  let ended = false;
  let error: Error | null = null;
  let resolveNext: ((value: IteratorResult<ParseChunk>) => void) | null = null;

  call.on('data', (chunk: any) => {
    const result: ParseChunk = {
      pageNumber: chunk.page_number,
      totalPages: chunk.total_pages,
      markdown: chunk.markdown,
      images: (chunk.images || []).map((img: any) => ({
        index: img.index,
        imageId: img.image_id,
        altText: img.alt_text,
        width: img.width,
        height: img.height,
      })),
      confidence: chunk.confidence,
      isComplete: chunk.is_complete,
    };
    if (resolveNext) {
      resolveNext({ done: false, value: result });
      resolveNext = null;
    } else {
      buffer.push(result);
    }
  });

  call.on('end', () => {
    ended = true;
    if (resolveNext) {
      resolveNext({ done: true, value: undefined });
      resolveNext = null;
    }
  });

  call.on('error', (err: Error) => {
    error = err;
    if (resolveNext) {
      resolveNext({ done: true, value: undefined });
      resolveNext = null;
    }
  });

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<ParseChunk>> {
          if (error) return Promise.reject(error);
          if (buffer.length > 0) {
            return Promise.resolve({ done: false, value: buffer.shift()! });
          }
          if (ended) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return new Promise((resolve, reject) => {
            resolveNext = (result) => {
              if (error) reject(error);
              else resolve(result);
            };
          });
        },
      };
    },
  };
}

export function getSupportedFormats(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    client.GetSupportedFormats({}, (err: any, response: any) => {
      if (err) {
        if (err.code === grpc.status.UNAVAILABLE) {
          resolve([]);
          return;
        }
        return reject(err);
      }
      resolve(response.mime_types || []);
    });
  });
}
