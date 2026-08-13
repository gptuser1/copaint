// 主应用：工具栏 + 画布 + AI 指令 + WebSocket 同步
import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawCanvas } from './DrawCanvas';
import * as api from './api';
import type { BoardElement, ElementType } from '../domain/types';

const TOOLS: { id: ElementType; label: string }[] = [
  { id: 'pen', label: '画笔' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '椭圆' },
  { id: 'line', label: '直线' },
  { id: 'eraser', label: '橡皮' },
];

export function App() {
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<ElementType>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'once' | 'multi'>('once');
  const [steps, setSteps] = useState(5);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');

  const elementsRef = useRef<BoardElement[]>([]);
  elementsRef.current = elements;

  // 初始加载 + WS 实时同步
  useEffect(() => {
    let closed = false;
    api.getBoard().then((s) => { if (!closed) setElements(s.elements); }).catch(() => {});
    let ws = api.connectWs(handleWs);
    let timer: any;
    const reconnect = () => {
      timer = setTimeout(() => { ws = api.connectWs(handleWs); }, 2000);
    };
    function handleWs(msg: { event: string; payload: any }) {
      if (closed) return;
      setElements((prev) => applyWs(prev, msg));
    }
    ws.onclose = () => { if (!closed) reconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    return () => { closed = true; clearTimeout(timer); try { ws.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyWs = (prev: BoardElement[], msg: { event: string; payload: any }): BoardElement[] => {
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
  };

  // 用户绘制提交：乐观更新 + 推送后端（WS 广播会重复，靠 id 去重）
  const handleCommit = useCallback((el: Partial<BoardElement> & { id?: string }) => {
    const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: BoardElement = {
      id: tempId,
      type: el.type!,
      color: el.color || color,
      strokeWidth: el.strokeWidth ?? strokeWidth,
      by: 'user',
      createdAt: Date.now(),
      ...(el.points ? { points: el.points } : {}),
      ...(el.x != null ? { x: el.x } : {}),
      ...(el.y != null ? { y: el.y } : {}),
      ...(el.width != null ? { width: el.width } : {}),
      ...(el.height != null ? { height: el.height } : {}),
      ...(el.x2 != null ? { x2: el.x2 } : {}),
      ...(el.y2 != null ? { y2: el.y2 } : {}),
    };
    setElements((prev) => [...prev, optimistic]);
    api.addElement(el).then((saved) => {
      // 用后端生成的 id 替换乐观 id
      setElements((prev) => prev.map((e) => (e.id === tempId ? saved : e)));
    }).catch((e) => {
      setError(String(e.message || e));
      setElements((prev) => prev.filter((e) => e.id !== tempId));
    });
  }, [color, strokeWidth]);

  const handleClear = useCallback(() => {
    api.clearBoard().then(() => setElements([])).catch((e) => setError(String(e.message || e)));
  }, []);

  const handleAi = useCallback(async () => {
    const instr = instruction.trim();
    if (!instr) return;
    setAiBusy(true);
    setError('');
    try {
      await api.runAi(instr, mode, steps, 2000);
      setInstruction('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setAiBusy(false);
    }
  }, [instruction, mode, steps]);

  const handleExport = useCallback(() => {
    window.open(api.exportPngUrl(), '_blank');
  }, []);

  const btnStyle: React.CSSProperties = { padding: '4px 10px', cursor: 'pointer' };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>🖌️ CoPaint</h2>

      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{ ...btnStyle, background: tool === t.id ? '#dbeafe' : '#fff', border: '1px solid #999' }}
          >
            {t.label}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="颜色" style={{ width: 34, height: 30, padding: 0, border: 'none' }} />
        <input type="number" min={1} max={30} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} title="粗细" style={{ width: 56 }} />
        <button onClick={handleClear} style={{ ...btnStyle, border: '1px solid #999' }}>🗑 清空</button>
        <button onClick={handleExport} style={{ ...btnStyle, border: '1px solid #999' }}>⬇ 导出 PNG</button>
      </div>

      {error && <div style={{ color: '#e74c3c', marginBottom: 8 }}>{error}</div>}

      {/* 画布 */}
      <DrawCanvas
        elements={elements}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        onCommit={handleCommit}
        onClear={handleClear}
        width={960}
        height={600}
      />

      {/* AI 指令 */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAi(); }}
          placeholder="输入指令，如：画一个红色的太阳在左上角"
          style={{ flex: 1, minWidth: 280, padding: 6 }}
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'once' | 'multi')} style={{ padding: 6 }}>
          <option value="once">单次</option>
          <option value="multi">分步</option>
        </select>
        {mode === 'multi' && (
          <>
            <span>步数</span>
            <input type="number" min={1} max={10} value={steps} onChange={(e) => setSteps(Number(e.target.value))} style={{ width: 60, padding: 6 }} />
          </>
        )}
        <button onClick={handleAi} disabled={aiBusy} style={{ ...btnStyle, border: '1px solid #999', background: aiBusy ? '#eee' : '#4caf50', color: aiBusy ? '#999' : '#fff' }}>
          {aiBusy ? '绘制中…' : '🤖 让 AI 画'}
        </button>
      </div>
    </div>
  );
}
