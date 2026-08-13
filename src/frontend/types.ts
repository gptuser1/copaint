// 前端类型（与后端 BoardElement 对齐）
export type ElementType = 'pen' | 'rect' | 'ellipse' | 'line' | 'eraser';

export interface BoardElement {
  id: string;
  type: ElementType;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  color: string;
  strokeWidth: number;
  by: string;
  createdAt: number;
}

export interface BoardState {
  meta: { id: string; width: number; height: number; createdAt: number; updatedAt: number };
  elements: BoardElement[];
  version: number;
}

export interface WsMessage {
  event: 'add' | 'update' | 'delete' | 'clear' | 'ops';
  payload: any;
}
