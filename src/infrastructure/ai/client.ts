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

// turtle 命令参考，语义与标准 Python turtle 对齐：
// 逻辑原点在画布中心，+x 向右、+y 向上，0° 朝右、逆时针为正（lt 增大朝向角）
const TURTLE_COMMANDS_HELP = [
  '移动: fd <n> 向前 n 像素（n 可负=反向）/ bk <n> 向后 n',
  '转向: lt <deg> 左转（逆时针）/ rt <deg> 右转（顺时针），deg 为角度数',
  '画笔: pu 抬笔（移动不画）/ pd 落笔（移动画线）/ width <n> 线宽(正整数)',
  '颜色: color <描边色> [填充色] / pencolor <描边色> / fillcolor <填充色>',
  '定位: goto <x> <y> 直线移到绝对坐标 / setx <x> / sety <y> / setheading <deg> / home(回中心朝0度)',
  '图形: circle <半径> [弧度] 以当前位置为圆心画圆/弧(半径可负,弧度默认360)',
  '      dot <直径> [色] 实心圆点 / rect <宽> <高> 以当前点为左下角画矩形轮廓',
  '      ellipse <横半径> <纵半径> 以当前点为圆心画椭圆 / line <x1> <y1> <x2> <y2> 画线段',
  '填充: begin_fill ... end_fill 之间画的封闭图形用 fillcolor 填充',
  '循环: repeat <n> { ... } 花括号内命令重复 n 次',
].join('\n');

// 支持的颜色名（其余用 #rrggbb 或 #rgb hex）
const COLOR_NAMES_LIST = 'red green blue black white yellow orange purple pink brown gray grey cyan teal gold silver navy lime magenta';

export function buildTurtlePrompt(
  instruction: string,
  boardWidth: number,
  boardHeight: number,
  stepHint: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const systemContent =
    '你是 turtle 画板助手。把用户用自然语言描述的绘画需求翻译成 turtle 绘图脚本，脚本会被逐条执行。\n'
    + '\n'
    + `画布：宽 ${boardWidth}px，高 ${boardHeight}px。坐标系：原点在画布正中心，+x 向右、+y 向上；`
    + `朝向角 0°=朝右(+x)、90°=朝上(+y)、180°=朝左、270°=朝下，逆时针为正（lt 增大、rt 减小朝向角）。`
    + `画布四周坐标约为 (±${Math.round(boardWidth / 2)}, ±${Math.round(boardHeight / 2)})，内容尽量控制在画布内。\n`
    + '\n'
    + `可用命令（只允许用这些，禁止自创）：\n${TURTLE_COMMANDS_HELP}\n`
    + '\n'
    + `颜色：支持 #rrggbb（如 #e74c3c）或 #rgb 简写（如 #e7c），也支持颜色名：${COLOR_NAMES_LIST}。`
    + '名字不区分大小写。更精确的颜色请用 #rrggbb。\n'
    + '\n'
    + '初始状态：笔在原点 (0,0)，朝 0°（右），抬笔（pu）状态——要画线必须先 pd 落笔；'
    + '描边色 #000000 黑，线宽 3。换色用 color，改粗细用 width。\n'
    + '\n'
    + '输出格式（必须严格遵守）：\n'
    + '- 只输出 turtle 脚本本身，不要任何解释、前言、总结，不要 markdown 代码块围栏（```），不要 JSON。\n'
    + '- 每条命令独占一行，命令与其参数之间用空格分隔，按上面列出的参数顺序。\n'
    + '- 数字直接写裸值（如 100、-50、3.5），不要引号、括号、逗号、单位。\n'
    + '- 禁止：变量、等号赋值、数学表达式（如 2*50、90+45）、函数式写法（如 fd(50)、color("red")）、python 语法。\n'
    + '- 每条命令必须是上面列出的命令，禁止任何未列出的命令或拼音/自造词。\n'
    + '- 可用 // 或行首 # 写注释（不影响执行），但不要用注释代替命令。\n'
    + '\n'
    + `${stepHint}`;
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `画布宽 ${boardWidth}px、高 ${boardHeight}px。请用 turtle 脚本绘制：${instruction}` },
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
