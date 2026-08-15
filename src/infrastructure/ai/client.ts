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
