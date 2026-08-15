// Turtle 解释器：把 turtle 脚本模拟成路径/填充图形
// 对齐标准 Python turtle 语义：逻辑原点在画布中心，+x 向右、+y 向上，
// 0° 朝右、角度逆时针为正（left/lt 增大 heading）。输出时映射回画布坐标（左上原点、y 向下）。
// 支持：fd/bk(移动), lt/rt(转向), pu/pd(抬笔落笔), color(双色)/pencolor/fillcolor,
//       width(粗细), goto/setx/sety/setheading/home(定位), circle(圆/弧), dot(点),
//       rect/ellipse/line(几何图形), begin_fill/end_fill(填充),
//       流程控制: repeat/while/for/if...else，
//       变量赋值: x = 表达式（+ - * / %、比较、逻辑、括号），
//       数学函数: sqrt sin cos tan abs pow floor ceil round random min max log exp mod atan2，
//       自定义函数: to name(a b) { ... } 定义、name(a, b) 调用、return 返回值，
//       clear(清空画布后重画)。纯 JS，无依赖。
import type { BoardElement } from '../domain/types';
import { isPythonStyle, pythonToTurtle } from './turtlePython';

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

// 清空画布标记：出现在 items 中表示执行时应先清空画布已有内容
export interface ClearItem {
  type: 'clear';
}

export type TurtleItem = PenStroke | FillShape | ClearItem;

// 类型守卫：判断是否为清空标记（只有 ClearItem 带 type 字段）
export function isClearItem(it: TurtleItem): it is ClearItem {
  return 'type' in it && it.type === 'clear';
}

export interface TurtleOptions {
  startX: number; // 画布中心 x（逻辑原点映射到的画布坐标）
  startY: number; // 画布中心 y
  startHeading?: number; // 度，0=朝右(+x)
  maxOps?: number;       // 解释器步数上限，防止死循环
}

const COLOR_NAMES: Record<string, string> = {
  red: '#e74c3c', green: '#27ae60', blue: '#2980b9', black: '#000000', white: '#ffffff',
  yellow: '#f1c40f', orange: '#e67e22', purple: '#8e44ad', pink: '#ff6b9d', brown: '#8b5a2b',
  gray: '#95a5a6', grey: '#95a5a6', cyan: '#1abc9c', teal: '#008080', gold: '#ffd700',
  silver: '#c0c0c0', navy: '#000080', lime: '#00ff00', magenta: '#ff00ff',
  // 扩展：Python turtle 支持全套 CSS 颜色名，补齐 agent 高频使用的常见色
  skyblue: '#87ceeb', lightblue: '#add8e6', lightgreen: '#90ee90', lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightyellow: '#ffffe0', lightcyan: '#e0ffff',
  darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b', darkorange: '#ff8c00',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', darkcyan: '#008b8b', darkmagenta: '#8b008b',
  chocolate: '#d2691e', coral: '#ff7f50', crimson: '#dc143c', firebrick: '#b22222',
  indianred: '#cd5c5c', salmon: '#fa8072', tomato: '#ff6347', forestgreen: '#228b22',
  seagreen: '#2e8b57', springgreen: '#00ff7f', turquoise: '#40e0d0', aqua: '#00ffff',
  aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4',
  blanchedalmond: '#ffebcd', blueviolet: '#8a2be2', burlywood: '#deb887',
  cadetblue: '#5f9ea0', chartreuse: '#7fff00', cornflowerblue: '#6495ed', cornsilk: '#fff8dc',
  darkgoldenrod: '#b8860b', darkkhaki: '#bdb76b', darkolivegreen: '#556b2f', darkorchid: '#9932cc',
  darksalmon: '#e9967a', darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
  dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', goldenrod: '#daa520', greenyellow: '#adff2f',
  honeydew: '#f0fff0', hotpink: '#ff69b4', indigo: '#4b0082', ivory: '#fffff0',
  khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd', lightcoral: '#f08080', lightgoldenrodyellow: '#fafad2',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', limegreen: '#32cd32', linen: '#faf0e6', maroon: '#800000',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
  mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', oldlace: '#fdf5e6',
  olivedrab: '#6b8e23', olive: '#808000', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', plum: '#dda0dd',
  powderblue: '#b0e0e6', rebeccapurple: '#663399', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', sandybrown: '#f4a460', seashell: '#fff5ee',
  sienna: '#a0522d', slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090',
  steelblue: '#4682b4', tan: '#d2b48c', thistle: '#d8bfd8', violet: '#ee82ee',
  wheat: '#f5deb3', whitesmoke: '#f5f5f5', yellowgreen: '#9acd32',
};

