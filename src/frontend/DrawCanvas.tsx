// Konva 画布：仅绘制工具交互，固定实际尺寸渲染，无缩放/平移
import { useCallback, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Ellipse } from 'react-konva';
import type { BoardElement, ElementType } from '../domain/types';

interface DrawCanvasProps {
  elements: BoardElement[];
  tool: ElementType;
  color: string;
  strokeWidth: number;
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

export function DrawCanvas({ elements, tool, color, strokeWidth, onCommit, width, height }: DrawCanvasProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const drawingRef = useRef(false);

  const start = useCallback((e: any) => {
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
  }, [tool]);

  const move = useCallback((e: any) => {
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
  }, [draft, tool]);

  const end = useCallback(() => {
    if (!drawingRef.current || !draft) return;
    drawingRef.current = false;
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
  }, [draft, tool, color, strokeWidth, onCommit]);

  const renderElement = (el: BoardElement) => {
    const key = el.id;
    switch (el.type) {
      case 'pen':
      case 'eraser': {
        const pts = el.points || [];
        const widths = el.widths || [];
        const colors = el.colors || [];
        const segs: JSX.Element[] = [];
        for (let i = 2; i + 1 < pts.length; i += 2) {
          const idx = (i - 2) / 2;
          segs.push(
            <Line
              key={`${el.id}_${idx}`}
              points={[pts[i - 2], pts[i - 1], pts[i], pts[i + 1]]}
              stroke={colors[idx] || el.color}
              strokeWidth={widths[idx] ?? el.strokeWidth}
              lineCap="round"
              lineJoin="round"
            />,
          );
        }
        return <>{segs}</>;
      }
      case 'line':
        return <Line key={key} points={[el.x || 0, el.y || 0, el.x2 || 0, el.y2 || 0]} stroke={el.color} strokeWidth={el.strokeWidth} lineCap="round" />;
      case 'rect':
        return <Rect key={key} x={el.x} y={el.y} width={el.width} height={el.height} stroke={el.color} strokeWidth={el.strokeWidth} />;
      case 'ellipse':
        return <Ellipse key={key} x={(el.x || 0) + (el.width || 0) / 2} y={(el.y || 0) + (el.height || 0) / 2} radiusX={(el.width || 0) / 2} radiusY={(el.height || 0) / 2} stroke={el.color} strokeWidth={el.strokeWidth} />;
      case 'polygon':
        return <Line key={key} points={el.points || []} closed fill={el.fill} stroke={el.color} strokeWidth={el.strokeWidth || 0} lineJoin="round" />;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        display: 'inline-block',
        border: '1px solid #ccc',
        background: '#fff',
        // 关键：阻止触摸滚动/双指缩放/下拉刷新，避免误触
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      } as React.CSSProperties}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        width={width}
        height={height}
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
    </div>
  );
}