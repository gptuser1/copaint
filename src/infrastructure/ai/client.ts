// LLM 客户端：把自然语言指令转成 turtle 脚本，再落笔成画板元素
// 纯基础设施实现，配置由调用方（services/ai）传入，避免向上依赖
import type { BoardElement } from '../../domain/types';
import { runTurtle, turtleToElements, isClearItem } from '../turtle';

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
    + '  颜色: color <描边>, [填充] / pencolor <色> / fillcolor <色>\n'
    + '  定位: goto <x>, <y> / setx <x> / sety <y> / setheading <deg> / home\n'
    + '  图形: circle <r>, [弧度], [steps] / dot <直径>, [色] / rect <宽>, <高> / ellipse <rx>, <ry> / line <x1>, <y1>, <x2>, <y2>\n'
    + '  填充: begin_fill ... end_fill\n'
    + '  循环: repeat <n> { ... } / while <条件> { ... } / for (i = 0; i < n; i = i + 1) { ... }\n'
    + '  条件: if <条件> { ... } else { ... }（支持 else if 链）\n'
    + '  变量: x = <表达式>（如 size = 50, x = x + 1）\n'
    + '  数学函数: sqrt sin cos tan abs pow(a,b) floor ceil round min(a,b) max(a,b) log exp mod(a,b) random(a,b) atan2\n'
    + '  自定义函数: to name(参数列表) { ... } 定义；name(参数) 调用；return <表达式> 返回数值\n'
    + '  清空: clear（清空画布已有内容，再从当前位置重新绘制）\n'
    + 'colors:\n'
    + '  hex: #rrggbb 或 #rgb（如 #e74c3c / #e7c）\n'
    + '  names: red green blue black white yellow orange purple pink brown gray grey cyan teal gold silver navy lime magenta\n'
    + 'output:\n'
    + '  响应必须用 <script> 包裹 turtle 脚本；分步任务的中间步再附加 <next> 包裹给下一步的自然语言指令\n'
    + '  脚本内一条语句一行；表达式用运算符 + - * / % 与括号\n'
    + '  重要：多参数命令必须用逗号分隔（如 goto 10, -20、rect 40, 30、line 0, 0, 10, 10、color red, blue），不要用空格分隔\n'
    + '  允许变量/表达式/条件/循环/函数写法；颜色参数直接写颜色名或 hex\n'
    + '  只允许上述命令与内置函数，禁止自创\n'
    + '  <next> 是一句中文，说明下一步画什么（形状/颜色/位置），避免与 existing 重叠；最后一步不要写 <next>'
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

// 解析 LLM 响应：<script> 包裹的 turtle 脚本 + 可选 <next> 包裹的下一步指令。
// 无 <script> 时把整体当脚本，并兼容 ``` 代码块围栏（单次/旧响应兜底）。
export function parseTurtleResponse(raw: string): { script: string; next: string } {
  const scriptM = raw.match(/<script>([\s\S]*?)<\/script>/i);
  const nextM = raw.match(/<next>([\s\S]*?)<\/next>/i);
  let script = scriptM ? scriptM[1].trim() : raw.trim();
  if (!scriptM) {
    const fence = script.match(/```(?:turtle|python)?\n?([\s\S]*?)```/);
    if (fence) script = fence[1].trim();
  }
  return { script, next: nextM ? nextM[1].trim() : '' };
}

// 组装可调参数并调用 LLM，返回原始响应文本
async function callLLM(
  config: LlmConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  params?: LlmParams,
): Promise<string> {
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

// 调用 LLM，返回 turtle 脚本（供测试/调试，只取 <script> 部分）
export async function generateTurtleScript(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<string> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
  return parseTurtleResponse(await callLLM(config, messages, params)).script;
}

// 调用 LLM 生成 turtle 脚本并落笔成元素（内置 AI 唯一绘制路径）。
// 返回本步生成的元素 + 给下一步的自然语言指令（多步任务用 next 驱动下一步）
// + cleared（脚本含 clear 指令，执行前需先清空画布）。
export async function generateTurtleElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<{ elements: Partial<BoardElement>[]; next: string; cleared: boolean }> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
  const { script, next } = parseTurtleResponse(await callLLM(config, messages, params));
  if (!script.trim()) return { elements: [], next, cleared: false };
  const items = runTurtle(script, {
    startX: input.width / 2,
    startY: input.height / 2,
    startHeading: 0,
  });
  return {
    elements: turtleToElements(items, { id: `ai_${Date.now().toString(36)}` }),
    next,
    cleared: items.some(isClearItem),
  };
}
