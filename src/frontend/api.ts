// REST + WebSocket 封装（统一带令牌鉴权）
import type { BoardElement, BoardState, WsMessage } from '../domain/types';

export const BOARD_ID = 'default';
const TOKEN_KEY = 'copaint_token';

let currentToken = '';
let unauthorizedHandler: (() => void) | null = null;

export function setToken(t: string): void { currentToken = t; }
export function getToken(): string { return currentToken; }
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
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function verifyToken(): Promise<{ ok: boolean }> {
  return req('/api/verify');
}

export function getBoard(): Promise<BoardState> {
  return req(`/api/boards/${BOARD_ID}`);
}

export function addElement(el: Partial<BoardElement> & { id?: string }): Promise<BoardElement> {
  return req(`/api/boards/${BOARD_ID}/elements`, { method: 'POST', body: JSON.stringify(el) });
}

export function updateElement(eid: string, patch: Partial<BoardElement>): Promise<BoardElement> {
  return req(`/api/boards/${BOARD_ID}/elements/${eid}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteElement(eid: string): Promise<{ ok: boolean }> {
  return req(`/api/boards/${BOARD_ID}/elements/${eid}`, { method: 'DELETE' });
}

export function clearBoard(): Promise<{ ok: boolean }> {
  return req(`/api/boards/${BOARD_ID}/clear`, { method: 'POST' });
}

export function runAi(instruction: string, mode: 'once' | 'multi', steps: number, delayMs: number): Promise<{ ok: boolean }> {
  return req(`/api/boards/${BOARD_ID}/ai`, {
    method: 'POST',
    body: JSON.stringify({ instruction, mode, steps, delayMs }),
  });
}

export function exportPngUrl(): string {
  return `/api/boards/${BOARD_ID}/png?token=${encodeURIComponent(currentToken)}`;
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
  const ws = new WebSocket(`${proto}://${location.host}/boards/${BOARD_ID}/ws?token=${encodeURIComponent(currentToken)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsMessage);
    } catch { /* ignore */ }
  };
  return ws;
}