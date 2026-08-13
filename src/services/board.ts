// 画板用例层：编排数据访问与实时广播，供路由层调用
// 不依赖 routes/HTTP，仅依赖 infrastructure 与 realtime
import * as repo from '../infrastructure/db/board-repo';
import { broadcast } from '../realtime/broadcaster';
import { NotFoundError } from '../domain/errors';
import type { BoardElement, BoardState, WsEvent } from '../domain/types';

// 读取画板状态；不存在返回 null（由调用方决定 404）
export function getState(env: Env, boardId: string): Promise<BoardState | null> {
  return repo.getBoard(env, boardId);
}

// 读取画板；不存在则创建（幂等）
export async function getOrCreate(env: Env, boardId: string): Promise<BoardState> {
  await repo.ensureBoard(env, boardId);
  const state = await repo.getBoard(env, boardId);
  if (!state) throw new NotFoundError('board not found');
  return state;
}

// 新增元素并广播
export async function createElement(
  env: Env, boardId: string, el: Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }
): Promise<BoardElement> {
  await repo.ensureBoard(env, boardId);
  const full = await repo.addElement(env, boardId, el);
  await broadcast(env, boardId, 'add', full);
  return full;
}

// 更新元素并广播
export async function updateElement(
  env: Env, boardId: string, eid: string, patch: Partial<BoardElement>
): Promise<BoardElement> {
  const el = await repo.updateElement(env, boardId, eid, patch);
  if (!el) throw new NotFoundError('element not found');
  await broadcast(env, boardId, 'update', el);
  return el;
}

// 删除元素并广播
export async function deleteElement(env: Env, boardId: string, eid: string): Promise<void> {
  const ok = await repo.deleteElement(env, boardId, eid);
  if (!ok) throw new NotFoundError('element not found');
  await broadcast(env, boardId, 'delete', { id: eid });
}

// 清空画板并广播
export async function clearBoard(env: Env, boardId: string): Promise<void> {
  await repo.ensureBoard(env, boardId);
  await repo.clearBoard(env, boardId);
  await broadcast(env, boardId, 'clear', {});
}

// 批量操作（外部 API）并广播
export async function batchOps(
  env: Env, boardId: string, ops: Array<Record<string, any>>
): Promise<BoardElement[]> {
  await repo.ensureBoard(env, boardId);
  const added: BoardElement[] = [];
  for (const op of ops) {
    const { action, element, eid, patch } = op;
    if (action === 'add' && element) {
      const el = await repo.addElement(env, boardId, { ...element, by: element.by || 'api' });
      added.push(el);
    } else if (action === 'update' && eid && patch) {
      await repo.updateElement(env, boardId, eid, patch);
    } else if (action === 'delete' && eid) {
      await repo.deleteElement(env, boardId, eid);
    }
  }
  await broadcast(env, boardId, 'ops' as WsEvent, ops);
  return added;
}
