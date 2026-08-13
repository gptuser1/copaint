// AI 指令路由：入队（单次或多步）
import { Hono } from 'hono';
import { ValidationError } from '../domain/errors';
import type { AiJob } from '../domain/types';

export const aiApp = new Hono<{ Bindings: Env }>();

aiApp.post('/:id/ai', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) throw new ValidationError('instruction required');

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
