// turtlePython：把 Python turtle 语法子集翻译成现有 DSL 脚本，供 runTurtle 消费。
//
// 目标：让 agent 直接用它对 Python turtle 的「API + 语法」双重先验写脚本，后端解析执行。
// 只做「语法子集」翻译，不运行 Python。子集之外（list/dict/推导式等）需 agent 遵守约束。
//
// 翻译能力：
//   - import / from ... import turtle            → 忽略
//   - turtle.Turtle() / Turtle() 实例化          → 忽略（t 绑定当前海龟）
//   - t.forward(...) / t.right(...) 等点方法调用  → 映射到现有命令
//   - forward(...) / circle(...) 顶层命令调用     → 映射到现有命令
//   - for i in range(...): 冒号缩进块             → 展开为 while + 计数变量
//   - if / elif / else / while / def ...: 冒号块 → 映射到现有块语法
//   - "..." / '...' 字符串字面量                  → 去引号（颜色名等）
//   - # 注释                                     → 删除（保留 #rrggbb 颜色）
//   - t.speed() / t.hideturtle() 等无副作用调用   → 忽略
//   - 非命令调用（自定义函数）                    → 原样保留

// Python turtle 方法名 → 现有 DSL 命令名
const METHOD_COMMANDS: Record<string, string> = {
  fd: 'fd', forward: 'fd',
  bk: 'bk', backward: 'bk', back: 'bk',
  lt: 'lt', left: 'lt',
  rt: 'rt', right: 'rt',
  pu: 'pu', penup: 'pu', up: 'pu',
  pd: 'pd', pendown: 'pd', down: 'pd',
  goto: 'goto', setpos: 'goto', setposition: 'goto',
  setx: 'setx', sety: 'sety',
  setheading: 'setheading', seth: 'setheading',
  home: 'home',
  circle: 'circle',
  dot: 'dot',
  color: 'color', pencolor: 'pencolor', fillcolor: 'fillcolor',
  width: 'width', pensize: 'width',
  begin_fill: 'begin_fill', end_fill: 'end_fill',
  clear: 'clear', clearscreen: 'clear', reset: 'clear',
  rect: 'rect', rectangle: 'rect',
  ellipse: 'ellipse', oval: 'ellipse',
  line: 'line',
};

// 无副作用 / 本实现不支持（状态查询、动画、事件等）：整行忽略
const DROP_METHODS = new Set<string>([
  'speed', 'hideturtle', 'ht', 'showturtle', 'st', 'shape', 'screensize',
  'setworldcoordinates', 'title', 'bgcolor', 'delay', 'tracer', 'update',
  'done', 'mainloop', 'bye', 'exitonclick', 'ontimer', 'listen', 'onkey',
  'onkeypress', 'onscreenclick', 'onclick', 'undo', 'stamp', 'clone',
  'position', 'pos', 'heading', 'isdown', 'isvisible', 'pen', 'xcor', 'ycor',
  'distance', 'towards', 'getpen', 'getturtle', 'setundobuffer', 'write',
  'setup', 'colormode', 'mode', 'canvas', 'setframerate',
]);

interface LineInfo {
  indent: number;
  kind: 'stmt' | 'for' | 'if' | 'elif' | 'else' | 'while' | 'def' | 'drop';
  text: string;
  cond?: string;
  for?: { init: string; cond: string; update: string };
}

// 去掉 # 注释，但保留 #rrggbb / #rgb 颜色
function stripComment(s: string): string {
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === '#') {
      const hex = s.slice(i + 1).match(/^[0-9a-fA-F]{3,6}/);
      if (hex) {
        const after = s[i + 1 + hex[0].length];
        if (after === undefined || after === ')' || after === ',' || after === ' ' || after === '\t' || after === ']') {
          i += 1 + hex[0].length;
          continue;
        }
      }
      return s.slice(0, i);
    }
    i++;
  }
  return s;
}