// 全部命令关键字（含流程控制），作为命令参数解析的结束边界
const COMMANDS = new Set([
  'fd', 'forward', 'bk', 'back', 'lt', 'left', 'rt', 'right',
  'pu', 'penup', 'up', 'pd', 'pendown', 'down',
  'color', 'pencolor', 'fillcolor', 'width', 'pensize',
  'goto', 'setpos', 'setx', 'sety', 'setheading', 'seth', 'home',
  'circle', 'dot', 'rect', 'rectangle', 'ellipse', 'oval', 'line',
  'begin_fill', 'bf', 'end_fill', 'ef',
  'repeat', 'while', 'for', 'if', 'else', 'to', 'return', 'clear',
  'pos', 'heading', 'isdown', 'break', 'continue',
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

// 表达式求值结果：数字 / 颜色字符串 / 布尔
type Value = number | string | boolean;

function toNum(v: Value): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: Value): boolean {
  return !!v;
}

// return 通过异常向上抛，由函数调用处捕获取值
class ReturnSignal {
  constructor(public value?: Value) {}
}

// break / continue 通过异常向上抛，由最近一层循环捕获
class BreakSignal {}
class ContinueSignal {}

// ── 词法 ──
type TokType = 'num' | 'ident' | 'color' | 'op';
interface Token {
  type: TokType;
  value: string;
}

// 去掉注释（// 行内注释，或 # 仅在行首作注释），再扫描 token。
// 注意：# 仅在行首是注释，行内的 #rrggbb / #rgb 是 hex 颜色，必须保留。
function tokenize(src: string): Token[] {
  const cleaned = src
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*#.*$/, ''))
    .join('\n');
  const toks: Token[] = [];
  let i = 0;
  const n = cleaned.length;
  while (i < n) {
    const ch = cleaned[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u3000') { i++; continue; }
    // 数字（含小数）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(cleaned[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9.]/.test(cleaned[j])) j++;
      toks.push({ type: 'num', value: cleaned.slice(i, j) });
      i = j; continue;
    }
    // 标识符 / 变量 / 函数名
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(cleaned[j])) j++;
      toks.push({ type: 'ident', value: cleaned.slice(i, j) });
      i = j; continue;
    }
    // 行内 hex 颜色（至少 3 位十六进制）
    if (ch === '#') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(cleaned[j])) j++;
      if (j - i >= 4) { toks.push({ type: 'color', value: cleaned.slice(i, j) }); i = j; continue; }
      i++; continue;
    }
    // 双字符运算符
    const two = cleaned.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      toks.push({ type: 'op', value: two }); i += 2; continue;
    }
    if ('{}()=,+-*/%<>!;'.includes(ch)) {
      toks.push({ type: 'op', value: ch }); i++; continue;
    }
    i++; // 未知字符跳过
  }
  return toks;
}

function isOpTok(tokens: Token[], pos: { i: number }, v: string): boolean {
  const t = tokens[pos.i];
  return !!t && t.type === 'op' && t.value === v;
}

// ── 语法：语句树 ──
// cmd/assign 的 value/args 保存 token 切片，运行时再按当前变量求值；
// repeat/while/if/def 等保留子语句。
type Stmt =
  | { kind: 'cmd'; name: string; args: Token[][] }
  | { kind: 'assign'; name: string; value: Token[] }
  | { kind: 'repeat'; count: Token[]; body: Stmt[] }
  | { kind: 'while'; cond: Token[]; body: Stmt[] }
  | { kind: 'for'; init: Stmt | null; cond: Token[]; update: Stmt | null; body: Stmt[] }
  | { kind: 'if'; cond: Token[]; then: Stmt[]; elseStmt: Stmt[] | null }
  | { kind: 'def'; name: string; params: string[]; body: Stmt[] }
  | { kind: 'call'; name: string; args: Token[][] }
  | { kind: 'return'; value: Token[] | null }
  | { kind: 'break' }
  | { kind: 'continue' };

