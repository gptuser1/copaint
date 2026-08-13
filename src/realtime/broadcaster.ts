// 向画板所有 WebSocket 连接广播事件（调用 BoardHub DO）
import type { WsEvent } from '../domain/types';

export async function broadcast(env: Env, boardId: string, event: WsEvent, payload: any): Promise<void> {
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
