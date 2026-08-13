// LLM 客户端：把自然语言指令转成 turtle 脚本，再落笔成画板元素
// 纯基础设施实现，配置由调用方（services/ai）传入，避免向上依赖
import type { BoardElement } from '../../domain/types';
import { runTurtle, turtleToElements } from '../turtle';

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

// 把画布已有元素转成精简摘要（转成 turtle 逻辑坐标：中心原点、y 向上），
// 注入提示词让 AI 感知已画内容，多步/延续绘制时避免重叠或重复
function summarizeElements(elements: BoardElement[], width: number, height: number): string {
  const MAX = 40; // 只摘要最近 40 个，避免提示词过大
  const halfW = width / 2;
  const halfH = height / 2;
  // 画布坐标（左上原点、y 向下）→ 逻辑坐标（中心原点、y 向上）
  const lx = (x: number) => Math.round(x - halfW);
  const ly = (y: number) => Math.round(halfH - y);
  const lines: string[] = [];
  for (const e of elements.slice(-MAX)) {
    let desc = '';
    if (e.type === 'pen' || e.type === 'eraser') {
      const pts = e.points || [];
      if (pts.length < 4) continue;
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const cx = lx((Math.min(...xs) + Math.max(...xs)) / 2);
      const cy = ly((Math.min(...ys) + Math.max(...ys)) / 2);
      desc = `${e.type} 中心(${cx},${cy}) 约${Math.round(pts.length / 2)}点`;
    } else if (e.type === 'line') {
      const x = e.x ?? 0, y = e.y ?? 0, x2 = e.x2 ?? 0, y2 = e.y2 ?? 0;
      desc = `line (${lx(x)},${ly(y)})→(${lx(x2)},${ly(y2)})`;
    } else if (e.type === 'polygon') {
      const pts = e.points || [];
      if (pts.length < 4) continue;
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const cx = lx((Math.min(...xs) + Math.max(...xs)) / 2);
      const cy = ly((Math.min(...ys) + Math.max(...ys)) / 2);
      desc = `polygon 中心(${cx},${cy}) fill=${e.fill || e.color}`;
    } else {
      // rect / ellipse
      const x = e.x ?? 0, y = e.y ?? 0, w = e.width ?? 0, h = e.height ?? 0;
      desc = `${e.type} 中心(${lx(x + w / 2)},${ly(y + h / 2)}) ${w}×${h}`;
    }
    if (e.color) desc += ` 色=${e.color}`;
    lines.push(`    - ${desc}`);
  }
  if (lines.length === 0) return 'existing: none（空画板）';
  return `existing (${lines.length} 个):\n${lines.join('\n')}`;
}

// 固定提示词（system）：字节级稳定，作为前缀命中 prompt 缓存。
// 动态内容（existing 摘要、stepHint）必须追加在 user 末尾，不能插进这里。
function buildFixedSystem(boardWidth: number, boardHeight: number): string {
  const w = Math.round(boardWidth);
  const h = Math.round(boardHeight);
  return (
    'role: 自定义 turtle-like 绘图脚本解释器（非 Python turtle），按下方定义把自然语言翻译成脚本\n'
    + 'canvas:\n'
    + `  size: 宽 ${w}px 高 ${h}px，中心为原点，四周约 ±${Math.round(w / 2)}, ±${Math.round(h / 2)}\n`
    + '  axes: +x 右 / +y 向上\n'
    + '  heading: 0°右 90°上 180°左 270°下；lt 逆时针(+)，rt 顺时针(-)\n'
    + 'initial: 原点朝右，抬笔(先 pd 才画线)，黑 #000000，线宽 3\n'
    + 'commands:\n'
    + '  移动: fd <n> / bk <n>\n'
    + '  转向: lt <deg> / rt <deg>\n'
    + '  画笔: pu / pd / width <n>\n'
    + '  颜色: color <描边> [填充] / pencolor <色> / fillcolor <色>\n'
    + '  定位: goto <x> <y> / setx <x> / sety <y> / setheading <deg> / home\n'
    + '  图形: circle <r> [弧度] / dot <直径> [色] / rect <宽> <高> / ellipse <rx> <ry> / line <x1> <y1> <x2> <y2>\n'
    + '  填充: begin_fill ... end_fill\n'
    + '  循环: repeat <n> { ... }\n'
    + 'colors:\n'
    + '  hex: #rrggbb 或 #rgb（如 #e74c3c / #e7c）\n'
    + '  names: red green blue black white yellow orange purple pink brown gray grey cyan teal gold silver navy lime magenta\n'
    + 'output:\n'
    + '  只输出脚本，无解释/前言/JSON/markdown 围栏\n'
    + '  一行一条命令，参数空格分隔，数字裸写\n'
    + '  禁止变量/等号/数学表达式/函数写法(如 fd(50))/括号/引号\n'
    + '  只允许上述命令，禁止自创'
  );
}

export function buildTurtlePrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  stepHint: string,
  existing: BoardElement[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const w = Math.round(boardWidth);
  const h = Math.round(boardHeight);
  // 动态内容全部追加在 user 末尾，保持 system 与 user 前缀稳定，
  // 使同一画布/同一分步任务的后续请求可命中 prompt 缓存，降低调用成本
  const dynamic = `${summarizeElements(existing, boardWidth, boardHeight)}\n${stepHint}`;
  return [
    { role: 'system', content: buildFixedSystem(boardWidth, boardHeight) },
    { role: 'user', content: `画布宽 ${w}px 高 ${h}px。请用 turtle 脚本绘制：${instruction}\n${dynamic}` },
  ];
}

// 从 LLM 原始输出里剥掉代码块围栏，得到纯脚本
function extractTurtleScript(raw: string): string {
  const fence = raw.match(/```(?:turtle|python)?\n?([\s\S]*?)```/);
  if (fence) return fence[1];
  return raw;
}

// 调用 LLM，返回 turtle 脚本原始文本（供测试/调试）
export async function generateTurtleScript(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<string> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
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
  return extractTurtleScript(data?.choices?.[0]?.message?.content || '');
}

// 调用 LLM 生成 turtle 脚本并落笔成元素（内置 AI 唯一绘制路径）
export async function generateTurtleElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<Partial<BoardElement>[]> {
  const script = await generateTurtleScript(config, input, params);
  if (!script.trim()) return [];
  const items = runTurtle(script, {
    startX: input.width / 2,
    startY: input.height / 2,
    startHeading: 0,
  });
  return turtleToElements(items, { id: `ai_${Date.now().toString(36)}` });
}
