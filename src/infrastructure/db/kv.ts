import { createDb, DbError } from './d1-client';

// 命名空间 + 键联合主键的键值存储（独立表名，避免与其他数据冲突）

const kvTableReady = new Map<string, boolean>();
const kvTableError = new Map<string, string | null>();

function connKey(token: string, base?: string): string {
  return token + '|' + (base || '');
}

async function ensureKvTable(token: string, base?: string): Promise<boolean> {
  const ck = connKey(token, base);
  if (kvTableReady.get(ck)) return true;
  if (kvTableError.has(ck)) return false;

  const db = createDb(token, base);
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS copaint_kv (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (namespace, key)
    )`);
    kvTableReady.set(ck, true);
    return true;
  } catch (e) {
    const msg = e instanceof DbError ? e.message : '建表失败';
    kvTableError.set(ck, msg);
    console.error('KV table init error:', msg);
    return false;
  }
}

// 重置状态（仅测试用）
export function _resetKvState() {
  kvTableReady.clear();
  kvTableError.clear();
}

export function createKv(token: string, base?: string) {
  const apiBase = base;
  const ck = connKey(token, base);

  async function ensure(): Promise<boolean> {
    return ensureKvTable(token, apiBase);
  }

  // 返回该连接的建表错误（无错误或未尝试返回 null）
  function error(): string | null {
    return kvTableError.get(ck) || null;
  }

  return {
    ensure,
    error,

    // ─── 读单条（原始值，无 JSON 解析）───
    async get(namespace: string, key: string): Promise<string | null> {
      if (!await ensure()) throw new Error(error() || 'KV 表未就绪');
      const db = createDb(token, apiBase);
      const row = await db.queryOne<{ value: string }>(
        `SELECT value FROM copaint_kv WHERE namespace = ? AND key = ?`,
        [namespace, key]
      );
      if (!row) return null;
      return row.value;
    },

    // ─── 读单条并 JSON 解析 ───
    async getJson<T = any>(namespace: string, key: string): Promise<T | null> {
      const raw = await this.get(namespace, key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    // ─── 读多条（按 namespace） ───
    async list<T = any>(namespace: string, keyPrefix?: string): Promise<Array<{ key: string; value: T }>> {
      if (!await ensure()) throw new Error(error() || 'KV 表未就绪');
      const db = createDb(token, apiBase);
      let rows: Array<{ key: string; value: string }>;
      if (keyPrefix) {
        rows = await db.queryAll(
          `SELECT key, value FROM copaint_kv WHERE namespace = ? AND key LIKE ? ORDER BY key`,
          [namespace, keyPrefix + '%']
        );
      } else {
        rows = await db.queryAll(
          `SELECT key, value FROM copaint_kv WHERE namespace = ? ORDER BY key`,
          [namespace]
        );
      }
      return rows.map(r => {
        let value: any;
        try { value = JSON.parse(r.value); } catch { value = null; }
        return { key: r.key, value: value as T };
      });
    },

    // ─── 写（upsert） ───
    async set<T = any>(namespace: string, key: string, value: T): Promise<void> {
      if (!await ensure()) throw new Error(error() || 'KV 表未就绪');
      const db = createDb(token, apiBase);
      const jsonStr = JSON.stringify(value);
      await db.execute(
        `INSERT INTO copaint_kv (namespace, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET value = ?, updated_at = ?`,
        [namespace, key, jsonStr, localtimeNow(), jsonStr, localtimeNow()]
      );
    },

    // ─── 删单条 ───
    async delete(namespace: string, key: string): Promise<void> {
      if (!await ensure()) throw new Error(error() || 'KV 表未就绪');
      const db = createDb(token, apiBase);
      await db.execute(
        `DELETE FROM copaint_kv WHERE namespace = ? AND key = ?`,
        [namespace, key]
      );
    },

    // ─── 删整个 namespace（或带前缀的子集） ───
    async clear(namespace: string, keyPrefix?: string): Promise<void> {
      if (!await ensure()) throw new Error(error() || 'KV 表未就绪');
      const db = createDb(token, apiBase);
      if (keyPrefix) {
        await db.execute(
          `DELETE FROM copaint_kv WHERE namespace = ? AND key LIKE ?`,
          [namespace, keyPrefix + '%']
        );
      } else {
        await db.execute(
          `DELETE FROM copaint_kv WHERE namespace = ?`,
          [namespace]
        );
      }
    },
  };
}

export function localtimeNow(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}
