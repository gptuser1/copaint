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

// 把画布已有元素转成「声明式坐标摘要」，注入提示词让无多模态 LLM
// 从文字理解画布现状（哪里已有什么），以便在已有内容基础上协作续画。
// 所有元素都是同级别的创作物，不区分作者。
//
// 设计依据（业界调研 LayoutGPT 2305.15393 / DrawingBench 2512.01174）：
// 给 LLM 明确的声明式边界框（x∈[..] y∈[..]）比"中心点+尺寸"或"网格字符图"
// 更清晰——AI 零换算，直接知道每个元素精确占据哪块区域，便于续画定位/避让。
// 不用网格：布局直觉对无多模态 LLM 价值弱，却占体积且需自行换算行号。
export function summarizeElements(
  elements: BoardElement[],
  width: number,
  height: number,
): string {
  const MAX = 40; // 只摘要最近 40 个，避免提示词过大
  const halfW = width / 2;
  const halfH = height / 2;
  // 逻辑坐标（中心原点、y 向上）↔ 画布坐标（左上原点、y 向下）
  const lx = (x: number) => x - halfW;
  const ly = (y: number) => halfH - y;
  const used = elements.slice(-MAX);

  // 提取元素边界框（逻辑坐标），返回 {x0,y0,x1,y1} 或 null（无有效几何）
  const bbox = (e: BoardElement): { x0: number; y0: number; x1: number; y1: number } | null => {
    let pts: number[] = [];
    if (e.type === 'line' && e.x != null && e.x2 != null) {
      pts = [e.x, e.y ?? 0, e.x2, e.y2 ?? 0];
    } else if ((e.type === 'rect' || e.type === 'ellipse') && e.x != null && e.width != null) {
      const h = e.height ?? 0;
      pts = [e.x, e.y ?? 0, e.x + e.width, (e.y ?? 0) + h];
    } else if (e.points && e.points.length >= 4) {
      pts = e.points;
    }
    if (pts.length < 4) return null;
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    return { x0: lx(Math.min(...xs)), y0: ly(Math.max(...ys)), x1: lx(Math.max(...xs)), y1: ly(Math.min(...ys)) };
  };

  // 方位词：按元素中心在画布中的位置给"左/中/右 × 上/中/下"九宫格描述
  const loc = (b: { x0: number; y0: number; x1: number; y1: number }): string => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const xz = cx < -halfW / 3 ? '左' : cx > halfW / 3 ? '右' : '中';
    const yz = cy > halfH / 3 ? '上' : cy < -halfH / 3 ? '下' : '中';
    if (xz === '中' && yz === '中') return '居中';
    return `${xz}${yz}`; // 左上 上中 右上 左中 右中 左下 下中 右下
  };

  const typeName: Record<string, string> = {
    rect: '矩形', ellipse: '椭圆', line: '直线', polygon: '多边形', pen: '手绘线', eraser: '橡皮',
  };

  const list: string[] = [];
  for (const e of used) {
    const b = bbox(e);
    if (!b) continue;
    const w = Math.round(b.x1 - b.x0);
    const h = Math.round(b.y1 - b.y0);
    const fill = e.type === 'polygon' || e.type === 'rect' || e.type === 'ellipse' ? e.fill || e.color : e.color;
    // 声明式：名称 · 方位 · 边界框 · 颜色
    list.push(
      `  - ${typeName[e.type] || e.type} ${loc(b)} x∈[${Math.round(b.x0)},${Math.round(b.x1)}] y∈[${Math.round(b.y0)},${Math.round(b.y1)}] ${w}x${h}`
      + `${fill ? ` #${fill.replace('#', '')}` : ''}`,
    );
  }
  if (used.length === 0) return 'existing: none（空画板）';
  return `existing: 已有 ${used.length} 个元素 坐标x∈[-${halfW},${halfW}] y∈[-${halfH},${halfH}]（原点在中心，y 向上）:\n`
    + list.join('\n');
}