// 仅推进位置的表达式扫描（与运行时求值 parseExpr 语法一致，避免解析期产生副作用）
function skipExpr(tokens: Token[], pos: { i: number }): void {
  skipOr(tokens, pos);
}
function skipOr(tokens: Token[], pos: { i: number }): void {
  skipAnd(tokens, pos);
  while (isOpTok(tokens, pos, '||')) { pos.i++; skipAnd(tokens, pos); }
}
function skipAnd(tokens: Token[], pos: { i: number }): void {
  skipEq(tokens, pos);
  while (isOpTok(tokens, pos, '&&')) { pos.i++; skipEq(tokens, pos); }
}
function skipEq(tokens: Token[], pos: { i: number }): void {
  skipRel(tokens, pos);
  while (isOpTok(tokens, pos, '==') || isOpTok(tokens, pos, '!=')) { pos.i++; skipRel(tokens, pos); }
}
function skipRel(tokens: Token[], pos: { i: number }): void {
  skipAdd(tokens, pos);
  while (isOpTok(tokens, pos, '<') || isOpTok(tokens, pos, '<=') || isOpTok(tokens, pos, '>') || isOpTok(tokens, pos, '>=')) {
    pos.i++; skipAdd(tokens, pos);
  }
}
function skipAdd(tokens: Token[], pos: { i: number }): void {
  skipMul(tokens, pos);
  while (isOpTok(tokens, pos, '+') || isOpTok(tokens, pos, '-')) { pos.i++; skipMul(tokens, pos); }
}
function skipMul(tokens: Token[], pos: { i: number }): void {
  skipUn(tokens, pos);
  while (isOpTok(tokens, pos, '*') || isOpTok(tokens, pos, '/') || isOpTok(tokens, pos, '%')) { pos.i++; skipUn(tokens, pos); }
}
function skipUn(tokens: Token[], pos: { i: number }): void {
  if (isOpTok(tokens, pos, '-') || isOpTok(tokens, pos, '+') || isOpTok(tokens, pos, '!')) { pos.i++; skipUn(tokens, pos); return; }
  skipPrim(tokens, pos);
}
function skipPrim(tokens: Token[], pos: { i: number }): void {
  const t = tokens[pos.i];
  if (!t) return;
  if (t.type === 'num' || t.type === 'color') { pos.i++; return; }
  if (t.type === 'op' && t.value === '(') {
    pos.i++; skipExpr(tokens, pos);
    if (isOpTok(tokens, pos, ')')) pos.i++;
    return;
  }
  if (t.type === 'ident') {
    pos.i++;
    if (isOpTok(tokens, pos, '(')) {
      pos.i++;
      while (pos.i < tokens.length && !isOpTok(tokens, pos, ')')) {
        skipExpr(tokens, pos);
        if (isOpTok(tokens, pos, ',')) pos.i++;
      }
      if (isOpTok(tokens, pos, ')')) pos.i++;
    }
    return;
  }
  // 顶层逗号：命令参数分隔符，表达式在此停止（不消费，交给命令解析切分）
  if (t.type === 'op' && t.value === ',') return;
  pos.i++;
}

