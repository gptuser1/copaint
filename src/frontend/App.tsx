// 主应用：令牌登录 + 工具栏 + 画布 + AI 指令 + 配置 + WebSocket 同步
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

// 预设画板尺寸
const PRESETS: { id: string; width: number; height: number }[] = [
  { id: '默认', width: 960, height: 600 },
  { id: '手机', width: 375, height: 667 },
  { id: '平板', width: 768, height: 1024 },
  { id: 'A4竖版', width: 595, height: 842 },
  { id: 'A4横版', width: 842, height: 595 },
];

// AI 执行日志条目
interface AiLog {
  id: number;
  time: string;
  message: string;
  mode: 'once' | 'multi';
  step?: number;
  totalSteps?: number;
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<ElementType>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [panMode, setPanMode] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'once' | 'multi'>('once');
  const [steps, setSteps] = useState(5);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // 画板信息 + 新建画板界面
  const [board, setBoard] = useState({ id: 'default', width: 960, height: 600 });
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [bId, setBId] = useState('');
  const [bPreset, setBPreset] = useState('默认');
  const [bCustom, setBCustom] = useState(false);
  const [bWidth, setBWidth] = useState(0);
  const [bHeight, setBHeight] = useState(0);
  const [boardTab, setBoardTab] = useState<'create' | 'list'>('create');
  const [boards, setBoards] = useState<api.BoardRecord[]>([]);

