// BoardHub Durable Object：持有画板的 WebSocket 连接并广播事件
// 使用 Hibernation WebSocket API（acceptWebSocket），DO 休眠时连接不丢失
import { DurableObject } from 'cloudflare:workers';

export class BoardHub extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // 广播端点：REST/API 操作后调用，推送事件给所有 WS 客户端
    if (url.pathname === '/broadcast') {
      let body: { event?: string; payload?: any } = {};
      try { body = await req.json(); } catch { /* ignore */ }
      const msg = JSON.stringify({ event: body.event, payload: body.payload });
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(msg); } catch { /* drop */ }
      }
      return new Response('ok');
    }

    // WebSocket 升级端点
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // 连接交给 DO 托管，支持休眠
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }
}