// 去掉字符串字面量引号
function stripQuotes(s: string): string {
  return s.replace(/"([^"]*)"/g, '$1').replace(/'([^']*)'/g, '$1');
}

// 把 Python 逻辑/布尔写法归一化为 DSL 语法（词边界，避免误伤变量名/颜色名）
function normalizePython(s: string): string {
  return s
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\b/g, '!')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');
}

// 按逗号切分参数（忽略括号内逗号）
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 解析 range(...)：返回 init/end/step/condOp
function parseRange(s: string): { init: string; end: string; step: string; condOp: string } {
  const m = s.match(/^range\s*\(\s*(.*?)\s*\)$/i);
  const args = splitArgs(m ? m[1] : '');
  let init = '0';
  let end = '0';
  let step = '1';
  if (args.length === 1) end = args[0];
  else if (args.length >= 2) { init = args[0]; end = args[1]; }
  if (args.length >= 3) step = args[2];
  const stepNum = Number(step.replace(/\s/g, '')) || 0;
  return { init, end, step, condOp: stepNum < 0 ? '>' : '<' };
}

// 翻译单个调用段：返回现有命令文本，或 null（丢弃），或原样（非命令调用）
function translateCall(seg: string): string | null {
  const m = seg.match(/^(\w+)\s*\((.*)\)\s*$/s);
  if (!m) return seg; // 非函数调用（赋值等），原样保留
  const method = m[1];
  const argsStr = m[2];
  if (DROP_METHODS.has(method)) return null;
  const cmd = METHOD_COMMANDS[method];
  if (!cmd) return seg; // 自定义函数调用，原样保留现有 call 语法
  const args = splitArgs(argsStr);
  return args.length ? `${cmd} ${args.join(', ')}` : cmd;
}

