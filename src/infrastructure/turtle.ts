// Turtle 解释器：把 turtle 脚本模拟成路径/填充图形
// 支持：fd/bk(移动), lt/rt(转向), pu/pd(抬笔落笔), color(双色)/pencolor/fillcolor,
//       width(粗细), goto/setx/sety/setheading/home(定位), circle(圆/弧), dot(点),
//       begin_fill/end_fill(填充), repeat(循环)。纯 JS，无依赖。
import type { BoardElement } from '../domain/types';

// 一段连续的落笔笔画（pen 元素的数据来源）
export interface PenStroke {
  points: number[];
  widths: number[];
  colors: string[];
}

// 一个封闭填充多边形（polygon 元素的数据来源）
export interface FillShape {
  points: number[];
  fill: string;
  color: string;
  strokeWidth: number;
}

export type TurtleItem = PenStroke | FillShape;

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
  'color', 'pencolor', 'fillcolor', 'width', 'pensize',
  'goto', 'setpos', 'setx', 'sety', 'setheading', 'seth', 'home',
  'circle', 'dot', 'begin_fill', 'bf', 'end_fill', 'ef',
  'repeat', 'pos', 'heading', 'isdown',
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
  const cleaned = src
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/#.*$/, ''))
    .join('\n');
  return cleaned.match(/[{}]|[^\s{}]+/g) || [];
}

interface Cmd {
  op: string;
  args: string[];
  body?: Cmd[]; // repeat 子命令
}

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

