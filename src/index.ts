import { Hono } from 'hono';
import { Env } from './env';
import { boardApp } from './routes/board';
import { BoardHub } from './ws/board-hub';
import { queueConsumer } from './ai/consumer';
import type { AiJob } from './types';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/boards', boardApp);

// WebSocket 实时连接：转发到 BoardHub DO 完成升级
app.get('/boards/:id/ws', (c) => {
  const id = c.env.BOARD_HUB.idFromName(c.req.param('id'));
  const stub = c.env.BOARD_HUB.get(id);
  return stub.fetch(c.req.raw);
});

// AI 指令入口：入队（单次或多步）
app.post('/api/boards/:id/ai', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) return c.json({ error: 'instruction required' }, 400);
  const mode: 'once' | 'multi' = body.mode === 'multi' ? 'multi' : 'once';
  const totalSteps = mode === 'multi' ? Math.max(1, Math.min(10, Number(body.steps) || 5)) : 1;
  const delayMs = Number(body.delayMs) > 0 ? Number(body.delayMs) : 2000;
  const job: AiJob = {
    boardId: id,
    instruction,
    mode,
    stepIndex: 0,
    totalSteps,
    delayMs,
  };
  await c.env.AI_QUEUE.send(job);
  return c.json({ ok: true, mode, totalSteps });
});

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

export default {
  fetch: app.fetch,
  queue: queueConsumer,
};

// Durable Object 类（wrangler.toml 已声明 BoardHub）
export { BoardHub };
