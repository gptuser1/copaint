// Turtle 解释器：把 turtle 脚本模拟成一条(或多条)连续手绘路径(pen)
// 支持：fd/bk(前进后退), lt/rt(转向), pu/pd(抬笔落笔), color(换色),
//       width(换粗细), goto(跳转), repeat(循环)。纯 JS，无依赖。
import type { BoardElement } from '../domain/types';

// 一段连续的落笔笔画（pen 元素的数据来源）
export interface PenStroke {
  points: number[];
  widths: number[];
  colors: string[];
}

export interface TurtleOptions {
  startX: number;
  startY: number;
  startHeading?: number; // 度，0=朝右(+x)，顺时针为正(y 向下)
  maxOps?: number;       // 循环展开的原始操作上限，防止死循环
}

const COLOR_NAMES: Record<string, string> = {
  red: '#e74c3c', green: '#27ae60', blue: '#2980b9', black: '#000000', white: '#ffffff',
  yellow: '#f1c40f', orange: '#e67e22', purple: '#8e44ad', pink: '#ff6b9d', brown: '#8b5a2b',
  gray: '#95a5a6', grey: '#95a5a6', cyan: '#1abc9c', teal: '#008080', gold: '#ffd700',
  silver: '#c0c0c0', navy: '#000080', lime: '#00ff00', magenta: '#ff00ff',
};

const COMMANDS = new Set([
  'fd', 'forward', 'bk', 'back', 'lt', 'left', 'rt', 'right',
  'pu', 'penup', 'up', 'pd', 'pendown', 'down',
  'color', 'width', 'pensize', 'goto', 'repeat',
]);

function expandHex(h: string): string {
  const a = h[1], b = h[2], c = h[3];
  return `#${a}${a}${b}${b}${c}${c}`;
}

function parseColor(v: string): string {
  const t = String(v).toLowerCase().trim();
  if (t.startsWith('#')) return t.length === 4 ? expandHex(t) : t;
  if (COLOR_NAMES[t]) return COLOR_NAMES[t];
  return '#000000';
}

// 去掉 // 与 # 行注释，再按空白和花括号切词
function tokenize(src: string): string[] {
  const lines = src.split('\n');
  const cleaned = lines
    .map((l) => l.replace(/\/\/.*$/, '').replace(/#.*$/, ''))
    .join('\n');
  const toks = cleaned.match(/[{}]|[^\s{}]+/g) || [];
  return toks;
}

interface Cmd {
  op: string;
  args: string[];
  body?: Cmd[]; // repeat 子命令
}

// 递归解析成命令树（支持嵌套 repeat）
function parse(tokens: string[]): Cmd[] {
  let i = 0;
  function walk(stopAtBrace: boolean): Cmd[] {
    const cmds: Cmd[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok === '}') {
        if (stopAtBrace) { i++; return cmds; }
        i++; continue;
      }
      if (tok === '{') { i++; continue; }
      if (tok === 'repeat') {
        const n = Number(tokens[i + 1]);
        i += 2;
        // 可选的 '{'
        if (tokens[i] === '{') i++;
        const body = walk(true);
        cmds.push({ op: 'repeat', args: [String(Number.isFinite(n) ? n : 1)], body });
        continue;
      }
      if (COMMANDS.has(tok)) {
        const args: string[] = [];
        i++;
        while (i < tokens.length && !COMMANDS.has(tokens[i]) && tokens[i] !== '}' && tokens[i] !== '{' && tokens[i] !== 'repeat') {
          args.push(tokens[i]); i++;
        }
        cmds.push({ op: tok, args });
        continue;
      }
      i++; // 未知词，跳过
    }
    return cmds;
  }
  return walk(false);
}

export function runTurtle(script: string, opts: TurtleOptions): PenStroke[] {
  const startHeading = opts.startHeading ?? 0;
  const maxOps = opts.maxOps ?? 8000;

  let x = opts.startX;
  let y = opts.startY;
  let heading = startHeading;
  let penDown = false;
  let color = '#000000';
  let width = 3;
  let ops = 0;

  // 当前笔画（落笔连续段）
  let cur: PenStroke | null = null;
  const strokes: PenStroke[] = [];

  function flush() {
    if (cur && cur.points.length >= 4) strokes.push(cur);
    cur = null;
  }

  function vertex() {
    if (!cur) cur = { points: [], widths: [], colors: [] };
    cur.points.push(Number(x.toFixed(1)), Number(y.toFixed(1)));
    cur.widths.push(width);
    cur.colors.push(color);
  }

  function move(dist: number) {
    if (ops++ > maxOps) return;
    const rad = (heading * Math.PI) / 180;
    const nx = x + dist * Math.cos(rad);
    const ny = y + dist * Math.sin(rad);
    if (penDown) {
      // 起笔：先落一个当前点，再落到目标点
      if (!cur || cur.points.length === 0) vertex();
      x = nx; y = ny;
      vertex();
    } else {
      x = nx; y = ny;
    }
  }

  function exec(cmds: Cmd[]) {
    for (const c of cmds) {
      if (ops > maxOps) break;
      switch (c.op) {
        case 'repeat': {
          const n = Math.min(Number(c.args[0]) || 0, 1000);
          for (let k = 0; k < n; k++) exec(c.body || []);
          break;
        }
        case 'fd': case 'forward': move(Number(c.args[0]) || 0); break;
        case 'bk': case 'back': move(-(Number(c.args[0]) || 0)); break;
        case 'lt': case 'left': heading -= Number(c.args[0]) || 0; break;
        case 'rt': case 'right': heading += Number(c.args[0]) || 0; break;
        case 'pu': case 'penup': case 'up': flush(); penDown = false; break;
        case 'pd': case 'pendown': case 'down': penDown = true; break;
        case 'color': if (c.args[0]) color = parseColor(c.args[0]); break;
        case 'width': case 'pensize': {
          const w = Number(c.args[0]);
          if (Number.isFinite(w) && w > 0) width = w;
          break;
        }
        case 'goto': {
          const gx = Number(c.args[0]), gy = Number(c.args[1]);
          if (Number.isFinite(gx) && Number.isFinite(gy)) {
            if (penDown) {
              if (!cur || cur.points.length === 0) vertex();
              x = gx; y = gy;
              vertex();
            } else { x = gx; y = gy; }
          }
          break;
        }
        default: break;
      }
    }
  }

  exec(parse(tokenize(script)));
  flush();
  return strokes;
}

// 把多段笔画转成多个 pen 元素（by='ai'）
export function strokesToElements(strokes: PenStroke[], base: { id: string }): Partial<BoardElement>[] {
  return strokes.map((s, i) => ({
    type: 'pen' as const,
    points: s.points,
    widths: s.widths,
    colors: s.colors,
    color: s.colors[0] || '#000000',
    strokeWidth: s.widths[0] || 3,
    by: 'ai' as const,
    id: `${base.id}_s${i}`,
  }));
}