function parse(tokens: Token[]): Stmt[] {
  const pos = { i: 0 };
  const peek = (): Token | undefined => tokens[pos.i];

  // 解析一个表达式项（贪婪），返回 token 切片，运行时再求值
  function term(): Token[] {
    const start = pos.i;
    skipExpr(tokens, pos);
    return tokens.slice(start, pos.i);
  }

  function parseAssignStmt(): Stmt {
    const t = peek();
    const name = t ? t.value : '';
    pos.i++;
    if (!isOpTok(tokens, pos, '=')) return { kind: 'cmd', name: '', args: [] };
    pos.i++;
    return { kind: 'assign', name, value: term() };
  }

  function parseBlock(): Stmt[] {
    if (!isOpTok(tokens, pos, '{')) return [];
    pos.i++;
    const body: Stmt[] = [];
    while (pos.i < tokens.length && !isOpTok(tokens, pos, '}')) {
      const s = parseStatement();
      if (s) body.push(s);
    }
    if (isOpTok(tokens, pos, '}')) pos.i++;
    return body;
  }

  function parseCallOrCmd(name: string): Stmt {
    if (isOpTok(tokens, pos, '(')) {
      pos.i++;
      const args: Token[][] = [];
      while (pos.i < tokens.length && !isOpTok(tokens, pos, ')')) {
        args.push(term());
        if (isOpTok(tokens, pos, ',')) pos.i++;
      }
      if (isOpTok(tokens, pos, ')')) pos.i++;
      return { kind: 'call', name, args };
    }
    // 命令参数一律用逗号分隔（严格模式）：goto 100, -50 / rect 40, 30 / line 0, 0, 10, 10。
    // 每个参数是一个完整表达式（term 会在顶层逗号处停止），负号天然独立，无空格歧义。
    const args: Token[][] = [];
    while (pos.i < tokens.length) {
      const t = tokens[pos.i];
      if (t.type === 'op' && (t.value === '{' || t.value === '}' || t.value === '=')) break;
      // 命令参数后紧跟 `ident =` 是赋值语句，不是命令参数，立即停止
      if (t.type === 'ident' && (!COMMANDS.has(t.value)) && tokens[pos.i + 1]?.type === 'op' && tokens[pos.i + 1].value === '=') break;
      if (t.type === 'ident' && COMMANDS.has(t.value)) break;
      // 已消费过参数后又遇到 函数调用形态（ident 紧跟 `(`）：
      // 这是下一个独立命令（如 `rt 60 draw(n-1)`），不是当前命令的延续参数
      if (args.length > 0 && t.type === 'ident' && tokens[pos.i + 1]?.type === 'op' && tokens[pos.i + 1].value === '(') break;
      const start = pos.i;
      term();
      args.push(tokens.slice(start, pos.i));
      if (isOpTok(tokens, pos, ',')) pos.i++;
    }
    return { kind: 'cmd', name, args };
  }

  function parseStatement(): Stmt | null {
    const t = peek();
    if (!t) return null;
    if (t.type === 'op') { pos.i++; return null; }
    const v = t.value;

    if (v === 'repeat') {
      pos.i++;
      const count = term();
      const body = parseBlock();
      return { kind: 'repeat', count, body };
    }
    if (v === 'while') {
      pos.i++;
      const cond = term();
      const body = parseBlock();
      return { kind: 'while', cond, body };
    }
    if (v === 'for') {
      pos.i++;
      if (!isOpTok(tokens, pos, '(')) return null;
      pos.i++;
      let init: Stmt | null = null;
      if (!isOpTok(tokens, pos, ';')) init = parseAssignStmt();
      if (!isOpTok(tokens, pos, ';')) return null;
      pos.i++;
      const cond = term();
      if (!isOpTok(tokens, pos, ';')) return null;
      pos.i++;
      let update: Stmt | null = null;
      if (!isOpTok(tokens, pos, ')')) update = parseAssignStmt();
      if (!isOpTok(tokens, pos, ')')) return null;
      pos.i++;
      const body = parseBlock();
      return { kind: 'for', init, cond, update, body };
    }
    if (v === 'if') {
      pos.i++;
      const cond = term();
      const then = parseBlock();
      let elseStmt: Stmt[] | null = null;
      if (peek()?.type === 'ident' && peek()?.value === 'else') {
        pos.i++;
        if (peek()?.value === 'if') {
          const nested = parseStatement();
          elseStmt = nested ? [nested] : null;
        } else {
          elseStmt = parseBlock();
        }
      }
      return { kind: 'if', cond, then, elseStmt };
    }
    if (v === 'to') {
      pos.i++;
      const name = peek()?.value || '';
      pos.i++;
      const params: string[] = [];
      if (isOpTok(tokens, pos, '(')) {
        pos.i++;
        while (pos.i < tokens.length && !isOpTok(tokens, pos, ')')) {
          const p = peek();
          if (p && p.type === 'ident') params.push(p.value);
          pos.i++;
          if (isOpTok(tokens, pos, ',')) pos.i++;
        }
        if (isOpTok(tokens, pos, ')')) pos.i++;
      } else {
        while (peek()?.type === 'ident') { params.push(peek()!.value); pos.i++; }
      }
      const body = parseBlock();
      return { kind: 'def', name, params, body };
    }
    if (v === 'return') {
      pos.i++;
      const next = peek();
      const value = next && !(next.type === 'op' && next.value === '}') && !(next.type === 'ident' && COMMANDS.has(next.value))
        ? term()
        : null;
      return { kind: 'return', value };
    }
    if (v === 'break') { pos.i++; return { kind: 'break' }; }
    if (v === 'continue') { pos.i++; return { kind: 'continue' }; }
    if (t.type === 'ident') {
      pos.i++;
      if (isOpTok(tokens, pos, '=')) {
        pos.i++;
        return { kind: 'assign', name: v, value: term() };
      }
      return parseCallOrCmd(v);
    }
    pos.i++;
    return null;
  }

  const stmts: Stmt[] = [];
  while (pos.i < tokens.length) {
    if (isOpTok(tokens, pos, '}')) { pos.i++; continue; }
    const s = parseStatement();
    if (s) stmts.push(s);
  }
  return stmts;
}

