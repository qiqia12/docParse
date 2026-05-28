import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { migrate } from './db.js';
import { documentsRoutes } from './routes/documents.js';
import { formatsRoutes } from './routes/formats.js';

async function main() {
  // Skip migration if DATABASE_URL is not set (dev mode without PG)
  if (config.DATABASE_URL && config.DATABASE_URL !== 'postgresql://localhost:5432/docparse') {
    try {
      await migrate();
    } catch (err) {
      console.warn('Database migration failed (PG may not be running):', (err as Error).message);
    }
  }

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });
  await app.register(multipart, { limits: { fileSize: config.MAX_FILE_SIZE } });
  await app.register(documentsRoutes, { prefix: '/api/v1' });
  await app.register(formatsRoutes, { prefix: '/api/v1' });

  app.get('/health', async () => ({ status: 'ok' }));

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Fastify server running on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
