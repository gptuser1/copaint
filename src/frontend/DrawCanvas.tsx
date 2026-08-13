// Konva 画布：绘制工具交互 + 缩放/平移浏览 + 移动端防误触
// 画板固定实际尺寸，通过缩放比例 + 拖动平移查看，不自适应屏幕
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Ellipse } from 'react-konva';
import type { BoardElement, ElementType } from '../domain/types';

interface DrawCanvasProps {
  elements: BoardElement[];
  tool: ElementType;
  color: string;
  strokeWidth: number;
  panMode: boolean;
  onCommit: (el: Partial<BoardElement> & { id?: string }) => void;
  onClear: () => void;
  width: number;
  height: number;
}

interface Draft {
  id: string;
  type: ElementType;
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  x2: number;
  y2: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export function DrawCanvas({ elements, tool, color, strokeWidth, panMode, onCommit, width, height }: DrawCanvasProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const drawingRef = useRef(false);
  const panningRef = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // 监听视口尺寸，作为可平移/裁剪的舞台
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ w: el.clientWidth || 0, h: el.clientHeight || 0 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 切换画板（尺寸变化）时重置缩放与视图
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [width, height]);

  const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  // 取屏幕坐标（兼容鼠标与触摸）
  const screenPos = (e: any): { x: number; y: number } | null => {
    const evt = e && e.evt;
    if (!evt) return null;
    if (evt.touches && evt.touches.length) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
    if (evt.changedTouches && evt.changedTouches.length) return { x: evt.changedTouches[0].clientX, y: evt.changedTouches[0].clientY };
    return { x: evt.clientX, y: evt.clientY };
  };

  const start = useCallback((e: any) => {
    if (panMode) {
      panningRef.current = true;
      lastPointer.current = screenPos(e);
      return;
    }
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    drawingRef.current = true;
    const d: Draft = {
      id: `draft_${Date.now()}`,
      type: tool,
      points: [pos.x, pos.y],
      x: pos.x, y: pos.y, width: 0, height: 0, x2: pos.x, y2: pos.y,
    };
    setDraft(d);
  }, [panMode, tool]);

  const move = useCallback((e: any) => {
    if (panMode) {
      if (!panningRef.current) return;
      const pos = screenPos(e);
      if (pos && lastPointer.current) {
        const z = zoomRef.current;
        setPan((p) => ({
          x: p.x + (pos.x - lastPointer.current!.x) / z,
          y: p.y + (pos.y - lastPointer.current!.y) / z,
        }));
      }
      lastPointer.current = pos;
      return;
    }
    if (!drawingRef.current || !draft) return;
    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    if (tool === 'pen') {
      setDraft({ ...draft, points: [...draft.points, pos.x, pos.y] });
    } else {
      const x = Math.min(draft.x, pos.x);
      const y = Math.min(draft.y, pos.y);
      const w = Math.abs(pos.x - draft.x);
      const h = Math.abs(pos.y - draft.y);
      setDraft({ ...draft, x, y, width: w, height: h, x2: pos.x, y2: pos.y });
    }
  }, [panMode, draft, tool]);

  const end = useCallback(() => {
    if (panMode) {
      panningRef.current = false;
      lastPointer.current = null;
      return;
    }
    if (!drawingRef.current || !draft) return;
    drawingRef.current = false;
    lastPointer.current = null;
    const base = { color, strokeWidth, by: 'user' as const };
    if (tool === 'pen') {
      if (draft.points.length >= 4) {
        onCommit({ type: 'pen', points: draft.points, color, strokeWidth, by: 'user' });
      }
    } else if (tool === 'line') {
      if (draft.width > 2 || draft.height > 2) {
        onCommit({ type: 'line', x: draft.x, y: draft.y, x2: draft.x2, y2: draft.y2, ...base });
      }
    } else {
      if (draft.width > 2 && draft.height > 2) {
        onCommit({ type: tool, x: draft.x, y: draft.y, width: draft.width, height: draft.height, ...base });
      }
    }
    setDraft(null);
  }, [draft, tool, color, strokeWidth, onCommit, panMode]);