export function runTurtle(script: string, opts: TurtleOptions): TurtleItem[] {
  const startHeading = opts.startHeading ?? 0;
  const maxOps = opts.maxOps ?? 8000;

  // 内部用标准 turtle 逻辑坐标：原点在画布中心，+y 向上，heading 0°=右、逆时针为正
  let x = 0;
  let y = 0;
  let heading = startHeading;
  let penDown = false;
  let color = '#000000';
  let fillColor = '#000000';
  let width = 3;
  let ops = 0;
  let aborted = false;

  // 当前笔画（落笔连续段）
  let cur: PenStroke | null = null;
  const items: TurtleItem[] = [];

  // 填充状态
  let filling = false;
  let fillPoints: number[] = [];

  // 逻辑坐标 → 画布坐标（画布左上原点、y 向下）
  const toCanvasX = (lx: number): number => opts.startX + lx;
  const toCanvasY = (ly: number): number => opts.startY - ly;

  function flush() {
    if (cur && cur.points.length >= 4) items.push(cur);
    cur = null;
  }

  function vertex() {
    if (!cur) cur = { points: [], widths: [], colors: [] };
    cur.points.push(Number(toCanvasX(x).toFixed(1)), Number(toCanvasY(y).toFixed(1)));
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
    if (ops++ > maxOps) { aborted = true; return; }
    const rad = (heading * Math.PI) / 180;
    // 标准 turtle：+y 向上为正
    const nx = x + dist * Math.cos(rad);
    const ny = y + dist * Math.sin(rad);
    if (penDown) {
      if (filling) {
        if (fillPoints.length === 0) fillPoints.push(toCanvasX(x), toCanvasY(y));
        x = nx; y = ny;
        fillPoints.push(toCanvasX(x), toCanvasY(y));
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
        if (fillPoints.length === 0) fillPoints.push(toCanvasX(x), toCanvasY(y));
        x = gx; y = gy;
        fillPoints.push(toCanvasX(x), toCanvasY(y));
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
    flush();
    // 标准 turtle：圆心在朝向左侧（r>0）或右侧（r<0），距当前点 |r|。
    // 朝向偏转 90° 即左侧方向（-sin, cos），故 cx=x-r·sinθ、cy=y+r·cosθ。
    const rad = (heading * Math.PI) / 180;
    const cx = x - r * Math.sin(rad);
    const cy = y + r * Math.cos(rad);
    // 起点即当前点，其相对圆心的角度（标准 turtle 从"底点"开始）
    const startAng = Math.atan2(y - cy, x - cx);
    const n = steps && steps >= 3
      ? Math.round(steps)
      : Math.max(4, Math.round(Math.min(Math.abs(extent), 360) / 4));
    // 每步弧角：r>0 逆时针（正向）、r<0 顺时针（反向）；extent 决定总角度
    const per = (extent * Math.PI / (180 * n)) * (r < 0 ? -1 : 1);
    // 尊重画笔状态：pd 才画线，pu 只移动（对齐标准 turtle）
    for (let k = 1; k <= n && ops <= maxOps; k++) {
      const a = startAng + per * k;
      gotoAbs(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    // 朝向累计：r>0 转 +extent，r<0 转 -extent
    heading += r < 0 ? -extent : extent;
  }

  function dotCmd(size: number, col?: string) {
    const r = Math.max(0.5, size / 2);
    const c = col ? parseColor(col) : color;
    const n = 24;
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push(Number(toCanvasX(x + r * Math.cos(a)).toFixed(1)), Number(toCanvasY(y + r * Math.sin(a)).toFixed(1)));
    }
    pts.push(pts[0], pts[1]);
    items.push({ points: pts, fill: c, color: c, strokeWidth: 0 });
  }

  // 矩形：当前点为左下角（逻辑坐标，+x 宽、+y 高），画闭合轮廓
  function rectCmd(w: number, h: number) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w === 0 || h === 0) return;
    const wasDown = penDown;
    flush();
    penDown = true;
    const x0 = x, y0 = y;
    gotoAbs(x0, y0);
    gotoAbs(x0 + w, y0);
    gotoAbs(x0 + w, y0 + h);
    gotoAbs(x0, y0 + h);
    gotoAbs(x0, y0);
    if (!wasDown) { flush(); penDown = false; }
  }

  // 椭圆：以当前点为圆心，rx/ry 为横纵半径（逻辑坐标）
  function ellipseCmd(rx: number, ry: number) {
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx === 0 || ry === 0) return;
    const wasDown = penDown;
    flush();
    const cx = x, cy = y;
    // 抬笔移到椭圆起点（避免从圆心拉出引线）
    penDown = false;
    gotoAbs(cx + rx, cy);
    penDown = true;
    const n = 48;
    for (let k = 0; k <= n && ops <= maxOps; k++) {
      const a = (k / n) * Math.PI * 2;
      gotoAbs(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
    if (!wasDown) { flush(); penDown = false; }
  }

  // 直线：从 (x1,y1) 画到 (x2,y2)（逻辑坐标）
  function lineCmd(x1: number, y1: number, x2: number, y2: number) {
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const wasDown = penDown;
    flush();
    // 抬笔移到起点，再落笔画到终点
    penDown = false;
    gotoAbs(x1, y1);
    penDown = true;
    gotoAbs(x2, y2);
    if (!wasDown) { flush(); penDown = false; }
  }

  // ── 运行时环境 ──
  // 变量栈：函数调用压入新帧，参数绑定到最顶帧；读取从栈顶向下查找
  const varStack: Array<Record<string, Value>> = [{}];
  // 函数表：def 预收集
  const funcs: Record<string, { params: string[]; body: Stmt[] }> = {};

  function getVar(name: string): Value | undefined {
    for (let k = varStack.length - 1; k >= 0; k--) {
      if (Object.prototype.hasOwnProperty.call(varStack[k], name)) return varStack[k][name];
    }
    if (name === 'pi') return Math.PI;
    if (name === 'e') return Math.E;
    if (name === 'true') return true;
    if (name === 'false') return false;
    return undefined;
  }

  function setVar(name: string, v: Value) {
    varStack[varStack.length - 1][name] = v;
  }

  // 内置数学函数 + 自定义函数调用（表达式中的函数调用入口）
  function callValue(name: string, args: Value[]): Value {
    switch (name) {
      case 'sqrt': return Math.sqrt(toNum(args[0]));
      case 'sin': return Math.sin(toNum(args[0]));
      case 'cos': return Math.cos(toNum(args[0]));
      case 'tan': return Math.tan(toNum(args[0]));
      case 'abs': return Math.abs(toNum(args[0]));
      case 'floor': return Math.floor(toNum(args[0]));
      case 'ceil': return Math.ceil(toNum(args[0]));
      case 'round': return Math.round(toNum(args[0]));
      case 'pow': return Math.pow(toNum(args[0]), toNum(args[1] ?? 0));
      case 'log': return Math.log(toNum(args[0]));
      case 'exp': return Math.exp(toNum(args[0]));
      case 'mod': return toNum(args[0]) % toNum(args[1] ?? 0);
      case 'atan2': return Math.atan2(toNum(args[0]), toNum(args[1] ?? 0));
      case 'min': return Math.min(...args.map(toNum));
      case 'max': return Math.max(...args.map(toNum));
      case 'random':
        return args.length >= 2
          ? toNum(args[0]) + Math.random() * (toNum(args[1]) - toNum(args[0]))
          : Math.random();
      default: break;
    }
    const fn = funcs[name];
    if (!fn) return 0;
    varStack.push({});
    fn.params.forEach((p, k) => { varStack[varStack.length - 1][p] = args[k] ?? 0; });
    try {
      exec(fn.body);
      return 0;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value ?? 0;
      throw e;
    } finally {
      varStack.pop();
    }
  }

  // ── 表达式求值（递归下降，与 skipExpr 语法一致）──
  function parseExpr(tokens: Token[], pos: { i: number }): Value {
    return parseOr(tokens, pos);
  }
  function parseOr(tokens: Token[], pos: { i: number }): Value {
    let left = parseAnd(tokens, pos);
    while (isOpTok(tokens, pos, '||')) { pos.i++; left = truthy(left) || truthy(parseAnd(tokens, pos)); }
    return left;
  }
  function parseAnd(tokens: Token[], pos: { i: number }): Value {
    let left = parseEq(tokens, pos);
    while (isOpTok(tokens, pos, '&&')) { pos.i++; left = truthy(left) && truthy(parseEq(tokens, pos)); }
    return left;
  }
  function parseEq(tokens: Token[], pos: { i: number }): Value {
    let left = parseRel(tokens, pos);
    while (isOpTok(tokens, pos, '==') || isOpTok(tokens, pos, '!=')) {
      const op = tokens[pos.i].value; pos.i++;
      const right = parseRel(tokens, pos);
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }
  function parseRel(tokens: Token[], pos: { i: number }): Value {
    let left = parseAdd(tokens, pos);
    while (isOpTok(tokens, pos, '<') || isOpTok(tokens, pos, '<=') || isOpTok(tokens, pos, '>') || isOpTok(tokens, pos, '>=')) {
      const op = tokens[pos.i].value; pos.i++;
      const right = parseAdd(tokens, pos);
      const a = toNum(left), b = toNum(right);
      left = op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    return left;
  }
  function parseAdd(tokens: Token[], pos: { i: number }): Value {
    let left = parseMul(tokens, pos);
    while (isOpTok(tokens, pos, '+') || isOpTok(tokens, pos, '-')) {
      const op = tokens[pos.i].value; pos.i++;
      const right = parseMul(tokens, pos);
      left = op === '+' ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
    }
    return left;
  }
  function parseMul(tokens: Token[], pos: { i: number }): Value {
    let left = parseUn(tokens, pos);
    while (isOpTok(tokens, pos, '*') || isOpTok(tokens, pos, '/') || isOpTok(tokens, pos, '%')) {
      const op = tokens[pos.i].value; pos.i++;
      const right = parseUn(tokens, pos);
      left = op === '*' ? toNum(left) * toNum(right)
        : op === '/' ? (toNum(right) === 0 ? 0 : toNum(left) / toNum(right))
        : toNum(left) % toNum(right);
    }
    return left;
  }
  function parseUn(tokens: Token[], pos: { i: number }): Value {
    if (isOpTok(tokens, pos, '-')) { pos.i++; return -toNum(parseUn(tokens, pos)); }
    if (isOpTok(tokens, pos, '+')) { pos.i++; return toNum(parseUn(tokens, pos)); }
    if (isOpTok(tokens, pos, '!')) { pos.i++; return !truthy(parseUn(tokens, pos)); }
    return parsePrim(tokens, pos);
  }
  function parsePrim(tokens: Token[], pos: { i: number }): Value {
    const t = tokens[pos.i];
    if (!t) return 0;
    if (t.type === 'num') { pos.i++; return Number(t.value); }
    if (t.type === 'color') { pos.i++; return t.value; }
    if (t.type === 'op' && t.value === '(') {
      pos.i++;
      const v = parseExpr(tokens, pos);
      if (isOpTok(tokens, pos, ')')) pos.i++;
      return v;
    }
    if (t.type === 'ident') {
      const name = t.value; pos.i++;
      if (isOpTok(tokens, pos, '(')) {
        pos.i++;
        const args: Value[] = [];
        while (pos.i < tokens.length && !isOpTok(tokens, pos, ')')) {
          args.push(parseExpr(tokens, pos));
          if (isOpTok(tokens, pos, ',')) pos.i++;
        }
        if (isOpTok(tokens, pos, ')')) pos.i++;
        return callValue(name, args);
      }
      const v = getVar(name);
      return v !== undefined ? v : name; // 未定义标识符当作字符串字面量（如颜色名 red）
    }
    pos.i++;
    return 0;
  }

  function evalExpr(toks: Token[]): Value {
    if (toks.length === 0) return 0;
    const pos = { i: 0 };
    return parseExpr(toks, pos);
  }

  // ── 执行 ──
  function execCmd(name: string, slices: Token[][]) {
    const a = slices.map(evalExpr);
    const n = (k: number, d = 0): number => {
      const v = a[k];
      return typeof v === 'number' ? v : (Number(v) || d);
    };
    switch (name) {
      case 'fd': case 'forward': move(n(0)); break;
      case 'bk': case 'back': move(-n(0)); break;
      case 'lt': case 'left': heading += n(0); break;
      case 'rt': case 'right': heading -= n(0); break; // 右转=顺时针
      case 'pu': case 'penup': case 'up': flush(); penDown = false; break;
      case 'pd': case 'pendown': case 'down': penDown = true; break;
      case 'color': {
        // color <pen> [fill]
        if (a[0] !== undefined) color = parseColor(String(a[0]));
        if (a[1] !== undefined) fillColor = parseColor(String(a[1]));
        break;
      }
      case 'pencolor': if (a[0] !== undefined) color = parseColor(String(a[0])); break;
      case 'fillcolor': if (a[0] !== undefined) fillColor = parseColor(String(a[0])); break;
      case 'width': case 'pensize': {
        const w = n(0);
        if (w > 0) width = w;
        break;
      }
      case 'goto': case 'setpos': gotoAbs(n(0), n(1)); break;
      case 'setx': gotoAbs(n(0), y); break;
      case 'sety': gotoAbs(x, n(0)); break;
      case 'setheading': case 'seth': heading = n(0); break;
      case 'home': {
        // 回到逻辑原点(0,0) 即画布中心，朝东
        flush();
        gotoAbs(0, 0);
        heading = 0;
        break;
      }
      case 'circle': circleCmd(n(0), a[1] !== undefined ? n(1) : 360, a[2] !== undefined ? n(2) : undefined); break;
      case 'dot': dotCmd(n(0) || 2, a[1] !== undefined ? String(a[1]) : undefined); break;
      case 'rect': case 'rectangle': rectCmd(n(0), n(1)); break;
      case 'ellipse': case 'oval': ellipseCmd(n(0), n(1)); break;
      case 'line': lineCmd(n(0), n(1), n(2), n(3)); break;
      case 'begin_fill': case 'bf': endFill(); filling = true; fillPoints = []; break;
      case 'end_fill': case 'ef': endFill(); break;
      case 'clear': {
        // 清空画布：结束填充、丢弃已产生的图形，仅保留一个清空标记
        endFill();
        flush();
        items.length = 0;
        items.push({ type: 'clear' });
        break;
      }
      default: {
        // 裸函数名调用（无括号，如 `drawFlower`）：尝试执行已定义的自定义函数。
        // 否则视为 pos/heading/isdown 查询类，本实现无需输出。
        if (funcs[name]) callValue(name, a);
        break;
      }
    }
  }

  function exec(stmts: Stmt[]) {
    for (const s of stmts) {
      if (aborted) break;
      if (++ops > maxOps) { aborted = true; break; }
      switch (s.kind) {
        case 'cmd': execCmd(s.name, s.args); break;
        case 'assign': setVar(s.name, evalExpr(s.value)); break;
        case 'repeat': {
          const n = Math.min(Math.floor(toNum(evalExpr(s.count))), 1000);
          for (let k = 0; k < n && !aborted; k++) {
            try { exec(s.body); }
            catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
          }
          break;
        }
        case 'while': {
          while (!aborted && truthy(evalExpr(s.cond))) {
            if (++ops > maxOps) { aborted = true; break; }
            try { exec(s.body); }
            catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
          }
          break;
        }
        case 'for': {
          if (s.init) exec([s.init]);
          while (!aborted && truthy(evalExpr(s.cond))) {
            if (++ops > maxOps) { aborted = true; break; }
            try { exec(s.body); }
            catch (e) {
              if (e instanceof BreakSignal) break;
              if (e instanceof ContinueSignal) { if (s.update) exec([s.update]); continue; }
              throw e;
            }
            if (s.update) exec([s.update]);
          }
          break;
        }
        case 'if': {
          if (truthy(evalExpr(s.cond))) exec(s.then);
          else if (s.elseStmt) exec(s.elseStmt);
          break;
        }
        case 'def': break; // 已在预收集阶段注册
        case 'call': callValue(s.name, s.args.map(evalExpr)); break;
        case 'return': throw new ReturnSignal(s.value ? evalExpr(s.value) : undefined);
        case 'break': throw new BreakSignal();
        case 'continue': throw new ContinueSignal();
      }
    }
  }

  // 预收集函数定义，允许函数在定义前互相/递归调用
  function collectDefs(stmts: Stmt[]) {
    for (const s of stmts) {
      if (s.kind === 'def') {
        funcs[s.name] = { params: s.params, body: s.body };
      } else if (s.kind === 'repeat' || s.kind === 'while') {
        collectDefs(s.body);
      } else if (s.kind === 'for') {
        collectDefs(s.body);
        if (s.init) collectDefs([s.init]);
        if (s.update) collectDefs([s.update]);
      } else if (s.kind === 'if') {
        collectDefs(s.then);
        if (s.elseStmt) collectDefs(s.elseStmt);
      }
    }
  }

  const stmts = parse(tokenize(isPythonStyle(script) ? pythonToTurtle(script) : script));
  collectDefs(stmts);
  try {
    exec(stmts);
  } catch (e) {
    // 顶层 return 直接忽略
    if (!(e instanceof ReturnSignal)) throw e;
  }
  if (filling) endFill();
  flush();
  return items;
}

// 把 turtle 输出转成元素（stroke→pen，fill→polygon）
export function turtleToElements(items: TurtleItem[], base: { id: string }): Partial<BoardElement>[] {
  const out: Partial<BoardElement>[] = [];
  items.forEach((it, i) => {
    if (isClearItem(it)) return; // 清空标记：仅作信号，不产出元素
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