  // 打开画板管理面板时刷新画板列表
  useEffect(() => {
    if (!showBoardForm) return;
    api.listBoards().then((d) => setBoards(d.boards)).catch(() => {});
  }, [showBoardForm]);

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
    // 恢复上次画板（id + 尺寸）
    const b = api.loadSavedBoard();
    if (b) setBoard({ id: b.id, width: b.width, height: b.height });
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
    api.getBoard().then((s) => {
      if (closed) return;
      setElements(s.elements);
      setBoard({ id: s.meta.id, width: s.meta.width, height: s.meta.height });
    }).catch(() => {});
    let ws = api.connectWs(handleWs);
    let timer: any;
    const reconnect = () => {
      timer = setTimeout(() => { ws = api.connectWs(handleWs); }, 2000);
    };
    function handleWs(msg: { event: string; payload: any }) {
      if (closed) return;
      if (msg.event === 'ai-log') {
        const p = msg.payload || {};
        addLog({
          message: p.message || 'AI 完成',
          mode: p.mode || 'once',
          step: p.step,
          totalSteps: p.totalSteps,
        });
        return;
      }
      setElements((prev) => applyWs(prev, msg));
    }
    ws.onclose = () => { if (!closed) reconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    return () => { closed = true; clearTimeout(timer); try { ws.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, board.id]);

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

  // 用户绘制提交：乐观更新 + 推送后端
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

  // 新建 / 切换画板
  const handleCreateBoard = useCallback(() => {
    const id = (bId || bPreset).trim();
    if (!id) { setError('请输入画板 ID'); return; }
    let w = board.width, h = board.height;
    if (bCustom) {
      if (!(bWidth > 0 && bHeight > 0)) { setError('请输入有效的宽高'); return; }
      w = Math.round(bWidth); h = Math.round(bHeight);
    } else {
      const p = PRESETS.find((x) => x.id === bPreset);
      if (p) { w = p.width; h = p.height; }
    }
    setError('');
    api.setBoard(id, w, h);
    setBoard({ id, width: w, height: h });
    setShowBoardForm(false);
    setBId('');
    setBCustom(false);
    setElements([]);
    setAiLogs([]);
  }, [bId, bPreset, bCustom, bWidth, bHeight, board.width, board.height]);

  // 打开已有画板
  const handleOpenBoard = useCallback((rec: api.BoardRecord) => {
    api.setBoard(rec.id, rec.width, rec.height);
    setBoard({ id: rec.id, width: rec.width, height: rec.height });
    setElements([]);
    setAiLogs([]);
    setShowBoardForm(false);
  }, []);

  // 删除画板
  const handleRemoveBoard = useCallback(async (rec: api.BoardRecord) => {
    if (!window.confirm(`确定删除画板"${rec.id}"？其内容将不可恢复。`)) return;
    try {
      await api.deleteBoard(rec.id);
      if (rec.id === board.id) {
        // 当前画板被删，切回默认
        api.setBoard('default', 960, 600);
        setBoard({ id: 'default', width: 960, height: 600 });
        setElements([]);
        setAiLogs([]);
      }
      const d = await api.listBoards();
      setBoards(d.boards);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [board.id]);

  const fmtTime = useCallback((t: number) => {
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const btnStyle: React.CSSProperties = { padding: '4px 10px', cursor: 'pointer' };

  // 未登录：令牌输入界面
  if (!authed) {
    return (
      <div style={{ padding: 32, maxWidth: 420, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <h2>🖌️ CoPaint</h2>
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
        <button onClick={handleLogin} style={{ ...btnStyle, marginTop: 12, border: '1px solid #999' }}>登录</button>
      </div>
    );
  }

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
        <button onClick={() => setPanMode((v) => !v)} style={{ ...btnStyle, border: '1px solid #999', background: panMode ? '#fde68a' : '#fff' }}>✋ 平移</button>
        <button onClick={handleClear} style={{ ...btnStyle, border: '1px solid #999' }}>🗑 清空</button>
        <button onClick={handleExport} style={{ ...btnStyle, border: '1px solid #999' }}>⬇ 导出 PNG</button>
        <button onClick={() => setShowBoardForm((s) => !s)} style={{ ...btnStyle, border: '1px solid #999' }}>🖼 画板</button>
        <button onClick={() => setShowConfig((s) => !s)} style={{ ...btnStyle, border: '1px solid #999' }}>⚙ 配置</button>
        <button onClick={handleLogout} style={{ ...btnStyle, border: '1px solid #999' }}>退出</button>
      </div>

      {/* 当前画板信息 */}
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        当前画板：<b>{board.id}</b>（{board.width} × {board.height}）
      </div>

      {/* 画板管理：新建 / 我的画板 分开 */}
      {showBoardForm && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 10, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setBoardTab('create')} style={{ ...btnStyle, background: boardTab === 'create' ? '#dbeafe' : '#fff', border: '1px solid #999' }}>➕ 新建画板</button>
            <button onClick={() => setBoardTab('list')} style={{ ...btnStyle, background: boardTab === 'list' ? '#dbeafe' : '#fff', border: '1px solid #999' }}>🗂 我的画板（{boards.length}）</button>
          </div>

          {boardTab === 'create' && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                「画板 ID」是该画板的唯一标识：输入一个<b>没使用过的 ID</b> 即为<u>新建</u>；若该 ID
                已存在，则<u>直接打开</u>这个已存在的画板。
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <label style={{ fontWeight: 600 }}>画板 ID</label>
                <input value={bId} onChange={(e) => setBId(e.target.value)} placeholder="如：会议草图" style={{ padding: 6, flex: 1, minWidth: 180 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <label style={{ fontWeight: 600 }}>尺寸参考</label>
                <span style={{ fontSize: 12, color: '#888' }}>当前屏幕：{window.innerWidth} × {window.innerHeight}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                {PRESETS.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="preset"
                      checked={!bCustom && bPreset === p.id}
                      onChange={() => { setBPreset(p.id); setBCustom(false); }}
                    />
                    {p.id} {p.width}×{p.height}
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="radio" name="preset" checked={bCustom} onChange={() => setBCustom(true)} />
                  自定义
                </label>
              </div>
              {bCustom && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <label>宽</label>
                  <input type="number" min={10} value={bWidth || ''} placeholder={String(window.innerWidth)} onChange={(e) => setBWidth(Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                  <label>高</label>
                  <input type="number" min={10} value={bHeight || ''} placeholder={String(window.innerHeight)} onChange={(e) => setBHeight(Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                </div>
              )}
              <button onClick={handleCreateBoard} style={{ ...btnStyle, border: '1px solid #999', background: '#4a90d9', color: '#fff' }}>✅ 新建 / 打开画板</button>
            </div>
          )}

          {boardTab === 'list' && (
            <div>
              {boards.length === 0 && <div style={{ color: '#888', fontSize: 13 }}>还没有画板，切到「新建画板」创建一个。</div>}
              {boards.map((rec) => (
                <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.id} {rec.id === board.id && <span style={{ color: '#2ecc71', fontSize: 12 }}>（当前）</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>{rec.width} × {rec.height}　更新于 {fmtTime(rec.updatedAt)}</div>
                  </div>
                  <button onClick={() => handleOpenBoard(rec)} style={{ ...btnStyle, border: '1px solid #999' }}>打开</button>
                  <button onClick={() => handleRemoveBoard(rec)} style={{ ...btnStyle, border: '1px solid #e74c3c', color: '#e74c3c' }}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: '#e74c3c', marginBottom: 8 }}>{error}</div>}

      {/* 配置面板 */}
      {showConfig && <ConfigPanel onError={setError} />}

      {/* 画布 */}
      <DrawCanvas
        elements={elements}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        panMode={panMode}
        onCommit={handleCommit}
        onClear={handleClear}
        width={board.width}
        height={board.height}
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
        <button onClick={() => setAiLogs([])} style={{ ...btnStyle, border: '1px solid #999' }}>清空日志</button>
      </div>

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
              <span style={{ color: log.mode === 'multi' ? '#7fd5ff' : '#7ee787' }}>
                {log.mode === 'multi' && log.step != null ? `[步骤 ${log.step + 1}/${log.totalSteps}] ` : ''}
              </span>
              {log.message}
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