// LLM 客户端：把自然语言指令转成画板元素
// 纯基础设施实现，配置由调用方（services/ai）传入，避免向上依赖
import type { BoardElement, ElementType } from '../../domain/types';

const VALID_TYPES: ElementType[] = ['pen', 'rect', 'ellipse', 'line', 'eraser'];

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

function describeElement(e: BoardElement): string {
  if (e.type === 'pen' || e.type === 'eraser') return `points(${e.points?.length ?? 0})`;
  if (e.type === 'line') return `(${e.x},${e.y})->(${e.x2},${e.y2})`;
  return `(${e.x},${e.y}) ${e.width}x${e.height}`;
}

export function buildPrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  existing: BoardElement[],
  stepHint: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const existingSummary = existing.length > 0
    ? existing.map((e, i) => `${i + 1}. ${e.type} ${describeElement(e)}`).join('\n')
    : '（空画板）';

  const systemContent =
    `你是画板绘制助手。用户用自然语言下达绘画指令，你把它转成一到多个几何元素。\n`
    + `画布尺寸：宽 ${boardWidth}px，高 ${boardHeight}px，原点在左上角。\n`
    + `元素类型：pen(自由曲线，points为[x0,y0,x1,y1,...]) / rect(x,y,width,height) / ellipse(x,y,width,height) / line(x,y,x2,y2) / eraser(同pen)。\n`
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

// 调用 LLM 生成元素
export async function generateElements(
  config: LlmConfig,
  input: DrawInput,
): Promise<Partial<BoardElement>[]> {
  const messages = buildPrompt(input.instruction, input.width, input.height, input.elements, input.stepHint);
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: config.model, messages, max_tokens: 2048, temperature: 0.7 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: { choices?: Array<{ message?: { content?: string } }> } = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return [];
  return parseElements(content);
}
