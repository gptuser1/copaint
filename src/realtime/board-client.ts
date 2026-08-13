// BoardHub DO 客户端：统一封装对画板 DO 的 HTTP 调用
// 供 services/board 与 services/ai 使用，避免各处重复拼 URL
import type { BoardElement, BoardState, WsEvent } from '../domain/types';

function stubOf(env: Env, boardId: string) {
  const id = env.BOARD_HUB.idFromName(boardId);
  return env.BOARD_HUB.get(id);
}

async function call(env: Env, boardId: string, req: RequestInit & { path: string }): Promise<Response> {
  const { path, headers, ...init } = req;
  const h = new Headers(headers);
  if (init.body) h.set('Content-Type', 'application/json');
  return stubOf(env, boardId).fetch(`http://hub${path}`, { ...init, headers: h });
}

// 读取或创建画板状态（可带 size 自定义尺寸）
export function ensureState(
  env: Env, boardId: string, size?: { width?: number; height?: number }
): Promise<BoardState> {
  const q = size && (size.width || size.height)
    ? `?width=${size.width || ''}&height=${size.height || ''}`
    : '';
  return call(env, boardId, { path: '/state' + q, method: 'GET' }).then((r) => r.json());
}

// 读取画板状态；不存在返回 null
export async function getState(env: Env, boardId: string): Promise<BoardState | null> {
  const r = await call(env, boardId, { path: '/state/raw', method: 'GET' });
  if (r.status === 404) return null;
  return r.json();
}

// 添加元素并广播
export function addElement(
  env: Env, boardId: string,
  element: Omit<BoardElement, 'createdAt' | 'id'> & { id?: string },
): Promise<BoardElement> {
  return call(env, boardId, {
    path: '/elements', method: 'POST', body: JSON.stringify({ element }),
  }).then((r) => r.json());
}

// 更新元素并广播；不存在返回 null
export async function updateElement(
  env: Env, boardId: string, eid: string, patch: Partial<BoardElement>
): Promise<BoardElement | null> {
  const r = await call(env, boardId, {
    path: `/elements/${eid}`, method: 'PATCH', body: JSON.stringify(patch),
  });
  if (r.status === 404) return null;
  return r.json();
}

// 删除元素并广播；不存在返回 false
export async function deleteElement(env: Env, boardId: string, eid: string): Promise<boolean> {
  const r = await call(env, boardId, { path: `/elements/${eid}`, method: 'DELETE' });
  return r.status !== 404;
}

// 清空画板并广播
export function clearBoard(env: Env, boardId: string): Promise<void> {
  return call(env, boardId, { path: '/clear', method: 'POST' }).then(() => undefined);
}

// 批量操作并广播
export function batchOps(env: Env, boardId: string, ops: Array<Record<string, any>>): Promise<{ ok: boolean; added: BoardElement[] }> {
  return call(env, boardId, {
    path: '/ops', method: 'POST', body: JSON.stringify({ ops }),
  }).then((r) => r.json());
}

// 仅广播（跨上下文，如 AI consumer 在 Worker 侧）
export function broadcast(env: Env, boardId: string, event: WsEvent, payload: any): Promise<void> {
  return call(env, boardId, {
    path: '/broadcast', method: 'POST', body: JSON.stringify({ event, payload }),
  }).then(() => undefined).catch((e) => {
    console.error('broadcast failed:', e instanceof Error ? e.message : e);
  });
}