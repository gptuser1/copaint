// REST + WebSocket 封装
import type { BoardElement, BoardState, WsMessage } from '../domain/types';

export const BOARD_ID = 'default';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
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
  return `/api/boards/${BOARD_ID}/png`;
}

export function connectWs(onMessage: (msg: WsMessage) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/boards/${BOARD_ID}/ws`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsMessage);
    } catch { /* ignore */ }
  };
  return ws;
}