  const fit = useCallback(() => {
    const w = viewport.w || 1, h = viewport.h || 1;
    const z = clampZoom(Math.min(w / width, h / height) * 0.9);
    setZoom(z);
    setPan({ x: (w - width * z) / 2, y: (h - height * z) / 2 });
  }, [viewport, width, height]);

  const incZoom = (dir: number) => {
    setZoom((z) => clampZoom(+(z * (1 + 0.2 * dir)).toFixed(3)));
  };

  const renderElement = (el: BoardElement) => {
    const key = el.id;
    switch (el.type) {
      case 'pen':
      case 'eraser':
        return <Line key={key} points={el.points || []} stroke={el.color} strokeWidth={el.strokeWidth} lineCap="round" lineJoin="round" />;
      case 'line':
        return <Line key={key} points={[el.x || 0, el.y || 0, el.x2 || 0, el.y2 || 0]} stroke={el.color} strokeWidth={el.strokeWidth} lineCap="round" />;
      case 'rect':
        return <Rect key={key} x={el.x} y={el.y} width={el.width} height={el.height} stroke={el.color} strokeWidth={el.strokeWidth} />;
      case 'ellipse':
        return <Ellipse key={key} x={(el.x || 0) + (el.width || 0) / 2} y={(el.y || 0) + (el.height || 0) / 2} radiusX={(el.width || 0) / 2} radiusY={(el.height || 0) / 2} stroke={el.color} strokeWidth={el.strokeWidth} />;
      default:
        return null;
    }
  };

  const zBtn: React.CSSProperties = { cursor: 'pointer', width: 26, height: 26, lineHeight: '20px', border: '1px solid #999', background: '#fff', borderRadius: 4 };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '70vh',
        border: '1px solid #ccc',
        background: '#e8eaed',
        overflow: 'hidden',
        // 关键：阻止触摸滚动/双指缩放/下拉刷新，避免误触
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      } as React.CSSProperties}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        width={viewport.w}
        height={viewport.h}
        scaleX={zoom}
        scaleY={zoom}
        x={pan.x}
        y={pan.y}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      >
        <Layer>
          {/* 白色画板底（尺寸 = 画板实际尺寸） */}
          <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
          {elements.map(renderElement)}
          {draft && tool === 'pen' && draft.points.length >= 2 && (
            <Line points={draft.points} stroke={color} strokeWidth={strokeWidth} lineCap="round" lineJoin="round" />
          )}
          {draft && tool === 'rect' && (
            <Rect x={draft.x} y={draft.y} width={draft.width} height={draft.height} stroke={color} strokeWidth={strokeWidth} />
          )}
          {draft && tool === 'ellipse' && (
            <Ellipse x={draft.x + draft.width / 2} y={draft.y + draft.height / 2} radiusX={draft.width / 2} radiusY={draft.height / 2} stroke={color} strokeWidth={strokeWidth} />
          )}
          {draft && tool === 'line' && (
            <Line points={[draft.x, draft.y, draft.x2, draft.y2]} stroke={color} strokeWidth={strokeWidth} lineCap="round" />
          )}
        </Layer>
      </Stage>

      {/* 缩放控制：+/−，滑块，百分比，1:1 重置，适应窗口 */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.92)', border: '1px solid #ccc', borderRadius: 6, padding: '4px 8px' }}>
        <button onClick={() => incZoom(-1)} style={zBtn}>−</button>
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={zoom} onChange={(e) => setZoom(clampZoom(Number(e.target.value)))} title="缩放" style={{ width: 100 }} />
        <button onClick={() => incZoom(1)} style={zBtn}>+</button>
        <span style={{ fontSize: 12, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(1)} title="重置为 100%" style={zBtn}>1:1</button>
        <button onClick={fit} title="适应窗口" style={zBtn}>⤢</button>
      </div>

      {panMode && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 12, color: '#666', background: 'rgba(255,255,255,0.85)', padding: '2px 8px', borderRadius: 4 }}>
          ✋ 拖动平移视图
        </div>
      )}
    </div>
  );
}