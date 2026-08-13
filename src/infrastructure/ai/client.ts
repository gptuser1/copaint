// LLM 客户端：把自然语言指令转成画板元素
// 纯基础设施实现，配置由调用方（services/ai）传入，避免向上依赖
import type { BoardElement, ElementType } from '../../domain/types';
import { runTurtle, strokesToElements } from '../turtle';

// AI 不生成橡皮（白色笔触），只生成真实内容元素
const VALID_TYPES: ElementType[] = ['pen', 'rect', 'ellipse', 'line'];

// 喂给 AI 的现有元素上限，避免提示词过大/超时
const MAX_CONTEXT_ELEMENTS = 40;

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DrawInput {
  instruction: string;
  width: number;
  height: number;
  elements: BoardElement[];
  stepHint: string;
}

// LLM 可调参数（可选，未传则用默认）
export interface LlmParams {
  temperature?: number;
  maxTokens?: number;
  // 深度思考开关（enable_thinking），仅思考类模型支持
  thinking?: boolean;
}

// 过滤掉橡皮（白色笔触），避免污染上下文
// 只取最近 MAX_CONTEXT_ELEMENTS 个元素，保留最靠近视觉重点的
function prepareContextElements(elements: BoardElement[]): BoardElement[] {
  const filtered = elements.filter((e) => e.type !== 'eraser' || e.color !== '#ffffff');
  if (filtered.length <= MAX_CONTEXT_ELEMENTS) return filtered;
  // 超限时取后 MAX_CONTEXT_ELEMENTS 个（最新绘制的）
  return filtered.slice(-MAX_CONTEXT_ELEMENTS);
}

function describeElement(e: BoardElement): string {
  if (e.type === 'pen' || e.type === 'eraser') {
    const pts = e.points || [];
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return `pen(范围≈[${Math.round(minX)},${Math.round(minY)}]-[${Math.round(maxX)},${Math.round(maxY)}], ${Math.round(pts.length / 2)}个点, 颜色:${e.color}, 粗细:${e.strokeWidth})`;
  }
  if (e.type === 'line') return `line(起点(${e.x},${e.y})→终点(${e.x2},${e.y2}), 颜色:${e.color}, 粗细:${e.strokeWidth})`;
  return `${e.type}(左上角(${e.x},${e.y}), 宽${e.width}×高${e.height}, 颜色:${e.color}, 粗细:${e.strokeWidth})`;
}

export function buildPrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  existing: BoardElement[],
  stepHint: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const relevant = prepareContextElements(existing);
  const existingSummary = relevant.length > 0
    ? relevant.map((e, i) => `${i + 1}. ${describeElement(e)}`).join('\n')
    : '（空画板）';

  const systemContent =
    `你是画板绘制助手。用户用自然语言下达绘画指令，你把它转成一到多个几何元素。\n`
    + `画布尺寸：宽 ${boardWidth}px，高 ${boardHeight}px，原点在左上角。\n`
    + `元素类型：pen(自由曲线，points为[x0,y0,x1,y1,...]) / rect(x,y,width,height) / ellipse(x,y,width,height) / line(x,y,x2,y2)。\n`
    + `颜色用十六进制如 #e74c3c。所有坐标必须是数字，并限制在画布范围内。\n`
    + '只输出 JSON，不要任何解释或 markdown，格式：\n'
    + '{"elements": [{"type":"rect","x":100,"y":80,"width":200,"height":120,"color":"#3498db","strokeWidth":3}]}\n'
    + `\n${stepHint}`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `当前画板已有内容：\n${existingSummary}\n\n指令：${instruction}` },
  ];
}

