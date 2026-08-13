// 画板 REST 路由
import { Hono } from 'hono';
import { PNG } from 'pngjs';
import type { Env } from '../env';
import * as store from '../services/store';
import { renderBoardToPng } from '../services/render';
import type { BoardElement } from '../types';

export const boardApp = new Hono<{ Bindings: Env }>();

// 广播到指定画板的所有 WS 连接
async function broadcast(env: Env, boardId: string, event: string, payload: any): Promise<void> {
  try {
    const id = env.BOARD_HUB.idFromName(boardId);
    const stub = env.BOARD_HUB.get(id);
    await stub.fetch('http://hub/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, event, payload }),
    });
  } catch (e) {
    console.error('broadcast failed:', e instanceof Error ? e.message : e);
  }
}

// 读取画板状态
boardApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  await store.ensureBoard(c.env, id);
  const state = await store.getBoard(c.env, id);
  return c.json(state);
});

// 导出 PNG
boardApp.get('/:id/png', async (c) => {
  const id = c.req.param('id');
  const state = await store.getBoard(c.env, id);
  if (!state) return c.json({ error: 'board not found' }, 404);
  const png = renderBoardToPng(state.elements, state.meta.width, state.meta.height);
  const buf = PNG.sync.write(png);
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
  });
});

// 添加元素
boardApp.post('/:id/elements', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { type, points, x, y, width, height, x2, y2, color, strokeWidth, by } = body as any;
  if (!type) return c.json({ error: 'type required' }, 400);
  await store.ensureBoard(c.env, id);
  const el = await store.addElement(c.env, id, {
    type,
    points, x, y, width, height, x2, y2,
    color: color || '#000000',
    strokeWidth: strokeWidth ?? 2,
    by: by || 'api',
  });
  await broadcast(c.env, id, 'add', el);
  return c.json(el, 201);
});

// 更新元素
boardApp.patch('/:id/elements/:eid', async (c) => {
  const id = c.req.param('id');
  const eid = c.req.param('eid');
  const patch = await c.req.json();
  const el = await store.updateElement(c.env, id, eid, patch);
  if (!el) return c.json({ error: 'element not found' }, 404);
  await broadcast(c.env, id, 'update', el);
  return c.json(el);
});

// 删除元素
boardApp.delete('/:id/elements/:eid', async (c) => {
  const id = c.req.param('id');
  const eid = c.req.param('eid');
  const ok = await store.deleteElement(c.env, id, eid);
  if (!ok) return c.json({ error: 'element not found' }, 404);
  await broadcast(c.env, id, 'delete', { id: eid });
  return c.json({ ok: true });
});

// 清空画板
boardApp.post('/:id/clear', async (c) => {
  const id = c.req.param('id');
  await store.ensureBoard(c.env, id);
  await store.clearBoard(c.env, id);
  await broadcast(c.env, id, 'clear', {});
  return c.json({ ok: true });
});

// 批量操作
boardApp.post('/:id/ops', async (c) => {
  const id = c.req.param('id');
  const ops = await c.req.json();
  if (!Array.isArray(ops)) return c.json({ error: 'ops must be an array' }, 400);
  await store.ensureBoard(c.env, id);
  const added: BoardElement[] = [];
  for (const op of ops) {
    const { action, element, eid, patch } = op as any;
    if (action === 'add' && element) {
      const el = await store.addElement(c.env, id, { ...element, by: element.by || 'api' });
      added.push(el);
    } else if (action === 'update' && eid && patch) {
      await store.updateElement(c.env, id, eid, patch);
    } else if (action === 'delete' && eid) {
      await store.deleteElement(c.env, id, eid);
    }
  }
  await broadcast(c.env, id, 'ops', ops);
  return c.json({ ok: true, added });
});

export { broadcast };
