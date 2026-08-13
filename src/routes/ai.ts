// AI 指令路由：入队（单次或多步） + 直接测试（不入队）
import { Hono } from 'hono';
import { getState } from '../realtime/board-client';
import { requireConfig } from '../services/config';
import { generateRawContent } from '../infrastructure/ai/client';
import { NotFoundError, ValidationError } from '../domain/errors';
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

// 直接测试：不入队，直接调用 LLM 并返回原始响应（供调试）
aiApp.post('/:id/ai/test', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) throw new ValidationError('instruction required');

  const board = await getState(c.env, id);
  if (!board) throw new NotFoundError('board not found');

  const [apiKey, baseUrl, model] = await Promise.all([
    requireConfig(c.env, 'openai_api_key'),
    requireConfig(c.env, 'openai_base_url'),
    requireConfig(c.env, 'openai_model'),
  ]);

  const raw = await generateRawContent(
    { apiKey, baseUrl, model },
    {
      instruction,
      width: board.meta.width,
      height: board.meta.height,
      elements: board.elements,
      stepHint: '测试模式，请直接输出原始 JSON 结果，不要额外解释。',
    },
  );

  return c.json({ ok: true, raw });
});
