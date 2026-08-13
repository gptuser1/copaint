// 画板清单数据访问层：基于 Ocean KV 记录所有已创建画板的元信息
// 用于前端"我的画板"列表与删除管理（DO 仅存单个画板内容，无法枚举）
import { createKv } from './kv';

const NS = 'copaint';
const KEY_PREFIX = 'boards:';

export interface BoardRecord {
  id: string;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export function createBoardRepo(env: Env) {
  return {
    // 取单个画板记录；不存在返回 null
    async get(id: string): Promise<BoardRecord | null> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      return kv.getJson<BoardRecord>(NS, KEY_PREFIX + id);
    },

    // 列出全部画板（按更新时间倒序）
    async list(): Promise<BoardRecord[]> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      const rows = await kv.list<BoardRecord>(NS, KEY_PREFIX);
      return rows
        .map((r) => r.value)
        .filter((v): v is BoardRecord => v != null && !!v.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    // 新增或更新记录
    async upsert(rec: BoardRecord): Promise<void> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      await kv.set(NS, KEY_PREFIX + rec.id, rec);
    },

    // 删除记录
    async remove(id: string): Promise<void> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      await kv.delete(NS, KEY_PREFIX + id);
    },
  };
}