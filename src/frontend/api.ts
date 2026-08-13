// REST + WebSocket 封装（统一带令牌鉴权，单一固定画板）
import type { BoardElement, BoardState, WsMessage } from '../domain/types';

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

export function addElement(el: Partial<BoardElement> & { id?: string }): Promise<BoardElement> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/elements`, { method: 'POST', body: JSON.stringify(el) });
}

export function updateElement(eid: string, patch: Partial<BoardElement>): Promise<BoardElement> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/elements/${eid}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteElement(eid: string): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/elements/${eid}`, { method: 'DELETE' });
}

export function clearBoard(): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/clear`, { method: 'POST' });
}

export function runAi(instruction: string, mode: 'once' | 'multi', steps: number, delayMs: number): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/ai`, {
    method: 'POST',
    body: JSON.stringify({ instruction, mode, steps, delayMs }),
  });
}

// 直接测试：不入队，返回 LLM 原始响应
export function testAi(instruction: string): Promise<{ ok: boolean; raw: string }> {
  return req(`/api/boards/${encodeURIComponent(currentBoardId)}/ai/test`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
}

export function exportPngUrl(): string {
  return `/api/boards/${encodeURIComponent(currentBoardId)}/png?token=${encodeURIComponent(currentToken)}`;
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

export function connectWs(onMessage: (msg: WsMessage) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const id = encodeURIComponent(currentBoardId);
  const ws = new WebSocket(`${proto}://${location.host}/boards/${id}/ws?token=${encodeURIComponent(currentToken)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsMessage);
    } catch { /* ignore */ }
  };
  return ws;
}