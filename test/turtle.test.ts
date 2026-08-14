import { describe, it, expect } from 'vitest';
import { runTurtle, turtleToElements } from '../src/infrastructure/turtle';

describe('turtle', () => {
  it('draws a square with repeat', () => {
    const items = runTurtle(
      `pd\nrepeat 4 {\n fd 50\n rt 90\n}`,
      { startX: 200, startY: 150, startHeading: 0 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(p.length).toBeGreaterThan(4);
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
    expect(Math.round(p[p.length - 2])).toBe(200);
    expect(Math.round(p[p.length - 1])).toBe(150);
  });

  it('splits strokes across pen up/down', () => {
    const items = runTurtle(
      `pd fd 20 pu fd 20 pd fd 20`,
      { startX: 100, startY: 100 },
    );
    expect(items.length).toBe(2);
  });

  it('records color and width changes', () => {
    const items = runTurtle(
      `color red\nwidth 8\npd fd 30\ncolor blue\nfd 30`,
      { startX: 0, startY: 0 },
    );
    const s = items[0];
    expect(s.colors[0]).toBe('#e74c3c');
    expect(s.widths[0]).toBe(8);
    expect(s.colors.includes('#2980b9')).toBe(true);
  });

  it('supports hex colors without treating # as a comment', () => {
    const items = runTurtle(
      `# 行首注释会被忽略\ncolor #FF8800\npd fd 20`,
      { startX: 0, startY: 0 },
    );
    expect(items.length).toBe(1);
    expect(items[0].colors[0]).toBe('#ff8800');
  });

  it('circle produces an arc', () => {
    const items = runTurtle(`pd\ncircle 50`, { startX: 200, startY: 150 });
    expect(items.length).toBe(1);
    expect(items[0].points.length).toBeGreaterThan(10);
    // 闭合：绕一整圈首尾接近
    const p = items[0].points;
    expect(Math.abs(p[0] - p[p.length - 2])).toBeLessThan(5);
    expect(Math.abs(p[1] - p[p.length - 1])).toBeLessThan(5);
  });

  it('circle arc direction matches standard turtle', () => {
    // 标准 turtle：圆心在起点左侧（r>0），右转=顺时针。circle 50,90 终点应在起点左50上50。
    // 逻辑(-50,50) → 屏幕(150,100)
    const a = runTurtle(`pd circle 50, 90`, { startX: 200, startY: 150 });
    const ap = a[0].points;
    expect(Math.round(ap[ap.length - 2])).toBe(150);
    expect(Math.round(ap[ap.length - 1])).toBe(100);
    // circle 50,-180 顺时针半圆：终点在起点左100，逻辑(-100,0) → 屏幕(100,150)
    const b = runTurtle(`pd circle 50, -180`, { startX: 200, startY: 150 });
    const bp = b[0].points;
    expect(Math.round(bp[bp.length - 2])).toBe(100);
    expect(Math.round(bp[bp.length - 1])).toBe(150);
    // circle -50,90 圆心在右侧：终点逻辑(50,50) → 屏幕(250,100)
    const c = runTurtle(`pd circle -50, 90`, { startX: 200, startY: 150 });
    const cp = c[0].points;
    expect(Math.round(cp[cp.length - 2])).toBe(250);
    expect(Math.round(cp[cp.length - 1])).toBe(100);
  });

  it('dot emits a filled shape', () => {
    const items = runTurtle(`dot 20, red`, { startX: 100, startY: 100 });
    const d = items[0];
    expect('fill' in d).toBe(true);
    if ('fill' in d) {
      expect(d.fill).toBe('#e74c3c');
      expect(d.points.length).toBeGreaterThan(4);
    }
  });

  it('supports comma-separated multi-arg commands with negatives', () => {
    // 严格模式：多参数命令用逗号分隔，负号独立，无空格歧义
    const items = runTurtle(
      `pu goto 100, -50 pd circle 50, -180\ncolor red, blue\nrect 40, -30`,
      { startX: 200, startY: 150 },
    );
    // circle(半圆) + rect（含轮廓）都产生笔画，共 2 个
    expect(items.length).toBeGreaterThanOrEqual(2);
    // 落笔首个顶点应在 goto 目标 (100,-50)：画布 x=300, y=200
    const first = items[0].points;
    expect(Math.round(first[0])).toBe(300);
    expect(Math.round(first[1])).toBe(200);
    // rect 描边红色（color red, blue 的描边参数）
    expect(items.some((i) => 'widths' in i && i.colors[0] === '#e74c3c')).toBe(true);
  });

  it('single-arg commands still allow spaced arithmetic', () => {
    // 单参数命令参数是完整表达式，空格运算不受影响（仅多参数命令用逗号分隔）
    const items = runTurtle(`pd fd 10 + 5`, { startX: 200, startY: 150 });
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(215); // 200+15
  });

  it('begin_fill/end_fill emits a filled polygon plus outline', () => {
    const items = runTurtle(
      `fillcolor yellow\nbegin_fill\npd\nrepeat 4 { fd 40 rt 90 }\nend_fill\npu`,
      { startX: 200, startY: 150 },
    );
    // 期望：1 个 fill + 1 个轮廓 stroke
    const fillItems = items.filter((i) => 'fill' in i && i.fill);
    expect(fillItems.length).toBe(1);
    if (fillItems[0] && 'fill' in fillItems[0]) {
      expect(fillItems[0].fill).toBe('#f1c40f');
      expect(fillItems[0].points.length).toBeGreaterThan(4);
    }
  });

  it('setheading and setx/sety position the pen', () => {
    const items = runTurtle(
      `pu setheading 90 setx 300 sety 100 pd fd 20`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    // 逻辑坐标 setx 300 → 画布 x = 200+300；sety 100 → 画布 y = 150-100
    expect(Math.round(p[0])).toBe(500);
    expect(Math.round(p[1])).toBe(50);
    // 标准 turtle heading 90 = 向上（+y 逻辑）→ 画布 y 减小
    expect(Math.round(p[p.length - 1])).toBeLessThan(50);
  });

  it('goto accepts negative coordinates', () => {
    // 走到左上（负 x 负 y）：画布 x = 200-100=100，画布 y = 150-(-50)=200
    const items = runTurtle(
      `pu goto -100, -50 pd fd 1`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(100);
    expect(Math.round(p[1])).toBe(200);
  });

  it('goto keeps negative y separate from negative x', () => {
    // 回归：goto 100, -50 之前空格写法会把 y 误算成减法吞掉，y 落到 0
    const items = runTurtle(`pu goto 100, -50 pd fd 1`, { startX: 200, startY: 150 });
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(300); // 200+100
    // 逻辑 y=-50 → 画布 y = 150-(-50) = 200，而不是 150
    expect(Math.round(p[1])).toBe(200);
  });

  it('goto supports negative coordinates with expressions', () => {
    const items = runTurtle(`pu goto -100, 0 sety -50 pd fd 1`, { startX: 200, startY: 150 });
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(100);   // 200-100
    expect(Math.round(p[1])).toBe(200);   // 150-(-50)
  });

  it('rect, ellipse and line produce strokes', () => {
    const items = runTurtle(
      `rect 40, 30\nellipse 20, 10\nline 0, 0, 10, 10`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(3);
    // rect: 闭合矩形（首尾同点）
    const r = items[0].points;
    expect(r[0]).toBe(r[r.length - 2]);
    expect(r[1]).toBe(r[r.length - 1]);
    expect(r.length).toBeGreaterThan(6);
    // ellipse: 闭合成圆
    const e = items[1].points;
    expect(Math.abs(e[0] - e[e.length - 2])).toBeLessThan(2);
    // line: 两点线段
    expect(items[2].points.length).toBe(4);
  });

  it('lt turns counter-clockwise (heading+) and rt clockwise', () => {
    // lt 90 → 朝 +y（逻辑向上）→ 画布 y 减小；rt 90 → 朝 -y → 画布 y 增大
    const a = runTurtle(`pd lt 90 fd 20`, { startX: 200, startY: 150 });
    const b = runTurtle(`pd rt 90 fd 20`, { startX: 200, startY: 150 });
    const pa = a[0].points, pb = b[0].points;
    expect(Math.round(pa[pa.length - 1])).toBeLessThan(150);
    expect(Math.round(pb[pb.length - 1])).toBeGreaterThan(150);
  });

  it('clear emits a clear marker and drops prior drawings', () => {
    const items = runTurtle(`pd fd 20\nclear\npd fd 10`, { startX: 0, startY: 0 });
    expect(items.some((i) => i.type === 'clear')).toBe(true);
    // clear 之前的图形被丢弃，只保留 clear 之后的笔画
    const strokes = items.filter((i) => i.type !== 'clear');
    expect(strokes.length).toBe(1);
    if (strokes[0] && 'points' in strokes[0]) {
      expect(strokes[0].points.length).toBe(4);
    }
  });

  it('turtleToElements skips the clear marker', () => {
    const items = runTurtle(`clear\npd fd 10`, { startX: 0, startY: 0 });
    const els = turtleToElements(items, { id: 't' });
    expect(els.length).toBe(1);
    expect(els[0].type).toBe('pen');
  });

  it('supports variables and arithmetic expressions', () => {
    const items = runTurtle(
      `size = 25\npd fd size * 2`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    // size*2 = 50，朝右 → 画布 x 增大 50
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(250);
  });

  it('supports if/else with comparisons', () => {
    const a = runTurtle(`x = 5\nif x > 3 { pd fd 30 }`, { startX: 0, startY: 0 });
    const b = runTurtle(`x = 1\nif x > 3 { pd fd 30 } else { pd fd 10 }`, { startX: 0, startY: 0 });
    expect(a.length).toBe(1);
    expect(a[0].points.length).toBe(4);
    // else 分支：只画了 10，也应是 2 点一笔
    expect(b.length).toBe(1);
    expect(b[0].points.length).toBe(4);
  });

  it('supports else-if chains and logical operators', () => {
    // else if 链 + && 逻辑与
    const items = runTurtle(
      `x = 5\ny = 3\nif x > 3 && y > 2 { pd fd 30 } else if x > 0 { pd fd 10 } else { pd fd 5 }`,
      { startX: 0, startY: 0 },
    );
    expect(items.length).toBe(1);
    // 条件 x>3 && y>2 成立 → 走第一个分支，画 30
    expect(Math.round(items[0].points[items[0].points.length - 2])).toBe(30);
  });

  it('supports all comparison and boolean operators', () => {
    const p = (script: string) =>
      runTurtle(script, { startX: 0, startY: 0 })[0].points;
    // != 与 || 逻辑或
    expect(Math.round(p(`a = 1\nb = 2\nif a != 1 || b > 1 { pd fd 20 }`)[2])).toBe(20);
    // <= 和 >= 同时成立
    expect(Math.round(p(`a = 5\nif a >= 5 && a <= 5 { pd fd 15 }`)[2])).toBe(15);
    // 未命中分支则不绘制
    expect(runTurtle(`a = 0\nif a > 1 && a < -1 { pd fd 20 }`, { startX: 0, startY: 0 }).length).toBe(0);
  });

  it('supports nested loops', () => {
    // 外层 repeat 3 次，内层 for 2 步 → 每步 fd 10 / rt 60，共 360° 闭合
    const items = runTurtle(
      `repeat 3 {\n for (j = 0; j < 2; j = j + 1) { pd fd 10 rt 60 }\n}`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(Math.round(p[p.length - 2]));
    expect(Math.round(p[1])).toBe(Math.round(p[p.length - 1]));
  });

  it('uses loop variable inside loop body', () => {
    // i=1..4，每步 fd i*10 → 10+20+30+40 = 100
    const items = runTurtle(
      `for (i = 1; i <= 4; i = i + 1) { pd fd i * 10 }`,
      { startX: 0, startY: 0 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(100);
  });

  it('supports while loop with a counter', () => {
    const items = runTurtle(
      `n = 0\nwhile n < 4 {\n pd fd 20\n rt 90\n n = n + 1\n}`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    // 正方形：闭合，首尾同点
    expect(Math.round(p[0])).toBe(Math.round(p[p.length - 2]));
    expect(Math.round(p[1])).toBe(Math.round(p[p.length - 1]));
  });

  it('supports for loop', () => {
    const items = runTurtle(
      `for (i = 0; i < 4; i = i + 1) { pd fd 20 lt 90 }`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(Math.round(p[p.length - 2]));
    expect(Math.round(p[1])).toBe(Math.round(p[p.length - 1]));
  });

  it('supports math functions in expressions', () => {
    const items = runTurtle(
      `pd fd sqrt(100) + abs(-5) + pow(2, 3)`,
      { startX: 200, startY: 150 },
    );
    // 10 + 5 + 8 = 23
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(223);
  });

  it('supports custom functions that draw', () => {
    const items = runTurtle(
      `to square(s) {\n repeat 4 { pd fd s rt 90 }\n}\npd\nsquare(30)`,
      { startX: 200, startY: 150 },
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(Math.round(p[p.length - 2]));
    expect(Math.round(p[1])).toBe(Math.round(p[p.length - 1]));
  });

  it('supports naked function-name calls (no parentheses)', () => {
    // 裸调用 `seg` 之前曾因未知命令被静默忽略，导致 added:0
    const items = runTurtle(`pd\nto seg { fd 20 }\nseg`, { startX: 0, startY: 0 });
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(20);
  });

  it('supports custom functions that return a value', () => {
    const items = runTurtle(
      `to double(x) {\n return x * 2\n}\npd fd double(10)`,
      { startX: 200, startY: 150 },
    );
    const p = items[0].points;
    expect(Math.round(p[p.length - 2])).toBe(220);
  });

  it('stops infinite loops via maxOps', () => {
    const items = runTurtle(`n = 0\nwhile true { n = n + 1 }`, { startX: 0, startY: 0, maxOps: 1000 });
    expect(Array.isArray(items)).toBe(true);
  });

  it('keeps comments working with the new parser', () => {
    const items = runTurtle(
      `# 行首注释\npd fd 20 // 行内注释\nrt 90`,
      { startX: 0, startY: 0 },
    );
    expect(items.length).toBe(1);
  });
});
