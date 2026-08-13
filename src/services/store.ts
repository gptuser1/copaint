// 画板数据访问层（基于 Ocean / D1 REST）
import { createDb } from '../abstraction/d1';
import type { BoardElement, BoardMeta, BoardState } from '../types';

const BOARD_WIDTH = 960;
const BOARD_HEIGHT = 600;

interface EnvLike {
  COP_OCEAN_TOKEN: string;
  COP_OCEAN_BASE?: string;
}

// 按连接缓存建表状态
const ready = new Map<string, boolean>();
const errMap = new Map<string, string | null>();

function connKey(env: EnvLike): string {
  return (env.COP_OCEAN_TOKEN || '') + '|' + (env.COP_OCEAN_BASE || '');
}

async function ensureTables(env: EnvLike): Promise<void> {
  const ck = connKey(env);
  if (ready.get(ck)) return;
  if (errMap.has(ck)) throw new Error(errMap.get(ck) || 'store init failed');

  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS copaint_boards (
      id TEXT PRIMARY KEY,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS copaint_elements (
      board_id TEXT NOT NULL,
      id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (board_id, id)
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_elements_board_seq
      ON copaint_elements (board_id, seq)`);
    ready.set(ck, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'store init failed';
    errMap.set(ck, msg);
    throw new Error(msg);
  }
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// 读取整块画板状态
export async function getBoard(env: EnvLike, boardId: string): Promise<BoardState | null> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  const meta = await db.queryOne<{ id: string; width: number; height: number; created_at: number; updated_at: number }>(
    `SELECT id, width, height, created_at, updated_at FROM copaint_boards WHERE id = ?`, [boardId]
  );
  if (!meta) return null;
  const rows = await db.queryAll<{ id: string; data: string }>(
    `SELECT id, data FROM copaint_elements WHERE board_id = ? ORDER BY seq`, [boardId]
  );
  const elements: BoardElement[] = [];
  for (const r of rows) {
    try { elements.push(JSON.parse(r.data)); } catch { /* skip */ }
  }
  return {
    meta: { id: meta.id, width: meta.width, height: meta.height, createdAt: meta.created_at, updatedAt: meta.updated_at },
    elements,
    version: elements.length,
  };
}

// 不存在则创建默认画板（幂等）
export async function ensureBoard(env: EnvLike, boardId: string): Promise<BoardMeta> {
  await ensureTables(env);
  const existing = await getBoard(env, boardId);
  if (existing) return existing.meta;
  const now = Date.now();
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  await db.execute(
    `INSERT OR IGNORE INTO copaint_boards (id, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [boardId, BOARD_WIDTH, BOARD_HEIGHT, now, now]
  );
  return { id: boardId, width: BOARD_WIDTH, height: BOARD_HEIGHT, createdAt: now, updatedAt: now };
}

// 添加元素，返回完整元素
export async function addElement(env: EnvLike, boardId: string, el: Omit<BoardElement, 'createdAt' | 'id'> & { id?: string }): Promise<BoardElement> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  const full: BoardElement = { ...el, id: el.id || randomId(), createdAt: Date.now() };
  const seq = Date.now();
  await db.execute(
    `INSERT INTO copaint_elements (board_id, id, seq, data) VALUES (?, ?, ?, ?)`,
    [boardId, full.id, seq, JSON.stringify(full)]
  );
  await db.execute(`UPDATE copaint_boards SET updated_at = ? WHERE id = ?`, [Date.now(), boardId]);
  return full;
}

// 更新元素（合并字段）
export async function updateElement(
  env: EnvLike, boardId: string, eid: string, patch: Partial<BoardElement>
): Promise<BoardElement | null> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  const row = await db.queryOne<{ data: string }>(
    `SELECT data FROM copaint_elements WHERE board_id = ? AND id = ?`, [boardId, eid]
  );
  if (!row) return null;
  const current: BoardElement = JSON.parse(row.data);
  const next: BoardElement = { ...current, ...patch, id: eid, createdAt: current.createdAt };
  await db.execute(
    `UPDATE copaint_elements SET data = ?, seq = ? WHERE board_id = ? AND id = ?`,
    [JSON.stringify(next), Date.now(), boardId, eid]
  );
  await db.execute(`UPDATE copaint_boards SET updated_at = ? WHERE id = ?`, [Date.now(), boardId]);
  return next;
}

// 删除元素
export async function deleteElement(env: EnvLike, boardId: string, eid: string): Promise<boolean> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  const res = await db.execute(`DELETE FROM copaint_elements WHERE board_id = ? AND id = ?`, [boardId, eid]);
  await db.execute(`UPDATE copaint_boards SET updated_at = ? WHERE id = ?`, [Date.now(), boardId]);
  return (res.changes ?? 0) > 0;
}

// 清空画板
export async function clearBoard(env: EnvLike, boardId: string): Promise<void> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  await db.execute(`DELETE FROM copaint_elements WHERE board_id = ?`, [boardId]);
  await db.execute(`UPDATE copaint_boards SET updated_at = ? WHERE id = ?`, [Date.now(), boardId]);
}

// 批量替换（用于 AI 多元素 / ops）
export async function replaceElements(env: EnvLike, boardId: string, elements: BoardElement[]): Promise<number> {
  await ensureTables(env);
  const db = createDb(env.COP_OCEAN_TOKEN, env.COP_OCEAN_BASE);
  await db.execute(`DELETE FROM copaint_elements WHERE board_id = ?`, [boardId]);
  const now = Date.now();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const seq = now + i;
    await db.execute(
      `INSERT INTO copaint_elements (board_id, id, seq, data) VALUES (?, ?, ?, ?)`,
      [boardId, el.id, seq, JSON.stringify(el)]
    );
  }
  await db.execute(`UPDATE copaint_boards SET updated_at = ? WHERE id = ?`, [now, boardId]);
  return elements.length;
}