export function parseElements(raw: string): Partial<BoardElement>[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\n?([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      try { parsed = JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch { return []; }
    } else {
      return [];
    }
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.elements;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeElement).filter((e): e is Partial<BoardElement> => e != null);
}

function normalizeElement(raw: any, idx: number): Partial<BoardElement> | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type as ElementType;
  if (!VALID_TYPES.includes(type)) return null;
  const el: Partial<BoardElement> = {
    type,
    color: typeof raw.color === 'string' ? raw.color : '#000000',
    strokeWidth: Number.isFinite(raw.strokeWidth) ? raw.strokeWidth : 2,
    by: 'ai',
  };
  if (type === 'pen' || type === 'eraser') {
    if (Array.isArray(raw.points)) el.points = raw.points.map(Number);
  } else if (type === 'line') {
    el.x = num(raw.x); el.y = num(raw.y); el.x2 = num(raw.x2); el.y2 = num(raw.y2);
  } else {
    el.x = num(raw.x); el.y = num(raw.y); el.width = num(raw.width); el.height = num(raw.height);
  }
  el.id = `ai_${Date.now().toString(36)}_${idx}`;
  return el;
}

function num(v: any): number | undefined {
  return Number.isFinite(Number(v)) ? Number(v) : undefined;
}

// 调用 LLM 返回原始文本（不解析，供测试/调试）
export async function generateRawContent(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<string> {
  const messages = buildPrompt(input.instruction, input.width, input.height, input.elements, input.stepHint);
  // 组装可调参数（未传则用默认值）
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: params?.maxTokens ?? 2048,
    temperature: params?.temperature ?? 0.7,
    // 显式非流式，避免服务商侧流式超时（可能导致 524）
    stream: false,
  };
  // 深度思考开关：仅当显式传入时才带上，避免对不支持思考的模型报错
  if (typeof params?.thinking === 'boolean') {
    body.enable_thinking = params.thinking;
  }
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 覆盖 Worker 默认的 cloudflare-workers UA，避免被服务商按来源指纹限流
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM error ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data: { choices?: Array<{ message?: { content?: string } }> } = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// 调用 LLM 生成元素
export async function generateElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<Partial<BoardElement>[]> {
  const content = await generateRawContent(config, input, params);
  return parseElements(content);
}

// ── Turtle 模式：LLM 输出 turtle 脚本，模拟成手绘路径 ──

const TURTLE_COMMANDS_HELP =
  'fd <n> 前进 / bk <n> 后退 / lt <deg> 左转 / rt <deg> 右转\n'
  + 'pu 抬笔 / pd 落笔 / color <颜色> / width <n> 粗细\n'
  + 'goto <x> <y> / repeat <n> { ... } 循环\n'
  + '坐标原点在左上角，y 向下为正；0 度朝右，90 度朝下。';

function buildTurtlePrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  stepHint: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const systemContent =
    '你是 turtle 画板助手。用户用自然语言描述要画的内容，你把它翻译成 turtle 绘图脚本。\n'
    + `画布：宽 ${boardWidth}px，高 ${boardHeight}px，原点左上角，y 向下为正。\n`
    + `可用命令：\n${TURTLE_COMMANDS_HELP}\n`
    + '用画笔的连续移动画出内容，可中途换色(width/color)表现细节，用 repeat 画重复图案。\n'
    + '颜色可用名称或 #hex。只输出脚本，不要解释、不要 markdown 代码块。\n'
    + `\n${stepHint}`;
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `画布尺寸 ${boardWidth}×${boardHeight}。请用 turtle 脚本绘制：${instruction}` },
  ];
}

// 从 LLM 原始输出里剥掉代码块围栏，得到纯脚本
function extractTurtleScript(raw: string): string {
  const fence = raw.match(/```(?:turtle|python)?\n?([\s\S]*?)```/);
  if (fence) return fence[1];
  return raw;
}

export async function generateTurtleElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<Partial<BoardElement>[]> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint);
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: params?.maxTokens ?? 2048,
    temperature: params?.temperature ?? 0.7,
    stream: false,
  };
  if (typeof params?.thinking === 'boolean') body.enable_thinking = params.thinking;
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM error ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data: { choices?: Array<{ message?: { content?: string } }> } = await res.json();
  const script = extractTurtleScript(data?.choices?.[0]?.message?.content || '');
  if (!script.trim()) return [];
  const strokes = runTurtle(script, {
    startX: input.width / 2,
    startY: input.height / 2,
    startHeading: 0,
  });
  return strokesToElements(strokes, { id: `ai_${Date.now().toString(36)}` });
}
