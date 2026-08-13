// Worker 入口：装配 Hono app、挂载路由、导出 fetch / queue / DO 类
import { Hono } from 'hono';
import { boardsApp } from './routes/boards';
import { aiApp } from './routes/ai';
import { configApp } from './routes/config';
import { mountWs } from './routes/ws';
import { BoardHub } from './realtime/board-hub';
import { queueConsumer } from './services/ai';
import { authMiddleware } from './services/auth';
import { AppError } from './domain/errors';

const app = new Hono<{ Bindings: Env }>();

// 统一错误映射（AppError → HTTP 响应）
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error('unhandled error:', err);
  return c.json({ error: 'internal error' }, 500);
});

// 全局鉴权：所有 /api/* 需携带令牌（与绑定的 SECRET 比对）
app.use('/api/*', authMiddleware);

// 鉴权验证
app.get('/api/verify', (c) => c.json({ ok: true, message: '令牌有效' }));

// 业务路由
app.route('/api/boards', boardsApp);
app.route('/api/boards', aiApp);
app.route('/api/config', configApp);
mountWs(app);

app.get('/api', (c) => {
  return c.json({
    name: 'CoPaint',
    version: '0.1.0',
    endpoints: [
      'GET  /api/boards',
      'DELETE /api/boards/:id',
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

export default {
  fetch: app.fetch,
  queue: queueConsumer,
};

// Durable Object 类（wrangler.toml 已声明 BoardHub）
export { BoardHub };
