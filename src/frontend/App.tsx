// 主应用：令牌登录 + 工具栏 + 画布 + AI 指令 + 配置 + WebSocket 同步
// 采用单一固定尺寸画板（400×300）
import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawCanvas } from './DrawCanvas';
import * as api from './api';
import { useTheme } from './theme';
import type { BoardElement, ElementType } from '../domain/types';

const TOOLS: { id: ElementType; label: string }[] = [
  { id: 'pen', label: '画笔' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '椭圆' },
  { id: 'line', label: '直线' },
];

// 画板固定尺寸
const BOARD_WIDTH = 400;
const BOARD_HEIGHT = 300;

// 画布坐标（左上原点、y 向下）→ turtle 逻辑坐标（中心原点、y 向上）
function turtlePt(x: number, y: number): string {
  const lx = Math.round(x - BOARD_WIDTH / 2);
  const ly = Math.round(BOARD_HEIGHT / 2 - y);
  return `${lx} ${ly}`;
}

// 把一次手绘动作翻译成 turtle 脚本（前端统一走 turtle 落笔）
// 先抬笔(pu)移到起点再落笔(pd)，避免从原点拉出一条引线
function elementToTurtleScript(el: Partial<BoardElement> & { id?: string }): string {
  const lines: string[] = [`color ${el.color || '#000000'}`, `width ${el.strokeWidth ?? 3}`];
  const type = el.type;
  const move = (px: number, py: number) => lines.push(`goto ${turtlePt(px, py)}`);
  if (type === 'pen') {
    const pts = el.points || [];
    if (pts.length >= 4) {
      lines.push('pu');
      move(pts[0], pts[1]);
      lines.push('pd');
      for (let i = 2; i + 1 < pts.length; i += 2) move(pts[i], pts[i + 1]);
    }
  } else if (type === 'line') {
    lines.push('pu');
    move(el.x || 0, el.y || 0);
    lines.push('pd');
    move(el.x2 || 0, el.y2 || 0);
  } else if (type === 'rect') {
    const x = el.x || 0, y = el.y || 0, w = el.width || 0, h = el.height || 0;
    lines.push('pu');
    move(x, y);
    lines.push('pd');
    for (const [px, py] of [[x + w, y], [x + w, y + h], [x, y + h], [x, y]]) {
      move(px, py);
    }
  } else if (type === 'ellipse') {
    const cx = (el.x || 0) + (el.width || 0) / 2;
    const cy = (el.y || 0) + (el.height || 0) / 2;
    lines.push('pu');
    move(cx, cy);
    lines.push(`ellipse ${Math.max(0.5, (el.width || 0) / 2)} ${Math.max(0.5, (el.height || 0) / 2)}`);
  }
  return lines.join('\n');
}

// AI 执行日志条目
interface AiLog {
  id: number;
  time: string;
  message: string;
  success?: boolean;
  error?: string;
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [authed, setAuthed] = useState(false);
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<ElementType>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [instruction, setInstruction] = useState('');
  // 最近一次"测试 AI"返回的 turtle 脚本，可预览并选择执行到画布
  const [testScript, setTestScript] = useState('');
  // LLM 可调参数（字符串态，允许输入框删到空，提交时再解析成数字）
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('2048');
  const [thinking, setThinking] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // 单一固定画板
  const board = { id: 'default', width: BOARD_WIDTH, height: BOARD_HEIGHT };

