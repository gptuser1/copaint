// REST + WebSocket 封装（统一带令牌鉴权，单一固定画板）
import type { BoardState, WsMessage } from '../domain/types';

const TOKEN_KEY = 'copaint_token';

let currentToken = '';

// 单一固定画板
const currentBoardId = 'default';

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void { unauthorizedHandler = fn; }
export function loadSavedToken(): string {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  currentToken = t;
  return t;
}
export function saveToken(t: string): void {
  currentToken = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}), 'Authorization': 'Bearer ' + currentToken },
  });
  if (res.status === 401) {
    if (unauthorizedHandler) unauthorizedHandler();
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) {
    // 优先取后端返回的 error/code，其次 statusText，给足排查信息
    let msg = res.statusText || `HTTP ${res.status}`;
    let code = '';
    try {
      const body = await res.json();
      if (body && typeof body === 'object') {
        if (body.error) msg = body.error;
        if (body.code) code = String(body.code);
      }
    } catch { /* 非 JSON 响应，保留 statusText */ }
    const err = new Error(code ? `${msg} (${code})` : msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function verifyToken(): Promise<{ ok: boolean }> {
  return req('/api/verify');
}

// 读取画板（不存在则创建）
export function getBoard(): Promise<BoardState> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}`);
}

// 通过 turtle 脚本落笔（前端手绘也统一走 turtle）
export function runTurtle(script: string): Promise<{ ok: boolean; added: number }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/turtle`, {
    method: 'POST',
    body: JSON.stringify({ script }),
  });
}

export function deleteElement(eid: string): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/elements/${eid}`, { method: 'DELETE' });
}

export function clearBoard(): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/clear`, { method: 'POST' });
}

export interface AiParams {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
}

export function runAi(instruction: string, params?: AiParams): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/ai`, {
    method: 'POST',
    body: JSON.stringify({ instruction, ...params }),
  });
}

// 直接测试：不入队，返回解析后的 turtle 脚本（可预览并可执行到画布）
export function testAi(instruction: string, params?: AiParams): Promise<{ ok: boolean; script: string }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/ai/test`, {
    method: 'POST',
    body: JSON.stringify({ instruction, ...params }),
  });
}

// 终止当前队列所有 AI 任务
export function cancelAi(): Promise<{ ok: boolean; epoch: number }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/ai/cancel`, { method: 'POST' });
}

// 换取临时 token（短时效，避免真实 token 出现在 URL 或被转发给 agent）
export function getTemporaryToken(ttl = 300): Promise<{ ok: boolean; token: string; expiresAt: number }> {
  return req('/api/token', { method: 'POST', body: JSON.stringify({ ttl }) });
}

// 导出 PNG：URL 带临时 token，而非明文真实 token（TTL 默认 5 分钟）
export async function exportPngUrl(ttl = 300): Promise<string> {
  const { token } = await getTemporaryToken(ttl);
  return `/api/boards/${encodeURIComponent(currentBoardId)}/png?token=${encodeURIComponent(token)}`;
}

// 配置管理
export interface ConfigItem {
  key: string; desc: string; sensitive: boolean; placeholder?: string; set: boolean; value?: string | null;
}
export function getConfig(): Promise<{ items: ConfigItem[] }> {
  return req('/api/config');
}
export function setConfigItem(key: string, value: string): Promise<{ ok: boolean }> {
  return req(`/api/config/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
}
export function deleteConfigItem(key: string): Promise<{ ok: boolean }> {
  return req(`/api/config/${key}`, { method: 'DELETE' });
}

// WS 连接：先用真实 token 换取临时 token（24h，够长连接和重连周期），
// 避免真实 token 出现在连接 URL 里
export async function connectWs(onMessage: (msg: WsMessage) => void): Promise<WebSocket> {
  const { token } = await getTemporaryToken(86400);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const id = encodeURIComponent(currentBoardId);
  const ws = new WebSocket(`${proto}://${location.host}/boards/${id}/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsMessage);
    } catch { /* ignore */ }
  };
  return ws;
}