export function runTurtle(script: string, opts: TurtleOptions): TurtleItem[] {
  const startHeading = opts.startHeading ?? 0;
  const maxOps = opts.maxOps ?? 8000;

  let x = opts.startX;
  let y = opts.startY;
  let heading = startHeading;
  let penDown = false;
  let color = '#000000';
  let fillColor = '#000000';
  let width = 3;
  let ops = 0;

  // 当前笔画（落笔连续段）
  let cur: PenStroke | null = null;
  const items: TurtleItem[] = [];

  // 填充状态
  let filling = false;
  let fillPoints: number[] = [];

  function flush() {
    if (cur && cur.points.length >= 4) items.push(cur);
    cur = null;
  }

  function vertex() {
    if (!cur) cur = { points: [], widths: [], colors: [] };
    cur.points.push(Number(x.toFixed(1)), Number(y.toFixed(1)));
    cur.widths.push(width);
    cur.colors.push(color);
  }

  function endFill() {
    if (!filling) return;
    filling = false;
    if (fillPoints.length >= 6) {
      const pts = fillPoints.slice();
      // 闭合：若首尾不同，补回起点
      if (pts[0] !== pts[pts.length - 2] || pts[1] !== pts[pts.length - 1]) {
        pts.push(pts[0], pts[1]);
      }
      const shape: FillShape = {
        points: pts,
        fill: fillColor,
        color,
        strokeWidth: width,
      };
      items.push(shape);
      // 轮廓描边（画在填充之上）
      items.push({
        points: pts,
        widths: pts.map(() => width),
        colors: pts.map(() => color),
      });
    }
    fillPoints = [];
  }

  function move(dist: number) {
    if (ops++ > maxOps) return;
    const rad = (heading * Math.PI) / 180;
    const nx = x + dist * Math.cos(rad);
    const ny = y + dist * Math.sin(rad);
    if (penDown) {
      if (filling) {
        if (fillPoints.length === 0) fillPoints.push(x, y);
        x = nx; y = ny;
        fillPoints.push(x, y);
      } else {
        if (!cur || cur.points.length === 0) vertex();
        x = nx; y = ny;
        vertex();
      }
    } else {
      x = nx; y = ny;
    }
  }

  function gotoAbs(gx: number, gy: number) {
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
    if (penDown) {
      if (filling) {
        if (fillPoints.length === 0) fillPoints.push(x, y);
        x = gx; y = gy;
        fillPoints.push(x, y);
      } else {
        if (!cur || cur.points.length === 0) vertex();
        x = gx; y = gy;
        vertex();
      }
    } else {
      x = gx; y = gy;
    }
  }

  function circleCmd(r: number, extent: number, steps?: number) {
    if (!Number.isFinite(r) || r === 0) return;
    if (!Number.isFinite(extent) || extent === 0) extent = 360;
    const sgn = r >= 0 ? 1 : -1;
    const n = steps && steps >= 3
      ? Math.round(steps)
      : Math.max(4, Math.round(Math.min(Math.abs(extent), 360) / 4));
    const per = extent / n; // 每次小转角（带符号）
    const stepLen = Math.abs(r) * (2 * Math.PI / 360) * Math.abs(per);
    for (let k = 0; k < n && ops <= maxOps; k++) {
      move(stepLen);
      heading -= sgn * per; // r>0 向左(中心在左)，y 向下坐标系里左转即 heading 减小
    }
  }

  function dotCmd(size: number, col?: string) {
    const r = Math.max(0.5, size / 2);
    const c = col ? parseColor(col) : color;
    const n = 24;
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push(Number((x + r * Math.cos(a)).toFixed(1)), Number((y + r * Math.sin(a)).toFixed(1)));
    }
    pts.push(pts[0], pts[1]);
    items.push({ points: pts, fill: c, color: c, strokeWidth: 0 });
  }

  function exec(cmds: Cmd[]) {
    for (const c of cmds) {
      if (ops > maxOps) break;
      const a = c.args;
      switch (c.op) {
        case 'repeat': {
          const n = Math.min(Number(a[0]) || 0, 1000);
          for (let k = 0; k < n; k++) exec(c.body || []);
          break;
        }
        case 'fd': case 'forward': move(Number(a[0]) || 0); break;
        case 'bk': case 'back': move(-(Number(a[0]) || 0)); break;
        case 'lt': case 'left': heading -= Number(a[0]) || 0; break;
        case 'rt': case 'right': heading += Number(a[0]) || 0; break;
        case 'pu': case 'penup': case 'up': flush(); penDown = false; break;
        case 'pd': case 'pendown': case 'down': penDown = true; break;
        case 'color': {
          // color <pen> [fill]
          if (a[0]) color = parseColor(a[0]);
          if (a[1]) fillColor = parseColor(a[1]);
          break;
        }
        case 'pencolor': if (a[0]) color = parseColor(a[0]); break;
        case 'fillcolor': if (a[0]) fillColor = parseColor(a[0]); break;
        case 'width': case 'pensize': {
          const w = Number(a[0]);
          if (Number.isFinite(w) && w > 0) width = w;
          break;
        }
        case 'goto': case 'setpos': gotoAbs(Number(a[0]), Number(a[1])); break;
        case 'setx': gotoAbs(Number(a[0]), y); break;
        case 'sety': gotoAbs(x, Number(a[0])); break;
        case 'setheading': case 'seth': {
          const h = Number(a[0]);
          if (Number.isFinite(h)) heading = h;
          break;
        }
        case 'home': {
          // 回到起点朝东（与初始 heading 一致，简化为朝右）
          flush();
          gotoAbs(opts.startX, opts.startY);
          heading = 0;
          break;
        }
        case 'circle': circleCmd(Number(a[0]), Number(a[1]) || 360, a[2] !== undefined ? Number(a[2]) : undefined); break;
        case 'dot': dotCmd(Number(a[0]) || 2, a[1]); break;
        case 'begin_fill': case 'bf': endFill(); filling = true; fillPoints = []; break;
        case 'end_fill': case 'ef': endFill(); break;
        default: break; // pos/heading/isdown 查询类，本实现无需输出
      }
    }
  }

  exec(parse(tokenize(script)));
  if (filling) endFill();
  flush();
  return items;
}

// 把 turtle 输出转成元素（stroke→pen，fill→polygon）
export function turtleToElements(items: TurtleItem[], base: { id: string }): Partial<BoardElement>[] {
  const out: Partial<BoardElement>[] = [];
  items.forEach((it, i) => {
    if ('fill' in it && it.fill) {
      out.push({
        type: 'polygon',
        points: it.points,
        fill: it.fill,
        color: it.color,
        strokeWidth: it.strokeWidth || 0,
        by: 'ai',
        id: `${base.id}_f${i}`,
      });
    } else {
      const s = it as PenStroke;
      out.push({
        type: 'pen',
        points: s.points,
        widths: s.widths,
        colors: s.colors,
        color: s.colors[0] || '#000000',
        strokeWidth: s.widths[0] || 3,
        by: 'ai',
        id: `${base.id}_s${i}`,
      });
    }
  });
  return out;
}