// 固定提示词（system）：字节级稳定，作为前缀命中 prompt 缓存。
// 动态内容（existing 摘要、stepHint）必须追加在 user 末尾，不能插进这里。
// 后端已支持 Python turtle 语法子集：让 AI 用它最熟的先验写脚本，transpiler+解释器执行。
// 保持精简以压低每次请求的 token 成本（system 每次都会携带）。
function buildFixedSystem(boardWidth: number, boardHeight: number): string {
  const w = Math.round(boardWidth);
  const h = Math.round(boardHeight);
  return (
    '你是 turtle 画板助手，把自然语言需求翻译成 Python turtle 脚本执行。\n'
    + '\n'
    + `画布：宽 ${w}px 高 ${h}px。坐标：原点在中心，+x 右、+y 上；`
    + `朝向 0°=右、90°=上、180°=左、270°=下，逆时针为正（left 增、right 减）。\n`
    + '\n'
    + '标准写法：\n'
    + '  import turtle\n'
    + '  t = turtle.Turtle()\n'
    + '  t.forward(50)  # 用 t.方法()\n'
    + '\n'
    + '方法（别名同样支持）：\n'
    + '  移动 forward/fd, backward/bk/back\n'
    + '  转向 left/lt, right/rt\n'
    + '  画笔 penup/pu/up, pendown/pd/down, width/pensize\n'
    + '  颜色 color(c) 笔+填充同色, color(p,f) 分开设, pencolor, fillcolor\n'
    + '  定位 goto/setpos/setposition, setx, sety, setheading/seth, home\n'
    + '  图形 circle(r[,extent]) 圆/弧, dot(size[,color]) 点, rect(w,h), ellipse(rx,ry), line(x1,y1,x2,y2)\n'
    + '  填充 begin_fill / end_fill；清空 clear\n'
    + '\n'
    + '语法：for i in range(n): / while 条件: / if 条件: elif 条件: else: / 变量赋值 / '
    + '列表 colors=["a","b"] 用 colors[i] / break / continue / and or not True False / '
    + '数学 sqrt sin cos tan abs floor ceil round pow(a,b) log exp min max random atan2\n'
    + '\n'
    + '颜色：#rrggbb、#rgb 或 CSS 色名（red green blue black white yellow orange purple pink '
    + 'brown gray grey cyan teal gold silver navy lime magenta skyblue lightblue lightgreen 等）。\n'
    + '\n'
    + '无副作用调用自动忽略可放心写：speed hideturtle/ht showturtle/st shape setup bgcolor title '
    + 'done mainloop exitonclick tracer update write 等。\n'
    + '\n'
    + '初始：笔在原点朝0°，默认落笔，移动不留线先 penup。\n'
    + '\n'
    + '输出：用 <script>...</script> 包裹脚本，缩进4空格，注释 # 开头。\n'
    + '思考保持简洁：不要逐条复述/详细分析已有元素，快速扫一眼定位新增内容的位置即可，'
    + '然后直接输出脚本。思考过程务必简短（一两句话），不要长篇论证。\n'
    + '禁止：递归、append()/len()、切片（colors[1:]）、推导式、dict、f-string、print()、'
    + 'import 其他模块（math/random 无需 import）、查询 pos()/xcor()/heading() 返回值。\n'
    + '只允许上述方法语法，禁止自创命令。'
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
  // 使同一画布/同一任务的后续请求可命中 prompt 缓存，降低调用成本
  const dynamic = `${summarizeElements(existing, boardWidth, boardHeight)}\n${stepHint}`;
  return [
    { role: 'system', content: buildFixedSystem(boardWidth, boardHeight) },
    { role: 'user', content: `画布宽 ${w}px 高 ${h}px。请用 turtle 脚本绘制：${instruction}\n${dynamic}` },
  ];
}

// LLM 响应里 turtle 脚本的起始行特征（用于剥离"好的，我会…"这类前言说明文字）。
// 覆盖标准开头 import / t = turtle.Turtle() / t.xxx，以及以任一 turtle 指令/赋值/注释开头。
const SCRIPT_START =
  /^(import\b|t\s*=|t\.|turtle\.|[a-zA-Z_]\w*\s*=|for\s+\w+\s+in\s+range|while\b|if\s|#|(?:fd|bd|bk|back|forward|backward|lt|left|rt|right|pu|up|penup|pd|down|pendown|width|pensize|color|pencolor|fillcolor|goto|setpos|setposition|setx|sety|seth|setheading|home|circle|dot|rect|ellipse|line|begin_fill|end_fill|fill|clear|speed|hideturtle|ht|showturtle|st|shape|bgcolor|title|mainloop|done|exitonclick|tracer|update|write)\b)/;

// 鲁棒解析 LLM 响应里的 turtle 脚本。模型可能用它最顺手的方式包裹脚本：
//   1. <script>…</script>                    （系统提示词要求的标准格式）
//   2. ```python / ```turtle / ``` code fence（业界常见的 markdown 格式）
//   3. 单反引号 `…`
//   4. 无任何包裹，直接输出脚本
// 且前面常带一句说明（如"好的，我会在屋顶上方添加烟囱"）。这里按优先级依次尝试
// 多种匹配模式，命中即返回；同时剥离 <script>/代码块围栏与前缀说明文字，提高鲁棒性。
export function parseTurtleResponse(raw: string): { script: string } {
  return { script: extractScript(raw) };
}

function extractScript(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const candidates: string[] = [];

  // 1) <script> 完整标签（可能被 markdown 围栏再包一层）
  const closed = text.match(/<script[^>]*>([\s\S]*?)<\/script\s*>/i);
  if (closed) candidates.push(closed[1]);
  // 2) 未闭合的 <script>（响应被截断时）：取标签后到结尾
  else {
    const open = text.match(/<script[^>]*>([\s\S]*)$/i);
    if (open) candidates.push(open[1]);
  }
  // 3) 三反引号代码块（任意语言标注；未闭合时也尽量取到结尾）
  const fence = text.match(/```(?:[a-zA-Z0-9]*)?\s*\n?([\s\S]*?)(?:```|$)/);
  if (fence) candidates.push(fence[1]);
  // 4) 单反引号
  const inline = text.match(/`([\s\S]*?)`/);
  if (inline) candidates.push(inline[1]);
  // 5) 整体兜底
  candidates.push(text);

  for (const c of candidates) {
    const s = cleanScript(c);
    if (s) return s;
  }
  return '';
}

// 清理候选：剥除 <script> 标签与代码块围栏，去掉前言说明文字。
// 找不到脚本起始行时返回空（纯说明文字，不是有效脚本）
function cleanScript(s: string): string {
  const out = s
    .replace(/<\/?script[^>]*>/gi, ' ')
    .replace(/```[a-zA-Z0-9]*/gi, '')
    .trim();
  if (!out) return '';
  const lines = out.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SCRIPT_START.test(lines[i].trim())) { start = i; break; }
  }
  if (start < 0) return '';
  return lines.slice(start).join('\n').trim();
}

// LLM 原始响应：正文 + 思考内容（reasoning，思考类模型如 DeepSeek-R1 有）
export interface LlmRaw {
  content: string;    // 正文（含 <script>…</script>）
  reasoning: string;  // 思考过程；非思考模型为空串
}

// 组装可调参数并调用 LLM，返回原始响应（正文 + 思考）
async function callLLM(
  config: LlmConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  params?: LlmParams,
): Promise<LlmRaw> {
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
  const data: { choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string } }> } = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  return {
    content: msg.content || '',
    // 兼容主流思考模型的字段名：DeepSeek 用 reasoning_content，OpenAI 系用 reasoning
    reasoning: msg.reasoning || msg.reasoning_content || '',
  };
}

// 流式分块：thinking 为思维链增量，content 为正文增量
export interface LlmChunk {
  type: 'thinking' | 'content';
  text: string;
}

// 流式调用 LLM：请求 stream:true，逐块 yield 思维链与正文增量。
// 供 AI 路由边收边转发给前端 SSE（实时展示思考与响应过程）。
export async function* streamLLM(
  config: LlmConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  params?: LlmParams,
): AsyncGenerator<LlmChunk> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: params?.maxTokens ?? 2048,
    temperature: params?.temperature ?? 0.7,
    stream: true,
  };
  if (typeof params?.thinking === 'boolean') {
    body.enable_thinking = params.thinking;
  }
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      // 覆盖 Worker 默认 UA，避免被服务商按来源指纹限流
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM error ${res.status}: ${errBody.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('LLM stream empty');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const { done: rd, value } = await reader.read();
    if (rd) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { done = true; break; }
      try {
        const json = JSON.parse(data);
        const delta: { reasoning_content?: unknown; content?: unknown } = json?.choices?.[0]?.delta || {};
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          yield { type: 'thinking', text: delta.reasoning_content };
        }
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'content', text: delta.content };
        }
      } catch { /* 跳过畸形分块 */ }
    }
  }
}

// 把解析出的 turtle 脚本跑成元素（供流式路由在流结束后落笔）
export function elementsFromTurtleScript(
  script: string, width: number, height: number,
): { elements: Partial<BoardElement>[]; cleared: boolean } {
  const items = runTurtle(script, { startX: width / 2, startY: height / 2, startHeading: 0 });
  return {
    elements: turtleToElements(items, { id: `ai_${Date.now().toString(36)}` }),
    cleared: items.some(isClearItem),
  };
}

// 调用 LLM，返回 turtle 脚本（供测试/调试，只取 <script> 部分）
export async function generateTurtleScript(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<{ script: string; raw: string; reasoning: string }> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
  const raw = await callLLM(config, messages, params);
  return { script: parseTurtleResponse(raw.content).script, raw: raw.content, reasoning: raw.reasoning };
}

// 调用 LLM 生成 turtle 脚本并落笔成元素（内置 AI 唯一绘制路径）。
// 返回本步生成的元素 + cleared（脚本含 clear 指令，执行前需先清空画布）
// + 原始响应（raw 正文 / reasoning 思考），供前端展示"思考及原始响应"。
export async function generateTurtleElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<{ elements: Partial<BoardElement>[]; cleared: boolean; script: string; raw: string; reasoning: string }> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
  const raw = await callLLM(config, messages, params);
  const { script } = parseTurtleResponse(raw.content);
  if (!script.trim()) return { elements: [], cleared: false, script: '', raw: raw.content, reasoning: raw.reasoning };
  const items = runTurtle(script, {
    startX: input.width / 2,
    startY: input.height / 2,
    startHeading: 0,
  });
  return {
    elements: turtleToElements(items, { id: `ai_${Date.now().toString(36)}` }),
    cleared: items.some(isClearItem),
    script,
    raw: raw.content,
    reasoning: raw.reasoning,
  };
}
