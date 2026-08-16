// AI 指令路由：流式执行（SSE 实时推送思考与响应）
// 已移除队列：单用户协作场景无需排队，"让 AI 画"直接流式发送并接收，
// 前端可实时看到思维链(reasoning)与正文(content)的生成过程。
// 测试模式通过 apply:false 复用同一流式接口，只出脚本不落笔。
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getState, addElement, clearBoard } from '../realtime/board-client';
import { requireConfig } from '../services/config';
import {
  streamLLM, buildTurtlePrompt,
  parseTurtleResponse, elementsFromTurtleScript,
} from '../infrastructure/ai/client';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { BoardElement } from '../domain/types';

export const aiApp = new Hono<{ Bindings: Env }>();

// 让 AI 画：流式调用 LLM → 逐块推送 thinking/response → 流结束后落笔 → done
// SSE 事件：
//   thinking: { text }            思维链增量
//   response: { text }            正文增量
//   done:     { ok, script, added, cleared, raw, reasoning }
//   error:    { error }
aiApp.post('/:id/ai', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const instruction = (body.instruction || '').trim();
  if (!instruction) throw new ValidationError('instruction required');

  // 可调 LLM 参数（前端下发，均可选）
  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : undefined;
  const maxTokens = Number.isFinite(Number(body.maxTokens)) ? Number(body.maxTokens) : undefined;
  const thinking = typeof body.thinking === 'boolean' ? body.thinking : undefined;
  // 思维链 token 上限（thinking_budget，128-32768），0 视为不限制
  const thinkingBudget = Number.isFinite(Number(body.thinkingBudget)) && Number(body.thinkingBudget) >= 128
    ? Math.min(Number(body.thinkingBudget), 32768)
    : undefined;
  // 是否落笔到画布：默认落笔；测试模式传 apply:false 只出脚本（含思考/原始响应）
  const apply = body.apply !== false;

  const board = await getState(c.env, id);
  if (!board) throw new NotFoundError('board not found');

  const [apiKey, baseUrl, model] = await Promise.all([
    requireConfig(c.env, 'openai_api_key'),
    requireConfig(c.env, 'openai_base_url'),
    requireConfig(c.env, 'openai_model'),
  ]);

  const config = { apiKey, baseUrl, model };
  const input = {
    instruction,
    width: board.meta.width,
    height: board.meta.height,
    elements: board.elements,
    stepHint: '参考 existing，用 <script> 包裹一条 turtle 脚本，画出指令要求的全部内容。',
  };
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);

  // Cloudflare Workers 对流式响应需显式 Identity，避免被压缩缓冲导致无法即时推送
  c.header('Content-Encoding', 'Identity');
  return streamSSE(c, async (stream) => {
    let content = '';
    let reasoning = '';
    let usage: unknown;
    try {
      for await (const chunk of streamLLM(config, messages, { temperature, maxTokens, thinking, thinkingBudget })) {
        if (chunk.type === 'thinking') {
          reasoning += chunk.text;
          await stream.writeSSE({ event: 'thinking', data: JSON.stringify({ text: chunk.text }) });
        } else if (chunk.type === 'content') {
          content += chunk.text;
          await stream.writeSSE({ event: 'response', data: JSON.stringify({ text: chunk.text }) });
        } else if (chunk.type === 'usage') {
          usage = chunk.usage;
          await stream.writeSSE({ event: 'usage', data: JSON.stringify({ usage: chunk.usage }) });
        }
      }

      const { script } = parseTurtleResponse(content);
      if (!script.trim()) {
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ ok: true, script: '', added: 0, cleared: false, raw: content, reasoning, usage }) });
        return;
      }

      // 测试模式（apply:false）：只出脚本，不落笔到画布
      let added: BoardElement[] = [];
      let cleared = false;
      let turtleMs = 0;
      if (apply) {
        // 渲染 CPU 用时（墙钟近似）：供前端执行日志展示
        const t0 = performance.now();
        const { elements: partials, cleared: didClear } = elementsFromTurtleScript(script, input.width, input.height);
        turtleMs = performance.now() - t0;
        cleared = didClear;
        if (cleared) {
          await clearBoard(c.env, id);
        }
        for (const p of partials) {
          try {
            added.push(await addElement(c.env, id, p as Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }));
          } catch { /* 单个元素写入失败不阻断整体 */ }
        }
      }
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ ok: true, script, added: added.length, cleared, raw: content, reasoning, usage, turtleMs: Number(turtleMs.toFixed(2)) }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try { await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: msg }) }); } catch { /* 客户端已断开 */ }
    }
  });
});