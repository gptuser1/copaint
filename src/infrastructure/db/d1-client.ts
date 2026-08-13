// D1 REST 客户端（Ocean），复用 kbox 的抽象层
const DEFAULT_API_BASE = 'https://ocean.klinux.dpdns.org';
const FETCH_TIMEOUT = 15000;

interface D1Response {
  success: boolean;
  meta?: { served_by: string; changes?: number; duration: number };
  results?: any[];
  error?: string;
}

class DbError extends Error {
  constructor(
    message: string,
    public status: number,
    public context: string
  ) {
    super(message);
    this.name = 'DbError';
  }
}

function headers(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(
  token: string,
  base: string,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
    const res = await fetch(fullUrl, {
      ...options,
      signal: controller.signal,
      headers: { ...headers(token), ...(options.headers as Record<string, string> || {}) },
    });

    const data = await res.json() as T & { error?: string };

    if (!res.ok) {
      throw new DbError(
        data.error || `HTTP ${res.status}`,
        res.status,
        url.split('?')[0]
      );
    }

    return data;
  } catch (e) {
    if (e instanceof DbError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new DbError('请求超时', 408, url.split('?')[0]);
    }
    if (e instanceof TypeError && e.message.includes('fetch')) {
      throw new DbError('网络连接失败', 503, url.split('?')[0]);
    }
    throw new DbError(
      e instanceof Error ? e.message : '未知错误',
      500,
      url.split('?')[0]
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createDb(token: string, base?: string) {
  const apiBase = base || DEFAULT_API_BASE;

  return {
    // 执行任意SQL（支持参数化）
    async query(sql: string, params: any[] = []): Promise<D1Response> {
      return request<D1Response>(token, apiBase, '/query', {
        method: 'POST',
        body: JSON.stringify({ query: sql, params }),
      });
    },

    // 查询并返回结果数组
    async queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const data = await request<D1Response>(token, apiBase, '/query', {
        method: 'POST',
        body: JSON.stringify({ query: sql, params }),
      });
      return data.results || [];
    },

    // 查询并返回单条
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      const rows = await this.queryAll<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },

    // 执行写操作并返回影响行数
    async execute(sql: string, params: any[] = []): Promise<{ changes: number }> {
      const data = await request<D1Response>(token, apiBase, '/query', {
        method: 'POST',
        body: JSON.stringify({ query: sql, params }),
      });
      return { changes: data.meta?.changes || 0 };
    },
  };
}

export { DbError };
