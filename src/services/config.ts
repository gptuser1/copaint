import { createKv } from './kv';
import { encrypt, decrypt, isEncrypted } from './crypto';

export interface ConfigField {
  key: string;
  desc: string;
  sensitive: boolean;
  default?: string;
  placeholder?: string;
  envName?: string;
}

// copaint 独立配置 schema（与 kbox 做 NS 区分，不读 kbox 的 app ns）
export const COP_NS = 'copaint';

const COP_CONFIG_SCHEMA: ConfigField[] = [
  { key: 'openai_api_key',  desc: 'OpenAI API Key',    sensitive: true,  placeholder: 'sk-...', envName: 'COP_OPENAI_API_KEY' },
  { key: 'openai_base_url', desc: 'LLM API 地址',      sensitive: false, default: 'https://api.siliconflow.cn/v1', envName: 'COP_OPENAI_BASE_URL' },
  { key: 'openai_model',    desc: 'LLM 模型名',        sensitive: false, default: 'THUDM/GLM-4-9B-0414', envName: 'COP_OPENAI_MODEL' },
];

const cache = new Map<string, { value: any; expireAt: number }>();
const CACHE_TTL = 60 * 1000;

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

function masterKey(c: any): string {
  return c.env.COP_OCEAN_TOKEN || '';
}

async function readConfig(c: any, ns: string, key: string): Promise<string | null> {
  const cached = cacheGet(ns, key);
  if (cached !== undefined) return cached;

  const kv = createKv(c.env.COP_OCEAN_TOKEN, c.env.COP_OCEAN_BASE);
  const value = await kv.getJson<any>(ns, key);

  let result: string | null = null;
  if (value == null) {
    result = null;
  } else if (typeof value === 'string') {
    result = value;
  } else if (isEncrypted(value)) {
    try {
      result = await decrypt(masterKey(c), value);
    } catch (e) {
      console.error('Config decrypt failed:', ns, key, e instanceof Error ? e.message : e);
      result = null;
    }
  } else {
    result = String(value);
  }

  cacheSet(ns, key, result);
  return result;
}

async function writeConfig(c: any, ns: string, key: string, value: string, sensitive: boolean) {
  const kv = createKv(c.env.COP_OCEAN_TOKEN, c.env.COP_OCEAN_BASE);
  let stored: any = value;
  if (sensitive && value) {
    stored = await encrypt(masterKey(c), value);
  }
  await kv.set(ns, key, stored);
  cacheInvalidate(ns, key);
}

// 读 copaint 配置，含 env 兜底与默认值
export async function getConfig(c: any, key: string): Promise<string | null> {
  const val = await readConfig(c, COP_NS, key);
  if (val != null) return val;

  const field = COP_CONFIG_SCHEMA.find(f => f.key === key);
  if (field?.envName) {
    const envVal = c.env[field.envName];
    if (envVal) return envVal;
  }
  return field?.default || null;
}

export async function getConfigByEnv(env: any, key: string): Promise<string | null> {
  return getConfig({ env }, key);
}

export async function setConfig(c: any, key: string, value: string) {
  const field = COP_CONFIG_SCHEMA.find(f => f.key === key);
  if (!field) throw new Error('未知配置项: ' + key);
  await writeConfig(c, COP_NS, key, value, field.sensitive);
}

export async function deleteConfig(c: any, key: string) {
  const kv = createKv(c.env.COP_OCEAN_TOKEN, c.env.COP_OCEAN_BASE);
  await kv.delete(COP_NS, key);
  cacheInvalidate(COP_NS, key);
}

export function getConfigSchema(): ConfigField[] {
  return COP_CONFIG_SCHEMA;
}
