import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { fileStore } from '../services/file-store.js';
import { parseStream } from '../services/grpc-client.js';
import { sseManager } from '../services/sse-manager.js';

const ALLOWED_MIMES = new Set([
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function detectMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    txt: 'text/plain',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext || ''] || 'application/octet-stream';
}

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  // POST /documents - upload
  app.post('/documents', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const content = await data.toBuffer();
    if (content.length === 0) {
      return reply.status(400).send({ error: 'Empty file' });
    }

    const mimeType = detectMime(data.filename);
    if (!ALLOWED_MIMES.has(mimeType)) {
      return reply.status(400).send({ error: `Unsupported format: ${mimeType}` });
    }

    const sha256 = await fileStore.save(content);

    // Dedup: check if already parsed
    try {
      const { rows: existing } = await db.query(
        `SELECT id, markdown, total_pages, confidence, file_ref_count
         FROM tasks WHERE file_sha256 = $1 AND status = 'completed' LIMIT 1`,
        [sha256]
      );
      if (existing.length > 0) {
        const task = existing[0];
        await db.query(`UPDATE tasks SET file_ref_count = file_ref_count + 1 WHERE id = $1`, [task.id]);
        return reply.status(200).send({
          task_id: task.id,
          status: 'completed',
          markdown: task.markdown,
          total_pages: task.total_pages,
          confidence: task.confidence,
          cached: true,
        });
      }
    } catch (_) {
      // DB may not be available, continue without dedup
    }

    // Insert task
    let task: any;
    try {
      const result = await db.query(
        `INSERT INTO tasks (filename, file_size, file_sha256, mime_type, status, options)
         VALUES ($1, $2, $3, $4, 'queued', '{}'::jsonb) RETURNING id`,
        [data.filename, content.length, sha256, mimeType]
      );
      task = result.rows[0];
    } catch (err: any) {
      return reply.status(202).send({
        task_id: 'local-' + sha256.slice(0, 16),
        status: 'queued',
        note: 'DB unavailable, task will be processed but not persisted',
      });
    }

    // Async parse in background
    setImmediate(async () => {
      try {
        await db.query(`UPDATE tasks SET status = 'parsing' WHERE id = $1`, [task.id]);
        let fullMarkdown = '';
        let pageNum = 0;
        let lastConfidence = 0;
        for await (const chunk of parseStream({
          fileContent: content,
          filename: data.filename,
          taskId: task.id,
          options: { extractImages: true, extractTables: true, maxPages: 0, outputStyle: 'github' },
        })) {
          pageNum = chunk.pageNumber;
          lastConfidence = chunk.confidence;
          fullMarkdown += chunk.markdown;
          sseManager.emitProgress(task.id, {
            page: chunk.pageNumber,
            total: chunk.totalPages,
            confidence: chunk.confidence,
          });
          sseManager.emitChunk(task.id, {
            page: chunk.pageNumber,
            markdown: chunk.markdown,
          });
        }
        sseManager.emitComplete(task.id, {
          totalPages: pageNum || 1,
          overallConfidence: lastConfidence,
        });
        await db.query(
          `UPDATE tasks SET status = 'completed', markdown = $1, total_pages = $2, confidence = $3, updated_at = NOW()
           WHERE id = $4`,
          [fullMarkdown, pageNum || 1, lastConfidence, task.id]
        );
      } catch (err: any) {
        sseManager.emitError(task.id, { code: 'PARSE_FAILED', message: err.message });
        try {
          await db.query(
            `UPDATE tasks SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
            [err.message, task.id]
          );
        } catch (_) {
          // ignore DB errors during error handling
        }
      }
    });

    return reply.status(202).send({ task_id: task.id, status: 'queued' });
  });

  // GET /documents/:id
  app.get('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { rows } = await db.query(
        `SELECT id, filename, file_size, mime_type, status, markdown, total_pages, confidence, error_message, created_at
         FROM tasks WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Task not found' });
      return rows[0];
    } catch {
      return reply.status(500).send({ error: 'Database unavailable' });
    }
  });

  // DELETE /documents/:id
  app.delete('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { rows } = await db.query(`SELECT file_sha256, file_ref_count FROM tasks WHERE id = $1`, [id]);
      if (rows.length === 0) return reply.status(404).send({ error: 'Task not found' });
      const task = rows[0];
      if (task.file_ref_count <= 1) {
        await fileStore.delete(task.file_sha256);
        await db.query(`DELETE FROM tasks WHERE id = $1`, [id]);
      } else {
        await db.query(`UPDATE tasks SET file_ref_count = file_ref_count - 1 WHERE id = $1`, [id]);
      }
      return { deleted: true };
    } catch {
      return reply.status(500).send({ error: 'Database unavailable' });
    }
  });

  // GET /documents/:id/download
  app.get('/documents/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { rows } = await db.query(
        `SELECT markdown, filename FROM tasks WHERE id = $1 AND status = 'completed'`,
        [id]
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Not found or not completed' });
      const mdName = rows[0].filename.replace(/\.[^.]+$/, '.md');
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${mdName}"`);
      return rows[0].markdown;
    } catch {
      return reply.status(500).send({ error: 'Database unavailable' });
    }
  });

  // GET /documents/:id/stream - SSE
  app.get('/documents/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const { rows } = await db.query(`SELECT status, markdown FROM tasks WHERE id = $1`, [id]);
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      const task = rows[0];

      // Already completed: send complete immediately
      if (task.status === 'completed') {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        reply.raw.write(`event: complete\ndata: ${JSON.stringify({ markdown: task.markdown, cached: true })}\n\n`);
        reply.raw.end();
        return;
      }

      if (task.status === 'failed') {
        return reply.status(410).send({ error: 'Task failed' });
      }
    } catch (_) {
      // DB unavailable, stream won't work
      return reply.status(500).send({ error: 'Database unavailable' });
    }

    // Still parsing: set up SSE connection
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const onEvent = (evt: any) => {
      if (evt.taskId === id) {
        reply.raw.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
        if (evt.event === 'complete' || evt.event === 'error') {
          sseManager.off('event', onEvent);
          reply.raw.end();
        }
      }
    };

    sseManager.on('event', onEvent);

    request.raw.on('close', () => {
      sseManager.off('event', onEvent);
    });
  });
};
