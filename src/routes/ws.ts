// WebSocket 升级路由：校验令牌后转发给 BoardHub DO
import type { Hono } from 'hono';

export function mountWs(app: Hono<{ Bindings: Env }>): void {
  app.get('/boards/:id/ws', async (c) => {
    // WS 不在 /api/* 下，需单独校验令牌（Bearer header 或 ?token=）
    const auth = c.req.header('Authorization');
    let token = '';
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7).trim();
    } else {
      token = c.req.query('token')?.trim() || '';
    }
    const expected = await c.env.SECRET.get();
    if (!token || token !== expected) {
      return c.json({ error: '令牌无效' }, 401);
    }
    const id = c.env.BOARD_HUB.idFromName(c.req.param('id'));
    const stub = c.env.BOARD_HUB.get(id);
    return stub.fetch(c.req.raw);
  });
}