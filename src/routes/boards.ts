// 画板 REST 路由：薄 HTTP 契约层，只做参数校验并调用用例层
import { Hono } from 'hono';
import { PNG } from 'pngjs';
import * as board from '../services/board';
import { renderBoardToPng } from '../infrastructure/render/png';
import { runTurtle, turtleToElements } from '../infrastructure/turtle';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { BoardElement } from '../domain/types';

export const boardsApp = new Hono<{ Bindings: Env }>();

// 读取画板状态（不存在则创建）
boardsApp.get('/:id', async (c) => {
  const state = await board.getOrCreate(c.env, c.req.param('id'));
  return c.json(state);
});

// 导出 PNG
boardsApp.get('/:id/png', async (c) => {
  const id = c.req.param('id');
  const state = await board.getState(c.env, id);
  if (!state) throw new NotFoundError('board not found');
  const png = renderBoardToPng(state.elements, state.meta.width, state.meta.height);
  const buf = PNG.sync.write(png);
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
  });
});

// 添加元素
boardsApp.post('/:id/elements', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { type, points, x, y, width, height, x2, y2, color, strokeWidth, by } = body as any;
  if (!type) throw new ValidationError('type required');
  const el = await board.createElement(c.env, id, {
    type,
    points, x, y, width, height, x2, y2,
    color: color || '#000000',
    strokeWidth: strokeWidth ?? 2,
    by: by || 'api',
  });
  return c.json(el, 201);
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

// 批量操作（外部 API）
boardsApp.post('/:id/ops', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json();
  const ops = Array.isArray(raw) ? raw : (raw as any)?.ops;
  if (!Array.isArray(ops)) throw new ValidationError('ops must be an array');
  const result = await board.batchOps(c.env, id, ops);
  return c.json({ ...result, ok: true });
});

// 直接执行 turtle 脚本（agent 自己把自然语言翻译成脚本后提交，不经内置 LLM）
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
  const partials = turtleToElements(items, { id: `turtle_${Date.now().toString(36)}` });
  const added: BoardElement[] = [];
  for (const p of partials) {
    added.push(await board.createElement(c.env, id, p as Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }));
  }
  return c.json({ ok: true, added: added.length });
});
