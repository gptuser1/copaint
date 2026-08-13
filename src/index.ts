import { Hono } from 'hono';
import { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api', (c) => {
  return c.json({
    name: 'CoPaint',
    version: '0.1.0',
    endpoints: [
      'GET  /api/boards/:id',
      'GET  /api/boards/:id/png',
      'POST /api/boards/:id/elements',
      'PATCH /api/boards/:id/elements/:eid',
      'DELETE /api/boards/:id/elements/:eid',
      'POST /api/boards/:id/clear',
      'POST /api/boards/:id/ops',
      'POST /api/boards/:id/ai',
      'WS   /boards/:id/ws',
    ],
  });
});

export default app;
