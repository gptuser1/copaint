// WebSocket 升级路由：把连接转发给 BoardHub DO
import type { Hono } from 'hono';

export function mountWs(app: Hono<{ Bindings: Env }>): void {
  app.get('/boards/:id/ws', async (c) => {
    const id = c.env.BOARD_HUB.idFromName(c.req.param('id'));
    const stub = c.env.BOARD_HUB.get(id);
    return stub.fetch(c.req.raw);
  });
}
