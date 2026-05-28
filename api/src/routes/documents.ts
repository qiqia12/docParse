import { FastifyPluginAsync } from 'fastify';

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents/:id', async (request, reply) => {
    return { status: 'not implemented' };
  });
};
