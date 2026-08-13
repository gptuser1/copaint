// BoardHub Durable Object：持有画板的 WebSocket 连接并广播事件
import type { Env } from '../env';

export class BoardHub {
  private state: DurableObjectState;
  private env: Env;
  private conns = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // 广播端点：REST/API 操作后调用，推送事件给所有 WS 客户端
    if (url.pathname === '/broadcast') {
      let body: { event?: string; payload?: any } = {};
      try { body = await req.json(); } catch { /* ignore */ }
      const msg = JSON.stringify({ event: body.event, payload: body.payload });
      for (const ws of this.conns) {
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
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.conns.add(server);
      server.addEventListener('close', () => this.conns.delete(server));
      server.addEventListener('error', () => this.conns.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }
}
