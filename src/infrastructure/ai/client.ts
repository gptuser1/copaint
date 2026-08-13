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

// turtle 命令速查，语义与标准 Python turtle 对齐：
// 逻辑原点在画布中心，+x 向右、+y 向上，0° 朝右、逆时针为正
const TURTLE_COMMANDS_HELP =
  '移动: fd <n> 前进 / bk <n> 后退 / lt <deg> 左转 / rt <deg> 右转\n'
  + '定位: goto <x> <y> / setx <x> / sety <y> / setheading <deg> / home\n'
  + '画笔: pu 抬笔 / pd 落笔 / width <n> 粗细 / color <描边色> [填充色]\n'
  + '      pencolor <色> / fillcolor <色>\n'
  + '图形: circle <半径> [角度] [步数] 画圆/弧 / dot <直径> [色] 画点\n'
  + '      rect <宽> <高> / ellipse <横半径> <纵半径> / line <x1> <y1> <x2> <y2>\n'
  + '填充: begin_fill ... end_fill 在 begin/end 之间画的封闭图形用 fillcolor 填充\n'
  + '循环: repeat <n> { ... }\n'
  + '坐标原点在画布中心，+x 向右、+y 向上；0 度朝右，逆时针为正。颜色用名称或 #hex。';

function buildTurtlePrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  stepHint: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const systemContent =
    '你是 turtle 画板助手。用户用自然语言描述要画的内容，你把它翻译成 turtle 绘图脚本。\n'
    + `画布：宽 ${boardWidth}px，高 ${boardHeight}px，中心为原点。\n`
    + `可用命令：\n${TURTLE_COMMANDS_HELP}\n`
    + '用画笔的连续移动画出内容，可中途换色/换粗细(width/color)表现细节，用 repeat 画重复图案。\n'
    + '颜色可用名称或 #hex。只输出脚本，不要解释、不要 markdown 代码块。\n'
    + `\n${stepHint}`;
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `画布尺寸 ${boardWidth}×${boardHeight}（中心为原点）。请用 turtle 脚本绘制：${instruction}` },
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
  const messages = buildTurtlePrompt(input.instruction, input.width, input.height, input.stepHint);
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
