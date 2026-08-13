// 配置数据访问层：基于 Ocean KV 存储，敏感项加密，含短时缓存
import { createKv } from './kv';
import { encrypt, decrypt, isEncrypted } from './crypto';

const CACHE_TTL = 60 * 1000;
const cache = new Map<string, { value: any; expireAt: number }>();

function cacheGet(ns: string, key: string): any | undefined {
  const k = ns + ':' + key;
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.expireAt) {
    cache.delete(k);
    return undefined;
  }
  return hit.value;
}

function cacheSet(ns: string, key: string, value: any) {
  cache.set(ns + ':' + key, { value, expireAt: Date.now() + CACHE_TTL });
}

function cacheInvalidate(ns: string, key?: string) {
  if (key) {
    cache.delete(ns + ':' + key);
  } else {
    const prefix = ns + ':';
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  }
}

async function masterKey(env: Env): Promise<string> {
  return await env.SECRET.get();
}

export function createConfigRepo(env: Env) {
  return {
    // 读配置；未配置返回 null，由调用方决定是否报错（无兜底）
    async get(ns: string, key: string): Promise<string | null> {
      const cached = cacheGet(ns, key);
      if (cached !== undefined) return cached;

      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      const value = await kv.getJson<any>(ns, key);

      let result: string | null = null;
      if (value == null) {
        result = null;
      } else if (typeof value === 'string') {
        result = value;
      } else if (isEncrypted(value)) {
        try {
          result = await decrypt(await masterKey(env), value);
        } catch (e) {
          console.error('Config decrypt failed:', ns, key, e instanceof Error ? e.message : e);
          result = null;
        }
      } else {
        result = String(value);
      }

      cacheSet(ns, key, result);
      return result;
    },

    // 写配置；敏感项加密存储
    async set(ns: string, key: string, value: string, sensitive: boolean): Promise<void> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      let stored: any = value;
      if (sensitive && value) {
        stored = await encrypt(await masterKey(env), value);
      }
      await kv.set(ns, key, stored);
      cacheInvalidate(ns, key);
    },

    // 删除配置
    async remove(ns: string, key: string): Promise<void> {
      const kv = createKv(await env.SECRET.get(), env.COP_DB_BASE || undefined);
      await kv.delete(ns, key);
      cacheInvalidate(ns, key);
    },
  };
}