  // AI 执行日志
  const [aiLogs, setAiLogs] = useState<AiLog[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const logSeq = useRef(0);

  const addLog = useCallback((partial: Omit<AiLog, 'id' | 'time'>) => {
    const t = new Date();
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    setAiLogs((prev) => [...prev, { id: ++logSeq.current, time, ...partial }].slice(-200));
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [aiLogs]);

  const elementsRef = useRef<BoardElement[]>([]);
  elementsRef.current = elements;

  // 令牌失效回调：回到登录态
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      api.saveToken('');
      setAuthed(false);
    });
  }, []);

  // 首次进入：尝试用已保存令牌自动验证
  useEffect(() => {
    const saved = api.loadSavedToken();
    if (!saved) { setAuthed(false); return; }
    setTokenInput(saved);
    api.verifyToken().then(() => setAuthed(true)).catch(() => {
      api.saveToken('');
      setAuthed(false);
    });
  }, []);

  // 登录：验证令牌并保存
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

  const handleLogout = useCallback(() => {
    api.saveToken('');
    setAuthed(false);
  }, []);

  // 初始加载 + WS 实时同步
  useEffect(() => {
    if (!authed) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: any;
    api.getBoard().then((s) => {
      if (closed) return;
      setElements(s.elements);
    }).catch(() => {});
    function handleWs(msg: { event: string; payload: any }) {
      if (closed) return;
      if (msg.event === 'ai-log') {
        const p = msg.payload || {};
        addLog({
          message: p.message || 'AI 完成',
          success: !!p.success,
          error: p.error || '',
        });
        return;
      }
      setElements((prev) => applyWs(prev, msg));
    }
    // connectWs 需先异步换取临时 token；失败则延迟重连
    const connect = async () => {
      if (closed) return;
      try {
        const next = await api.connectWs(handleWs);
        if (closed) { try { next.close(); } catch {} return; }
        ws = next;
        next.onclose = () => { if (!closed) reconnect(); };
        next.onerror = () => { try { next.close(); } catch {} };
      } catch {
        reconnect();
      }
    };
    const reconnect = () => {
      timer = setTimeout(connect, 2000);
    };
    connect();
    return () => { closed = true; clearTimeout(timer); try { ws?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

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

  // 用户手绘提交：翻译成 turtle 脚本，经 /turtle 落笔后回读画布
  const handleCommit = useCallback(async (el: Partial<BoardElement> & { id?: string }) => {
    const script = elementToTurtleScript(el);
    if (!script.trim()) return;
    setError('');
    try {
      await api.runTurtle(script);
      const s = await api.getBoard();
      setElements(s.elements);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, []);

  // 撤销：移除最后一个元素
  const handleUndo = useCallback(() => {
    setElements((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      api.deleteElement(last.id).catch(() => {});
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    api.clearBoard().then(() => setElements([])).catch((e) => setError(String(e.message || e)));
  }, []);

  // 数字输入：空串/非法回退默认值
  const parseNum = (s: string, fallback: number): number => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? n : fallback;
  };

  const handleAi = useCallback(async () => {
    const instr = instruction.trim();
    if (!instr) return;
    setAiBusy(true);
    setError('');
    try {
      await api.runAi(instr, {
        temperature: parseNum(temperature, 0.7),
        maxTokens: parseNum(maxTokens, 2048),
        thinking,
      });
      setInstruction('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setAiBusy(false);
    }
  }, [instruction, temperature, maxTokens, thinking]);

  const handleExport = useCallback(async () => {
    try {
      const url = await api.exportPngUrl();
      window.open(url, '_blank');
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, []);

  // 测试 AI：直接请求不入队，把返回的 turtle 脚本保存，可在下方预览并选择执行到画布
  const handleTestAi = useCallback(async () => {
    const instr = instruction.trim();
    if (!instr) return;
    setAiBusy(true);
    setError('');
    try {
      const res = await api.testAi(instr, {
        temperature: parseNum(temperature, 0.7),
        maxTokens: parseNum(maxTokens, 2048),
        thinking,
      });
      setTestScript(res.script);
      addLog({ message: res.script ? `🔬 测试完成，脚本已就绪，可点击「执行到画布」` : '🔬 测试完成，但未返回有效脚本', success: true });
    } catch (e) {
      const msg = String((e as Error).message || e);
      addLog({ message: `🔬 测试失败: ${msg}`, success: false, error: msg });
    } finally {
      setAiBusy(false);
    }
  }, [instruction, addLog, temperature, maxTokens, thinking]);

  // 执行测试生成的脚本到画布（与"让 AI 画"同样走 /turtle 落笔）
  const handleApplyTest = useCallback(async () => {
    const script = testScript.trim();
    if (!script) return;
    setError('');
    setAiBusy(true);
    try {
      const res = await api.runTurtle(script);
      addLog({ message: `▶ 已执行测试脚本 → 生成 ${res.added} 个元素`, success: true });
      const s = await api.getBoard();
      setElements(s.elements);
      setTestScript('');
    } catch (e) {
      const msg = String((e as Error).message || e);
      addLog({ message: `▶ 执行测试脚本失败: ${msg}`, success: false, error: msg });
    } finally {
      setAiBusy(false);
    }
  }, [testScript, addLog]);

  // 终止当前队列所有 AI 任务
  const handleCancelAi = useCallback(async () => {
    setError('');
    try {
      const res = await api.cancelAi();
      addLog({ message: `⏹ 已终止 AI 队列（epoch=${res.epoch}），排队的旧任务将被跳过`, success: true });
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [addLog]);

  const btnStyle: React.CSSProperties = { padding: '4px 10px', cursor: 'pointer', background: 'var(--btn-bg)', color: 'var(--text)', border: '1px solid var(--border)' };

  // 未登录：令牌输入界面
  if (!authed) {
    return (
      <div style={{ padding: 32, maxWidth: 420, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ marginTop: 0 }}>🖌️ CoPaint</h2>
          <button onClick={toggleTheme} style={btnStyle}>{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
        </div>
        <div style={{ marginBottom: 8 }}>请输入访问令牌以继续</div>
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
      <h2 style={{ marginTop: 0 }}>🖌️ CoPaint</h2>

      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={toggleTheme} style={btnStyle}>{theme === 'dark' ? '☀ 亮色' : '🌙 暗色'}</button>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{ ...btnStyle, background: tool === t.id ? 'var(--btn-active)' : 'var(--btn-bg)' }}
          >
            {t.label}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="颜色" style={{ width: 34, height: 30, padding: 0, border: 'none' }} />
        <input type="number" min={1} max={30} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} title="粗细" style={{ width: 56 }} />
        <button onClick={handleUndo} style={btnStyle}>↩ 撤销</button>
        <button onClick={handleClear} style={btnStyle}>🗑 清空</button>
        <button onClick={handleExport} style={btnStyle}>⬇ 导出 PNG</button>
        <button onClick={() => setShowConfig((s) => !s)} style={btnStyle}>⚙ 配置</button>
        <button onClick={handleLogout} style={btnStyle}>退出</button>
      </div>

      {/* 当前画板信息 */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        画板：{board.width} × {board.height}
      </div>

      {error && <div style={{ color: '#e74c3c', marginBottom: 8 }}>{error}</div>}

      {/* 配置面板 */}
      {showConfig && <ConfigPanel onError={setError} />}

      {/* 画布 */}
      <DrawCanvas
        elements={elements}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        onCommit={handleCommit}
        onClear={handleClear}
        width={board.width}
        height={board.height}
        theme={theme}
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
        <button onClick={handleAi} disabled={aiBusy} style={{ ...btnStyle, background: aiBusy ? 'var(--btn-bg)' : '#4caf50', color: aiBusy ? 'var(--muted)' : '#fff' }}>
          {aiBusy ? '处理中…' : '🤖 让 AI 画'}
        </button>
        <button onClick={handleTestAi} disabled={aiBusy} style={{ ...btnStyle, background: aiBusy ? 'var(--btn-bg)' : '#4c1d95', color: aiBusy ? 'var(--muted)' : '#e9d5ff' }}>
          {aiBusy ? '处理中…' : '🔬 测试 AI'}
        </button>
        <button onClick={handleCancelAi} style={{ ...btnStyle, background: '#7f1d1d', color: '#fecaca', border: '1px solid #f87171' }}>⏹ 终止 AI 任务</button>
        <button onClick={() => setAiLogs([])} style={btnStyle}>清空日志</button>
      </div>

      {/* LLM 可调参数 */}
      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--muted)' }}>
        <label title="随机性，0-2，越高越发散">
          温度
          <input type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ width: 60, marginLeft: 4, padding: 4 }} />
        </label>
        <label title="最大回复 token 数">
          max_tokens
          <input type="number" min={64} max={8192} step={64} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} style={{ width: 80, marginLeft: 4, padding: 4 }} />
        </label>
        <label title="深度思考开关，仅思考类模型生效">
          <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} style={{ marginRight: 4 }} />
          深度思考
        </label>
      </div>

      {/* 测试结果：预览 AI 生成的 turtle 脚本，可选择执行到画布 */}
      {testScript.trim() !== '' && (
        <div style={{ marginTop: 12, border: '1px solid #4c1d95', borderRadius: 6, padding: 10, background: 'var(--bg)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>🔬 测试脚本（预览）</span>
            <button onClick={handleApplyTest} disabled={aiBusy} style={{ ...btnStyle, background: '#4c1d95', color: '#e9d5ff' }}>
              {aiBusy ? '执行中…' : '▶ 执行到画布'}
            </button>
            <button onClick={() => setTestScript('')} style={btnStyle}>清空</button>
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.5,
              background: '#0f1117',
              color: '#d6d6d6',
              borderRadius: 4,
              padding: 8,
            }}
          >
            {testScript}
          </pre>
        </div>
      )}

      {/* AI 执行日志 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>🤖 AI 执行日志</div>
        <div
          ref={logBoxRef}
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            background: '#0f1117',
            color: '#d6d6d6',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.6,
            padding: 8,
            height: 150,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {aiLogs.length === 0 && <div style={{ color: '#666' }}>暂无日志，提交 AI 指令后将在此显示执行结果。</div>}
          {aiLogs.map((log) => (
            <div key={log.id}>
              <span style={{ color: '#888' }}>{log.time}</span>{' '}
              <span style={{ color: log.success === false ? '#ff6b6b' : '#d6d6d6' }}>{log.message}</span>
              {log.error && <div style={{ color: '#ff8787', marginLeft: 8, whiteSpace: 'pre-wrap' }}>{log.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 配置面板：读写 LLM 配置
function ConfigPanel({ onError }: { onError: (msg: string) => void }) {
  const [items, setItems] = useState<api.ConfigItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getConfig().then((d) => {
      setItems(d.items);
      setLoaded(true);
    }).catch((e) => onError(String(e.message || e)));
  }, [onError]);

  const save = (key: string) => {
    const v = values[key] || '';
    api.setConfigItem(key, v).then(() => {
      onError('');
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, set: true } : it)));
    }).catch((e) => onError(String(e.message || e)));
  };

  const remove = (key: string) => {
    api.deleteConfigItem(key).then(() => {
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, set: false } : it)));
    }).catch((e) => onError(String(e.message || e)));
  };

  if (!loaded) return <div style={{ marginBottom: 10, color: '#888' }}>加载配置中…</div>;

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 10, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>LLM 配置</h3>
      {items.map((it) => (
        <div key={it.key} style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontWeight: 600 }}>{it.desc} {it.set && <span style={{ color: '#2ecc71' }}>已配置</span>}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={it.sensitive ? 'password' : 'text'}
              placeholder={it.placeholder || it.key}
              value={values[it.key] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [it.key]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') save(it.key); }}
              style={{ flex: 1, padding: 6 }}
            />
            <button onClick={() => save(it.key)} style={{ cursor: 'pointer' }}>保存</button>
            {it.set && <button onClick={() => remove(it.key)} style={{ cursor: 'pointer' }}>删除</button>}
          </div>
        </div>
      ))}
    </div>
  );
}