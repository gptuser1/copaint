// 画板用例层：编排 DO 数据访问与实时广播，供路由层调用
// 画板数据存放在 BoardHub DO 的 storage，Ocean 仅用于配置
import * as client from '../realtime/board-client';
import { NotFoundError } from '../domain/errors';
import type { BoardElement, BoardState } from '../domain/types';

// 读取画板状态；不存在返回 null（由调用方决定 404）
export function getState(env: Env, boardId: string): Promise<BoardState | null> {
  return client.getState(env, boardId);
}

// 读取画板；不存在则创建（可用 size 自定义尺寸，幂等）
export function getOrCreate(
  env: Env, boardId: string, size?: { width?: number; height?: number }
): Promise<BoardState> {
  return client.ensureState(env, boardId, size);
}

// 新增元素并广播
export function createElement(
  env: Env, boardId: string, el: Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }
): Promise<BoardElement> {
  return client.addElement(env, boardId, el);
}

// 更新元素并广播
export async function updateElement(
  env: Env, boardId: string, eid: string, patch: Partial<BoardElement>
): Promise<BoardElement> {
  const el = await client.updateElement(env, boardId, eid, patch);
  if (!el) throw new NotFoundError('element not found');
  return el;
}

// 删除元素并广播
export async function deleteElement(env: Env, boardId: string, eid: string): Promise<void> {
  const ok = await client.deleteElement(env, boardId, eid);
  if (!ok) throw new NotFoundError('element not found');
}

// 清空画板并广播
export function clearBoard(env: Env, boardId: string): Promise<void> {
  return client.clearBoard(env, boardId);
}

// 批量操作（外部 API）并广播
export function batchOps(env: Env, boardId: string, ops: Array<Record<string, any>>): Promise<BoardElement[]> {
  return client.batchOps(env, boardId, ops).then((r) => r.added);
}