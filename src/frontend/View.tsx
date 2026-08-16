// 观看模式：仅画布展示 + 主题切换，无编辑工具
import { useCallback, useEffect, useState } from 'react';
import { DrawCanvas } from './DrawCanvas';
import * as api from './api';
import { useTheme } from './theme';
import type { BoardElement } from '../domain/types';

const BOARD_WIDTH = 400;
const BOARD_HEIGHT = 300;

export function View() {
  const [theme, toggleTheme] = useTheme();
  const [authed, setAuthed] = useState(false);
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      api.saveToken('');
      setAuthed(false);
    });
  }, []);

  useEffect(() => {
    const saved = api.loadSavedToken();
    if (!saved) { setAuthed(false); return; }
    setTokenInput(saved);
    api.verifyToken().then(() => setAuthed(true)).catch(() => {
      api.saveToken('');
      setAuthed(false);
    });
  }, []);

  // 一旦登录，轮询画布
  const handleLogin = useCallback(async () => {
    const t = tokenInput.trim();
    if (!t) { setError('请输入令牌'); return; }
    setError('');
    api.saveToken(t);
    try {
      await api.verifyToken();
      setAuthed(true);
    } catch (e) {
      api.saveToken('');
      setError(String((e as Error).message === 'UNAUTHORIZED' ? '令牌无效' : e));
    }
  }, [tokenInput]);

  useEffect(() => {
    if (!authed) return;
    let closed = false;
    const poll = () => {
      api.getBoard().then((s) => { if (!closed) setElements(s.elements); }).catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 2000);
    // 另开 WS 获取实时更新
    let ws: WebSocket | null = null;
    const connect = async () => {
      if (closed) return;
      try {
        const next = await api.connectWs((msg) => {
          if (closed) return;
          if (!['add', 'update', 'delete', 'clear'].includes(msg.event)) return;
          setElements((prev) => {
            switch (msg.event) {
              case 'add': {
                const el = msg.payload as BoardElement;
                if (prev.some((e) => e.id === el.id)) return prev;
                return [...prev, el];
              }
              case 'update': {
                const el = msg.payload as BoardElement;
                return prev.map((e) => (e.id === el.id ? el : e));
              }
              case 'delete':
                return prev.filter((e) => e.id !== msg.payload.id);
              case 'clear':
                return [];
              default:
                return prev;
            }
          });
        });
        if (closed) { try { next.close(); } catch {} return; }
        ws = next;
        next.onclose = () => { if (!closed) setTimeout(connect, 3000); };
        next.onerror = () => { try { next.close(); } catch {} };
      } catch {
        if (!closed) setTimeout(connect, 3000);
      }
    };
    connect();
    return () => { closed = true; clearInterval(timer); try { ws?.close(); } catch {} };
  }, [authed]);

  if (!authed) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="auth-title" style={{ margin: 0 }}>👁 CoPaint 观看模式</h2>
            <button onClick={toggleTheme} className="btn-ghost" title="切换主题">{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
          </div>
          <div className="auth-sub">输入令牌以观看画布</div>
          <input
            className="auth-field"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
            placeholder="访问令牌"
            type="password"
          />
          {error && <p className="auth-error">{error}</p>}
          <button onClick={handleLogin} className="btn-primary auth-btn">登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>👁 CoPaint 观看模式</h2>
          <div className="page-sub">实时投影画布</div>
        </div>
        <button onClick={toggleTheme} className="btn-ghost" title="切换主题">{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
      </header>
      <DrawCanvas
        elements={elements}
        tool="pen"
        color="#000000"
        strokeWidth={3}
        onCommit={() => {}}
        onClear={() => {}}
        width={BOARD_WIDTH}
        height={BOARD_HEIGHT}
        theme={theme}
        readOnly
      />
    </div>
  );
}