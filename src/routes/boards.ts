// 画板 REST 路由：薄 HTTP 契约层，只做参数校验并调用用例层
import { Hono } from 'hono';
import { PNG } from 'pngjs';
import * as board from '../services/board';
import { renderBoardToPng } from '../infrastructure/render/png';
import { runTurtle, turtleToElements, isClearItem } from '../infrastructure/turtle';
import { summarizeElements } from '../infrastructure/ai/client';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { BoardElement } from '../domain/types';

export const boardsApp = new Hono<{ Bindings: Env }>();

// 读取画板状态（不存在则创建）
boardsApp.get('/:id', async (c) => {
  const state = await board.getOrCreate(c.env, c.req.param('id'));
  return c.json(state);
});

// AI 上下文：返回与内置 AI 注入提示词一致的画布摘要（声明式边界框文本）
// 供外部 agent 通过 API 获取与内置 AI 相同结构的信息，便于续画定位/避让
boardsApp.get('/:id/ai/context', async (c) => {
  const state = await board.getState(c.env, c.req.param('id'));
  if (!state) throw new NotFoundError('board not found');
  return c.json({
    width: state.meta.width,
    height: state.meta.height,
    elementCount: state.elements.length,
    summary: summarizeElements(state.elements, state.meta.width, state.meta.height),
  });
});

// 导出 PNG
boardsApp.get('/:id/png', async (c) => {
  const id = c.req.param('id');
  const state = await board.getState(c.env, id);
  if (!state) throw new NotFoundError('board not found');
  const png = renderBoardToPng(state.elements, state.meta.width, state.meta.height);
  const buf = PNG.sync.write(png);
  // 下载命名 cop-<时间戳>.png
  const filename = `cop-${Date.now()}.png`;
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

// 更新元素
boardsApp.patch('/:id/elements/:eid', async (c) => {
  const id = c.req.param('id');
  const eid = c.req.param('eid');
  const patch = await c.req.json();
  const el = await board.updateElement(c.env, id, eid, patch);
  return c.json(el);
});

// 删除元素
boardsApp.delete('/:id/elements/:eid', async (c) => {
  const id = c.req.param('id');
  const eid = c.req.param('eid');
  await board.deleteElement(c.env, id, eid);
  return c.json({ ok: true });
});

// 清空画板
boardsApp.post('/:id/clear', async (c) => {
  const id = c.req.param('id');
  await board.clearBoard(c.env, id);
  return c.json({ ok: true });
});

// 直接执行 turtle 脚本（agent / 前端统一走 turtle 落笔，不经内置 LLM）
boardsApp.post('/:id/turtle', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const script = (body.script || '').trim();
  if (!script) throw new ValidationError('script required');
  const state = await board.getState(c.env, id);
  if (!state) throw new NotFoundError('board not found');
  const items = runTurtle(script, {
    startX: state.meta.width / 2,
    startY: state.meta.height / 2,
    startHeading: 0,
  });
  // 脚本含 clear 指令：先清空画布再落新元素
  if (items.some(isClearItem)) {
    await board.clearBoard(c.env, id);
  }
  const partials = turtleToElements(items, { id: `turtle_${Date.now().toString(36)}` });
  const added: BoardElement[] = [];
  for (const p of partials) {
    added.push(await board.createElement(c.env, id, p as Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }));
  }
  return c.json({ ok: true, added: added.length });
});
