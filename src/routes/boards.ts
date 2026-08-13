// 画板 REST 路由：薄 HTTP 契约层，只做参数校验并调用用例层
import { Hono } from 'hono';
import { PNG } from 'pngjs';
import * as board from '../services/board';
import { renderBoardToPng } from '../infrastructure/render/png';
import { NotFoundError, ValidationError } from '../domain/errors';

export const boardsApp = new Hono<{ Bindings: Env }>();

// 读取画板状态（不存在则创建，可带 ?width= & height= 自定义尺寸）
boardsApp.get('/:id', async (c) => {
  const w = Number(c.req.query('width'));
  const h = Number(c.req.query('height'));
  const size = (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
    ? { width: Math.round(w), height: Math.round(h) }
    : undefined;
  const state = await board.getOrCreate(c.env, c.req.param('id'), size);
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
  const ops = await c.req.json();
  if (!Array.isArray(ops)) throw new ValidationError('ops must be an array');
  const added = await board.batchOps(c.env, id, ops);
  return c.json({ ok: true, added });
});
