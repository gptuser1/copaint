// 纯领域类型：前后端共享，禁止依赖 worker / Hono

export type ElementType = 'pen' | 'rect' | 'ellipse' | 'line' | 'eraser';

// 画板元素（统一结构，points 用于自由线，其他用 x/y/width/height）
export interface BoardElement {
  id: string;
  type: ElementType;
  // 自由路径点集（pen / eraser）
  points?: number[];
  // 图形（rect / ellipse / line）
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  // 直线端点（line）
  x2?: number;
  y2?: number;
  color: string;
  strokeWidth: number;
  // 创建者标识：用户 / AI / 外部 API
  by: 'user' | 'ai' | 'api';
  createdAt: number;
}

export interface BoardMeta {
  id: string;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface BoardState {
  meta: BoardMeta;
  elements: BoardElement[];
  version: number;
}

// AI 任务（Queues 消息）
export interface AiJob {
  boardId: string;
  instruction: string;
  // 'once': 单次 | 'multi': 多步链式
  mode: 'once' | 'multi';
  stepIndex: number; // 0-based，当前步
  totalSteps: number; // 多步总步数
  delayMs: number;    // 步间间隔
  // LLM 可调参数（前端下发）
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
}

// WebSocket 广播事件类型
export type WsEvent = 'add' | 'update' | 'delete' | 'clear' | 'ops' | 'ai-log';

// WebSocket 广播消息（前端使用）
export interface WsMessage {
  event: WsEvent;
  payload: any;
}