// 翻译一行里的所有 turtle 调用（支持对象前缀 + 分号分隔）
function translateCalls(content: string): string {
  // 去掉 对象/模块 前缀：t.forward( → forward(、math.sqrt( → sqrt(
  let c = content.replace(/\b\w+\.(\w+\s*\()/g, '$1');
  const segs = c.split(';').map((s) => s.trim());
  const out: string[] = [];
  for (const seg of segs) {
    if (!seg) continue;
    const t = translateCall(seg);
    if (t) out.push(t);
  }
  return out.join('\n');
}

function translateLine(raw: string): LineInfo {
  const trimmed = raw.trim();
  if (!trimmed) return { indent: 0, kind: 'drop', text: '' };

  // 忽略行：import / from import / Turtle 实例化 / Screen 实例化
  if (/^(import|from)\s/i.test(trimmed)) return { indent: 0, kind: 'drop', text: '' };
  if (/=\s*(\w+\.)?(Turtle|Screen)\s*\(/i.test(trimmed)) return { indent: 0, kind: 'drop', text: '' };
  if (/^\s*(\w+\.)?(Turtle|Screen)\s*\(/i.test(trimmed)) return { indent: 0, kind: 'drop', text: '' };

  const realIndent = raw.length - trimmed.length;
  let content = normalizePython(stripComment(stripQuotes(trimmed))).replace(/\s+$/, '');
  if (!content) return { indent: realIndent, kind: 'drop', text: '' };

  let m: RegExpMatchArray | null;
  if ((m = content.match(/^for\s+(\w+)\s+in\s+range\s*\((.*)\)\s*:?\s*$/i))) {
    const fr = parseRange(`range(${m[2]})`);
    return {
      indent: realIndent,
      kind: 'for',
      text: `${m[1]} = ${fr.init}`,
      for: {
        init: `${m[1]} = ${fr.init}`,
        cond: `${m[1]} ${fr.condOp} ${fr.end}`,
        update: `${m[1]} = ${m[1]} + ${fr.step}`,
      },
    };
  }
  if ((m = content.match(/^if\s+(.+?)\s*:?\s*$/i))) {
    return { indent: realIndent, kind: 'if', text: `if (${m[1]})`, cond: m[1] };
  }
  if ((m = content.match(/^elif\s+(.+?)\s*:?\s*$/i))) {
    return { indent: realIndent, kind: 'elif', text: '', cond: m[1] };
  }
  if (/^else\s*:?\s*$/i.test(content)) {
    return { indent: realIndent, kind: 'else', text: '' };
  }
  if ((m = content.match(/^while\s+(.+?)\s*:?\s*$/i))) {
    return { indent: realIndent, kind: 'while', text: `while (${m[1]})`, cond: m[1] };
  }
  if ((m = content.match(/^def\s+(\w+)\s*\((.*)\)\s*:?\s*$/i))) {
    const params = splitArgs(m[2]).join(', ');
    return { indent: realIndent, kind: 'def', text: `to ${m[1]}(${params})` };
  }
  const stmt = translateCalls(content);
  if (!stmt) return { indent: realIndent, kind: 'drop', text: '' };
  return { indent: realIndent, kind: 'stmt', text: stmt };
}

function buildTurtle(lines: LineInfo[]): string {
  const out: string[] = [];
  const stack: { indent: number; kind: string; for?: { init: string; cond: string; update: string } }[] = [];

  const popUntil = (bound: number) => {
    while (stack.length && bound <= stack[stack.length - 1].indent) {
      const top = stack.pop()!;
      if (top.for) out.push(top.for.update);
      out.push('}');
    }
  };

  for (const L of lines) {
    if (L.kind === 'drop') continue;

    // else / elif 必须与匹配的 if 同缩进，先闭合 if 的 body 再续接，不能走通用 popUntil
    if (L.kind === 'else' || L.kind === 'elif') {
      const top = stack[stack.length - 1];
      if (top && top.indent === L.indent) {
        popUntil(L.indent + 1); // 弹出 body 层，保留 if 层
        stack.pop(); // 弹 if
        out.push(L.kind === 'else' ? '} else {' : `} else if (${L.cond}) {`);
        stack.push({ indent: L.indent, kind: L.kind });
      } else {
        popUntil(L.indent);
        out.push(L.kind === 'else' ? '{' : `if (${L.cond}) {`);
        stack.push({ indent: L.indent, kind: L.kind });
      }
      continue;
    }

    popUntil(L.indent);
    switch (L.kind) {
      case 'stmt':
        out.push(L.text);
        break;
      case 'for':
        out.push(L.for!.init);
        out.push(`while (${L.for!.cond}) {`);
        stack.push({ indent: L.indent, kind: 'for', for: L.for });
        break;
      case 'if':
      case 'while':
      case 'def':
        out.push(`${L.text} {`);
        stack.push({ indent: L.indent, kind: L.kind });
        break;
      default:
        break;
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.for) out.push(top.for.update);
    out.push('}');
  }
  return out.join('\n');
}

// 启发式：脚本是否像 Python turtle
export function isPythonStyle(script: string): boolean {
  if (/^\s*(import|from)\s+\w*[Tt]urtle/im.test(script)) return true;
  if (/Turtle\s*\(/i.test(script)) return true;
  if (/\b\w+\.\w+\s*\(/i.test(script)) return true;
  if (/\bin\s+range\s*\(/i.test(script)) return true;
  if (/^\s*(for|while|if|elif|else|def)\b.*:\s*$/im.test(script)) return true;
  return false;
}

// 把 Python turtle 脚本翻译成现有 DSL 脚本
export function pythonToTurtle(script: string): string {
  const normalized = script.split('\n').map((l) => l.replace(/\t/g, '    '));
  const infos = normalized.map(translateLine);
  const body = buildTurtle(infos);
  // Python turtle 的 Turtle() 默认落笔（penDown=true）；解释器默认抬笔。
  // 强制开头 pd，对齐 Python 默认，避免 agent 省略 pendown() 时静默不画。
  return body ? `pd\n${body}` : body;
}