// BoardHub Durable Object：每个画板一个实例
// 职责：持有画板完整状态（DO Storage 持久化）+ 管理 WS 连接并进行 CRUD 广播
// 使用 Hibernation WebSocket API（acceptWebSocket），DO 休眠时连接不丢失
import { DurableObject } from 'cloudflare:workers';
import type { BoardElement, BoardState, WsEvent } from '../domain/types';

export const BOARD_WIDTH = 400;
export const BOARD_HEIGHT = 300;
const STATE_KEY = 'state';
const AI_EPOCH_KEY = 'ai_epoch';

interface ElementInput {
  element: Omit<BoardElement, 'createdAt' | 'id'> & { id?: string };
}

export class BoardHub extends DurableObject {
  // 读取画板状态；不存在则创建（固定默认尺寸）
  async ensureState(): Promise<BoardState> {
    const existing = await this.ctx.storage.get<BoardState>(STATE_KEY);
    if (existing) return existing;
    const now = Date.now();
    const state: BoardState = {
      meta: {
        id: this.ctx.id.name!,
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        createdAt: now,
        updatedAt: now,
      },
      elements: [],
      version: 0,
    };
    await this.ctx.storage.put(STATE_KEY, state);
    return state;
  }

  // 读取画板状态；不存在返回 null
  async readState(): Promise<BoardState | null> {
    return (await this.ctx.storage.get<BoardState>(STATE_KEY)) ?? null;
  }

  // 持久化并刷新 version / updatedAt
  private async saveState(state: BoardState): Promise<void> {
    state.version = state.elements.length;
    state.meta.updatedAt = Date.now();
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private randomId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // 向画板所有 WS 连接广播事件
  private broadcast(event: WsEvent, payload: any): void {
    const msg = JSON.stringify({ event, payload });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* drop */ }
    }
  }

  // 读取当前 AI 执行代次（用于取消排队的任务）
  async getAiEpoch(): Promise<number> {
    return (await this.ctx.storage.get<number>(AI_EPOCH_KEY)) ?? 0;
  }

  // 递增 AI 代次：所有更早入队的任务将被判定为已取消
  async cancelAiTasks(): Promise<number> {
    const next = (await this.getAiEpoch()) + 1;
    await this.ctx.storage.put(AI_EPOCH_KEY, next);
    return next;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket 升级
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 读状态（不存在则创建）
    if (req.method === 'GET' && path === '/state') {
      return Response.json(await this.ensureState());
    }

    // 读状态（不存在返回 404）
    if (req.method === 'GET' && path === '/state/raw') {
      const state = await this.readState();
      if (!state) return new Response('not found', { status: 404 });
      return Response.json(state);
    }

    // 添加元素
    if (req.method === 'POST' && path === '/elements') {
      const { element } = await req.json() as ElementInput;
      const state = await this.ensureState();
      const full: BoardElement = { ...element, id: element.id || this.randomId(), createdAt: Date.now() };
      state.elements.push(full);
      await this.saveState(state);
      this.broadcast('add', full);
      return Response.json(full, { status: 201 });
    }

    // 更新元素
    if (req.method === 'PATCH' && path.startsWith('/elements/')) {
      const eid = path.slice('/elements/'.length);
      const patch = await req.json() as Partial<BoardElement>;
      const state = await this.ensureState();
      const idx = state.elements.findIndex((e) => e.id === eid);
      if (idx === -1) return new Response('element not found', { status: 404 });
      const next: BoardElement = { ...state.elements[idx], ...patch, id: eid };
      state.elements[idx] = next;
      await this.saveState(state);
      this.broadcast('update', next);
      return Response.json(next);
    }

    // 删除元素
    if (req.method === 'DELETE' && path.startsWith('/elements/')) {
      const eid = path.slice('/elements/'.length);
      const state = await this.ensureState();
      const before = state.elements.length;
      state.elements = state.elements.filter((e) => e.id !== eid);
      if (state.elements.length === before) return new Response('element not found', { status: 404 });
      await this.saveState(state);
      this.broadcast('delete', { id: eid });
      return Response.json({ ok: true });
    }

    // 清空画板
    if (req.method === 'POST' && path === '/clear') {
      const state = await this.ensureState();
      state.elements = [];
      await this.saveState(state);
      this.broadcast('clear', {});
      return Response.json({ ok: true });
    }

    // 批量操作（外部 API）
    if (req.method === 'POST' && path === '/ops') {
      const { ops } = await req.json() as { ops: Array<Record<string, any>> };
      const state = await this.ensureState();
      const added: BoardElement[] = [];
      for (const op of ops) {
        const { action, element, eid, patch } = op;
        if (action === 'add' && element) {
          const full: BoardElement = { ...element, id: element.id || this.randomId(), createdAt: Date.now() };
          state.elements.push(full);
          added.push(full);
        } else if (action === 'update' && eid && patch) {
          const idx = state.elements.findIndex((e) => e.id === eid);
          if (idx !== -1) state.elements[idx] = { ...state.elements[idx], ...patch, id: eid };
        } else if (action === 'delete' && eid) {
          state.elements = state.elements.filter((e) => e.id !== eid);
        }
      }
      await this.saveState(state);
      this.broadcast('ops', ops);
      return Response.json({ ok: true, added });
    }

    // 读取 AI 执行代次
    if (req.method === 'GET' && path === '/ai/epoch') {
      return Response.json({ epoch: await this.getAiEpoch() });
    }

    // 终止当前队列所有 AI 任务
    if (req.method === 'POST' && path === '/ai/cancel') {
      const epoch = await this.cancelAiTasks();
      this.broadcast('ai-log', { event: 'ai-cancelled', epoch, message: 'AI 队列已终止', success: true });
      return Response.json({ ok: true, epoch });
    }

    // 广播端点（AI 等跨上下文触发）
    if (req.method === 'POST' && path === '/broadcast') {
      const { event, payload } = await req.json() as { event: WsEvent; payload: any };
      this.broadcast(event, payload);
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
}