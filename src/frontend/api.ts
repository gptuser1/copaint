// REST + WebSocket 封装（统一带令牌鉴权，支持动态画板）
import type { BoardElement, BoardState, WsMessage } from '../domain/types';

const TOKEN_KEY = 'copaint_token';
const BOARD_KEY = 'copaint_board';

let currentToken = '';

// 当前画板：id + 尺寸
let currentBoard = { id: 'default', width: 960, height: 600 };

export function setToken(t: string): void { currentToken = t; }
export function getToken(): string { return currentToken; }
export function getBoardId(): string { return currentBoard.id; }
export function getBoardSize(): { width: number; height: number } { return { width: currentBoard.width, height: currentBoard.height }; }

// 设置当前画板并持久化
export function setBoard(id: string, width: number, height: number): void {
  currentBoard = { id, width, height };
  try { localStorage.setItem(BOARD_KEY, JSON.stringify({ id, width, height })); } catch { /* ignore */ }
}
export function loadSavedBoard(): { id: string; width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (b && b.id) { currentBoard = { id: b.id, width: b.width || 960, height: b.height || 600 }; }
    return currentBoard;
  } catch { return null; }
}

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
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function verifyToken(): Promise<{ ok: boolean }> {
  return req('/api/verify');
}

// 读取或创建画板（不存在且带 size 时按 size 创建）
export function getBoard(size?: { width?: number; height?: number }): Promise<BoardState> {
  const { id } = currentBoard;
  const q = size && (size.width || size.height)
    ? `?width=${size.width || ''}&height=${size.height || ''}`
    : '';
  return req(`/api/boards/${encodeURIComponent(id)}${q}`);
}

export function addElement(el: Partial<BoardElement> & { id?: string }): Promise<BoardElement> {
  return req(`/api/boards/${encodeURIComponent(currentBoard.id)}/elements`, { method: 'POST', body: JSON.stringify(el) });
}

export function updateElement(eid: string, patch: Partial<BoardElement>): Promise<BoardElement> {
  return req(`/api/boards/${encodeURIComponent(currentBoard.id)}/elements/${eid}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteElement(eid: string): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoard.id)}/elements/${eid}`, { method: 'DELETE' });
}

export function clearBoard(): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoard.id)}/clear`, { method: 'POST' });
}

export function runAi(instruction: string, mode: 'once' | 'multi', steps: number, delayMs: number): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(currentBoard.id)}/ai`, {
    method: 'POST',
    body: JSON.stringify({ instruction, mode, steps, delayMs }),
  });
}

export function exportPngUrl(): string {
  return `/api/boards/${encodeURIComponent(currentBoard.id)}/png?token=${encodeURIComponent(currentToken)}`;
}

// 画板清单记录
export interface BoardRecord {
  id: string; width: number; height: number; createdAt: number; updatedAt: number;
}

// 列出全部画板
export function listBoards(): Promise<{ boards: BoardRecord[] }> {
  return req('/api/boards');
}

// 删除画板
export function deleteBoard(id: string): Promise<{ ok: boolean }> {
  return req(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
  const id = encodeURIComponent(currentBoard.id);
  const ws = new WebSocket(`${proto}://${location.host}/boards/${id}/ws?token=${encodeURIComponent(currentToken)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsMessage);
    } catch { /* ignore */ }
  };
  return ws;
}