import { FastifyPluginAsync } from 'fastify';

export const formatsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/formats', async () => {
    return { mime_types: [] };
  });
};
