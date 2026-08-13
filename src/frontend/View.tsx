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

  const btnStyle: React.CSSProperties = { padding: '4px 10px', cursor: 'pointer', background: 'var(--btn-bg)', color: 'var(--text)', border: '1px solid var(--border)' };

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
      <div style={{ padding: 32, maxWidth: 420, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ marginTop: 0 }}>👁 CoPaint 观看模式</h2>
          <button onClick={toggleTheme} style={btnStyle}>{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
        </div>
        <div style={{ marginBottom: 8 }}>输入令牌以观看画布</div>
        <input
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
          placeholder="访问令牌"
          type="password"
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
        {error && <div style={{ color: '#e74c3c', marginTop: 8 }}>{error}</div>}
        <button onClick={handleLogin} style={{ ...btnStyle, marginTop: 12 }}>登录</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>👁 CoPaint 观看模式</h2>
        <button onClick={toggleTheme} style={btnStyle}>{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
      </div>
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