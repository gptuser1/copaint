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
// 后端已支持 Python turtle 语法子集：让 AI 用它最熟的 Python turtle 先验写脚本，
// 由 transpiler 翻译 + 解释器执行；提示词只约束能力边界（禁止递归/容器操作等子集外语法）。
function buildFixedSystem(boardWidth: number, boardHeight: number): string {
  const w = Math.round(boardWidth);
  const h = Math.round(boardHeight);
  return (
    '你是 turtle 画板助手。把用户用自然语言描述的绘画需求翻译成 Python turtle 语法的绘图脚本，脚本会被解析执行。\n'
    + '\n'
    + `画布：宽 ${w}px，高 ${h}px。坐标系：原点在画布正中心，+x 向右、+y 向上；`
    + `朝向角 0°=朝右、90°=朝上、180°=朝左、270°=朝下，逆时针为正（left/lt 增大、right/rt 减小）。`
    + `内容尽量控制在画布内。\n`
    + '\n'
    + '用标准的 Python turtle 写法（后端自动识别并执行）：\n'
    + '  import turtle\n'
    + '  t = turtle.Turtle()\n'
    + '  # 用 t.方法() 画图\n'
    + '\n'
    + '可用方法（完整名或短别名均可）：\n'
    + '  移动: t.forward(n)/fd(n) 前进 / t.backward(n)/bk(n)/back(n) 后退（n 可负=反向）\n'
    + '  转向: t.left(deg)/lt(deg) 左转(逆时针) / t.right(deg)/rt(deg) 右转(顺时针)\n'
    + '  画笔: t.penup()/pu()/up() 抬笔 / t.pendown()/pd()/down() 落笔 / t.width(n)/pensize(n) 线宽\n'
    + '  颜色: t.color(c) 同时设笔色+填充色 / t.color(p, f) 分别设 / t.pencolor(c) / t.fillcolor(c)\n'
    + '  定位: t.goto(x, y)/setpos(x,y)/setposition(x,y) 移到绝对坐标（不改变朝向）\n'
    + '        t.setx(x) / t.sety(y) / t.setheading(deg)/seth(deg) / t.home() 回中心朝0°\n'
    + '  图形: t.circle(r) 或 t.circle(r, extent) 从当前点沿圆周画圆/弧（r 可负） / t.dot(size) 或 t.dot(size, color) 画点\n'
    + '        t.rect(w, h) 以当前点为左下角画矩形 / t.ellipse(rx, ry) 以当前点为圆心画椭圆 / t.line(x1, y1, x2, y2) 画直线\n'
    + '  填充: t.begin_fill() ... t.end_fill()（之间画的封闭图形用填充色填充）\n'
    + '  清空: t.clear() 清空画布已有内容后重画\n'
    + '\n'
    + '支持的语法（对齐 Python turtle）：\n'
    + '  循环: for i in range(n): 冒号+4空格缩进；也可 while <条件>:\n'
    + '  条件: if <条件>: / elif <条件>: / else:\n'
    + '  变量: size = 20；列表 colors = ["red", "blue"]，取用 colors[i]\n'
    + '  循环控制: break 提前退出 / continue 跳下一轮\n'
    + '  逻辑与布尔: and / or / not / True / False（如 if i > 0 and i < 10:）\n'
    + '  数学函数: sqrt sin cos tan abs floor ceil round pow(a,b) log exp min(a,b) max(a,b) random(a,b) atan2（无需 import）\n'
    + '\n'
    + `颜色：支持 #rrggbb（如 #e74c3c）或 #rgb（如 #e7c），也支持 CSS 颜色名`
    + `（red green blue black white yellow orange purple pink brown gray grey cyan teal gold silver navy lime magenta skyblue lightblue lightgreen 等，不区分大小写）。\n`
    + '\n'
    + '无副作用调用会被自动忽略，可放心写：t.speed()、t.hideturtle()/ht()、t.showturtle()/st()、t.shape()、window/turtle 的 setup()/bgcolor()/title()/done()/mainloop()/exitonclick()/tracer()/update()/write() 等。\n'
    + '\n'
    + '初始状态：笔在原点 (0,0)，朝 0°（右）。默认落笔（Python turtle 语义），画线无需手动 pendown；不想留线先 t.penup()。\n'
    + '\n'
    + '输出格式（必须严格遵守）：\n'
    + '  响应用 <script>...</script> 包裹 Python turtle 脚本\n'
    + '  块缩进统一用 4 空格，注释用 # 开头\n'
    + '  禁止：递归（函数内调用自身）、列表方法（append()/len()）、切片（colors[1:]）、推导式、dict、字符串操作、f-string、print()、import 其它模块（math/random 无需 import）、依赖查询方法返回值（pos()/xcor()/heading() 等）\n'
    + '  只允许上面列出的方法和语法，禁止自创命令'
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

// 解析 LLM 响应：<script> 包裹的 turtle 脚本。
// 无 <script> 时把整体当脚本，并兼容 ``` 代码块围栏（单次/旧响应兜底）。
export function parseTurtleResponse(raw: string): { script: string } {
  const scriptM = raw.match(/<script>([\s\S]*?)<\/script>/i);
  let script = scriptM ? scriptM[1].trim() : raw.trim();
  if (!scriptM) {
    const fence = script.match(/```(?:turtle|python)?\n?([\s\S]*?)```/);
    if (fence) script = fence[1].trim();
  }
  return { script };
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
// 返回本步生成的元素 + cleared（脚本含 clear 指令，执行前需先清空画布）。
export async function generateTurtleElements(
  config: LlmConfig,
  input: DrawInput,
  params?: LlmParams,
): Promise<{ elements: Partial<BoardElement>[]; cleared: boolean }> {
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint, input.elements);
  const { script } = parseTurtleResponse(await callLLM(config, messages, params));
  if (!script.trim()) return { elements: [], cleared: false };
  const items = runTurtle(script, {
    startX: input.width / 2,
    startY: input.height / 2,
    startHeading: 0,
  });
  return {
    elements: turtleToElements(items, { id: `ai_${Date.now().toString(36)}` }),
    cleared: items.some(isClearItem),
  };
}
