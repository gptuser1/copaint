// AI 指令路由：入队（单次） + 直接测试（不入队）+ 终止队列
import { Hono } from 'hono';
import { getState, getAiEpoch, cancelAiTasks } from '../realtime/board-client';
import { requireConfig } from '../services/config';
import { generateTurtleScript } from '../infrastructure/ai/client';
import { NotFoundError, ValidationError, AppError } from '../domain/errors';
import type { AiJob } from '../domain/types';

export const aiApp = new Hono<{ Bindings: Env }>();

aiApp.post('/:id/ai', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) throw new ValidationError('instruction required');

  // 可调 LLM 参数（前端下发，均可选）
  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : undefined;
  const maxTokens = Number.isFinite(Number(body.maxTokens)) ? Number(body.maxTokens) : undefined;
  const thinking = typeof body.thinking === 'boolean' ? body.thinking : undefined;

  const job: AiJob = {
    boardId: id,
    instruction,
    epoch: await getAiEpoch(c.env, id),
    temperature,
    maxTokens,
    thinking,
  };
  await c.env.AI_QUEUE.send(job);
  return c.json({ ok: true });
});

// 终止当前队列所有 AI 任务
aiApp.post('/:id/ai/cancel', async (c) => {
  const id = c.req.param('id');
  const epoch = await cancelAiTasks(c.env, id);
  return c.json({ ok: true, epoch });
});

// 直接测试：不入队，直接调用 LLM 并返回原始响应（供调试）
aiApp.post('/:id/ai/test', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) throw new ValidationError('instruction required');

  try {
    const board = await getState(c.env, id);
    if (!board) throw new NotFoundError('board not found');

    const [apiKey, baseUrl, model] = await Promise.all([
      requireConfig(c.env, 'openai_api_key'),
      requireConfig(c.env, 'openai_base_url'),
      requireConfig(c.env, 'openai_model'),
    ]);

    const raw = await generateTurtleScript(
      { apiKey, baseUrl, model },
      {
        instruction,
        width: board.meta.width,
        height: board.meta.height,
        elements: board.elements,
        stepHint: '测试模式，请直接输出 turtle 脚本，不要解释、不要 markdown 代码块。',
      },
      {
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : undefined,
        maxTokens: Number.isFinite(Number(body.maxTokens)) ? Number(body.maxTokens) : undefined,
        thinking: typeof body.thinking === 'boolean' ? body.thinking : undefined,
      },
    );

    return c.json({ ok: true, raw });
  } catch (e) {
    // 保留服务端日志便于排查
    console.error('ai test failed:', e);
    // 返回详细错误，避免被全局 onError 折叠成笼统的 internal error
    if (e instanceof AppError) {
      return c.json({ error: e.message, code: e.code }, e.status as any);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg, code: 'AI_TEST_FAILED' }, 500);
  }
});
