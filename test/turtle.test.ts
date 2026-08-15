import { describe, it, expect } from 'vitest';
import { runTurtle, turtleToElements } from '../src/infrastructure/turtle';
import { isPythonStyle, pythonToTurtle } from '../src/infrastructure/turtlePython';

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
    // 标准 turtle：圆心在朝向左侧（r>0）。circle 50,90 从(0,0)朝右起：
    // 圆心(0,50)，终点(50,50)；逻辑(50,50) → 屏幕(250,100)
    const a = runTurtle(`pd circle 50, 90`, { startX: 200, startY: 150 });
    const ap = a[0].points;
    expect(Math.round(ap[ap.length - 2])).toBe(250);
    expect(Math.round(ap[ap.length - 1])).toBe(100);
    // circle 50,-180 顺时针半圆：终点在起点正上方，逻辑(0,100) → 屏幕(200,50)
    const b = runTurtle(`pd circle 50, -180`, { startX: 200, startY: 150 });
    const bp = b[0].points;
    expect(Math.round(bp[bp.length - 2])).toBe(200);
    expect(Math.round(bp[bp.length - 1])).toBe(50);
    // circle -50,90 圆心在右侧：终点逻辑(-50,-50) → 屏幕(150,200)
    const c = runTurtle(`pd circle -50, 90`, { startX: 200, startY: 150 });
    const cp = c[0].points;
    expect(Math.round(cp[cp.length - 2])).toBe(150);
    expect(Math.round(cp[cp.length - 1])).toBe(200);
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

  // ── 回归：变量在形状/循环中的表现 ──
  it('circle accepts variable radius', () => {
    expect(runTurtle('r=25; pd circle r', { startX: 0, startY: 0 }).length).toBeGreaterThan(0);
  });
  it('circle accepts literal arithmetic expression', () => {
    expect(runTurtle('pd circle 20 + 5', { startX: 0, startY: 0 }).length).toBeGreaterThan(0);
  });
  it('rect accepts variable dimensions', () => {
    expect(runTurtle('r=25; pd rect r, r', { startX: 0, startY: 0 }).length).toBeGreaterThan(0);
  });
  it('ellipse accepts variable radii', () => {
    expect(runTurtle('rx=30; ry=20; pd ellipse rx, ry', { startX: 0, startY: 0 }).length).toBeGreaterThan(0);
  });
  it('line accepts variable coordinates', () => {
    expect(runTurtle('x1=-110; y1=-100; x2=110; y2=-100; pd line x1, y1, x2, y2', { startX: 0, startY: 0 }).length).toBeGreaterThan(0);
  });
  it('repeat count accepts variable', () => {
    expect(runTurtle('n=3; pd repeat n { dot 10, blue }', { startX: 0, startY: 0 }).length).toBe(3);
  });
});

// ── 规约：对齐标准 Python turtle 的关键语义不变式 ──
describe('turtle conformance with standard semantics', () => {
  // 逻辑 (0,0) → 屏幕 (200,150)
  const C = { startX: 200, startY: 150 };

  it('fd moves along heading; heading 0 = +x, 90 = +y', () => {
    // 朝右 fd 100：逻辑(100,0) → 屏幕(300,150)
    const a = runTurtle(`pd fd 100`, C);
    expect(a[0].points[0]).toBe(200);
    expect(a[0].points[1]).toBe(150);
    expect(a[0].points[a[0].points.length - 2]).toBe(300);
    expect(a[0].points[a[0].points.length - 1]).toBe(150);
    // 朝上 fd 100：逻辑(0,100) → 屏幕(200,50)
    const b = runTurtle(`pd lt 90 fd 100`, C);
    expect(b[0].points[b[0].points.length - 2]).toBe(200);
    expect(b[0].points[b[0].points.length - 1]).toBe(50);
  });

  it('bk is backward: heading unchanged, moves opposite fd', () => {
    const a = runTurtle(`pd bk 100`, C);
    expect(a[0].points[a[0].points.length - 2]).toBe(100); // 逻辑(-100,0)
    expect(a[0].points[a[0].points.length - 1]).toBe(150);
  });

  it('lt increases heading (ccw), rt decreases (cw)', () => {
    // 朝右 lt 90 → 朝上；朝右 rt 90 → 朝下（逻辑 y-=）
    const a = runTurtle(`pd lt 90 fd 50`, C);
    expect(a[0].points[a[0].points.length - 1]).toBe(100); // (0,50)→y=100
    const b = runTurtle(`pd rt 90 fd 50`, C);
    expect(b[0].points[b[0].points.length - 1]).toBe(200); // (0,-50)→y=200
  });

  it('goto/setx/sety move without changing heading', () => {
    // goto 后继续 fd 应仍朝右（heading=0）
    const a = runTurtle(`pd goto 50, 0 fd 50`, C);
    expect(a[0].points[a[0].points.length - 2]).toBe(300); // 逻辑(100,0)
  });

  it('setheading sets absolute heading; home returns to origin heading east', () => {
    // setheading 90 后 fd 朝上
    const a = runTurtle(`pd setheading 90 fd 40`, C);
    expect(a[0].points[a[0].points.length - 1]).toBe(110); // (0,40)→y=110
    // home 回到原点，且 heading 归 0（朝右）
    const b = runTurtle(`pd fd 30 home fd 40`, { startX: 200, startY: 150 });
    expect(b.length).toBeGreaterThanOrEqual(1);
    const last = b[b.length - 1].points;
    expect(last[last.length - 2]).toBe(240); // home 后朝右 fd40 → 逻辑(40,0)
  });

  it('pen state: pu moves without drawing, pd draws', () => {
    const up = runTurtle(`pu fd 100`, C);
    expect(up.length).toBe(0);
    const down = runTurtle(`pd fd 100`, C);
    expect(down.length).toBe(1);
  });

  it('circle with pen up moves only (standard turtle)', () => {
    const items = runTurtle(`pu circle 40`, C);
    expect(items.length).toBe(0);
    const drawn = runTurtle(`pd circle 40, 90`, C);
    expect(drawn.length).toBe(1);
  });

  it('begin_fill/end_fill emits a filled polygon', () => {
    const items = runTurtle(`pd begin_fill rect 40, 30 end_fill`, C);
    const poly = items.find((i) => 'fill' in i && i.fill);
    expect(poly).toBeTruthy();
    if (poly && 'fill' in poly) expect(poly.fill).toBe('#000000');
  });

  it('clear does not move the pen or reset heading', () => {
    // clear 后位置与朝向保持不变：fd30 停在(30,0)，clear 不动画笔，再 fd20 从原位朝右画
    const items = runTurtle(`pd fd 30 clear fd 20`, C);
    const strokes = items.filter((i) => !('type' in i && i.type === 'clear'));
    expect(strokes.length).toBe(1); // 只有 clear 后的 fd20 一段
    const s = strokes[0].points;
    expect(Math.round(s[0])).toBe(230); // 起点 (30,0) → 屏幕(230,150)
    expect(Math.round(s[s.length - 2])).toBe(250); // 终点 (50,0) → 屏幕(250,150)
  });

  it('dot fills with the given color', () => {
    const items = runTurtle(`dot 20, red`, C);
    const d = items[0];
    expect('fill' in d && d.fill).toBe('#e74c3c');
  });

  });

// ── Python turtle 语法子集：transpiler 翻译 + 执行 ──
describe('python turtle syntax subset', () => {
  const C = { startX: 200, startY: 150 };

  it('detects python-style scripts', () => {
    expect(isPythonStyle('import turtle\nt = turtle.Turtle()\nfor i in range(4):\n    t.forward(100)')).toBe(true);
    expect(isPythonStyle('for i in range(4):\n    fd 100')).toBe(true);
    expect(isPythonStyle('t.forward(100)')).toBe(true);
    // 现有 DSL 不应被误判
    expect(isPythonStyle('pd\nrepeat 4 { fd 50 rt 90 }')).toBe(false);
  });

  it('translates import/turtle instantiation away and defaults pen down', () => {
    const out = pythonToTurtle(`import turtle
t = turtle.Turtle()
for i in range(4):
    t.forward(100)
    t.left(90)`);
    expect(out.startsWith('pd')).toBe(true);
    expect(out).not.toContain('import');
    expect(out).not.toContain('Turtle');
    expect(out).toContain('while (i < 4)');
    expect(out).toContain('fd 100');
  });

  it('draws a square with import + dot-method + for-in-range + indentation', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
t.speed(0)
for i in range(4):
    t.forward(100)
    t.right(90)
t.hideturtle()`,
      C,
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    // 闭合：首尾同点（从原点出发画正方形）
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
    expect(Math.round(p[p.length - 2])).toBe(200);
    expect(Math.round(p[p.length - 1])).toBe(150);
  });

  it('maps top-level and dot-method calls, strips quotes, keeps hex color', () => {
    const out = pythonToTurtle(`t.color("red", "#ff8800")
t.begin_fill()
for i in range(5):
    t.forward(60)
    t.left(144)
t.end_fill()`);
    expect(out).toContain('color red, #ff8800');
    expect(out).not.toContain('"');
    const items = runTurtle(out, C);
    expect(items.some((i) => 'fill' in i && i.fill === '#ff8800')).toBe(true);
  });

  it('supports while, variables and negative coords in python style', () => {
    const items = runTurtle(
      `t = turtle.Turtle()
t.goto(-100, -50)
t.circle(40, 180)
t.penup()
t.forward(20)`,
      C,
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    const p = items[0].points;
    // pythonToTurtle 强制开头 pd，goto 从原点(0,0)画到(-100,-50)，
    // 笔画终点 → 画布(100,200)
    expect(Math.round(p[p.length - 2])).toBe(100);
    expect(Math.round(p[p.length - 1])).toBe(200);
  });

  it('translates def and if/else chains', () => {
    const out = pythonToTurtle(
      `def square(size):
    for i in range(4):
        t.forward(size)
        t.right(90)
t.penup()
t.goto(0, 0)
t.pendown()
if size > 10:
    square(30)
else:
    square(10)`,
    );
    expect(out).toContain('to square(size)');
    expect(out).toContain('} else {');
  });

  it('range with start/step maps to while loop bounds', () => {
    const out = pythonToTurtle(`for i in range(1, 5):
    t.forward(i)`);
    expect(out).toContain('i = 1');
    expect(out).toContain('while (i < 5)');
    expect(out).toContain('i = i + 1');
  });

  it('ignores no-op methods like speed and hideturtle', () => {
    const out = pythonToTurtle(`t.speed(0)
t.hideturtle()
t.forward(50)`);
    expect(out).not.toContain('speed');
    expect(out).not.toContain('hideturtle');
    expect(out).toContain('fd 50');
  });

  it('normalizes python logical operators and booleans', () => {
    // and/or/not/True/False 归一化为 DSL 语法 && || ! true false
    const out = pythonToTurtle(`t = turtle.Turtle()
if i > 0 and i < 10:
    t.forward(10)
elif i < 0 or j > 0:
    t.forward(20)
while True:
    break
while not running:
    t.forward(5)`);
    expect(out).toContain('if (i > 0 && i < 10)');
    expect(out).toContain('else if (i < 0 || j > 0)');
    expect(out).toContain('while (true)');
    expect(out).toContain('while (! running)');
  });

  it('executes python-style break/continue in loops', () => {
    // break 提前退出：for 到 i=3 停止，共画 3 段
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
for i in range(10):
    if i == 3:
        break
    t.forward(10)`,
      C,
    );
    expect(items.length).toBe(1);
    const p = items[0].points;
    // 画布起点 (200,150)，前进 3*10=30 → 终点 x=230
    expect(Math.round(p[p.length - 2])).toBe(230);
  });

  it('continue skips to next iteration', () => {
    // continue 跳过 i==2 之后的前进，但仍转向：画 4 条边（0,1,3,4）
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
for i in range(5):
    if i == 2:
        continue
    t.forward(10)
    t.right(90)`,
      C,
    );
    // 4 段前进 + 4 次转向，闭合于起点
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
  });

  it('ignores Screen() instantiation and bgcolor', () => {
    const out = pythonToTurtle(`import turtle
window = turtle.Screen()
window.bgcolor("lightblue")
pen = turtle.Turtle()
pen.goto(-100, -100)`);
    expect(out).not.toContain('Screen');
    expect(out).not.toContain('bgcolor');
    expect(out).toContain('goto -100, -100');
    // Screen 实例化被忽略，不会产生 window = Screen() 赋值
    expect(out).not.toContain('window');
  });

  it('resolves extended CSS color names like skyblue/lightblue', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
t.color("black", "skyblue")
t.begin_fill()
for _ in range(4):
    t.forward(40)
    t.left(90)
t.end_fill()
t.color("gold")
t.dot(10)`,
      C,
    );
    const fills = items.filter((i) => 'fill' in i && i.fill);
    // skyblue → #87ceeb，gold dot 填充 → #ffd700
    expect(fills.some((f) => f.fill === '#87ceeb')).toBe(true);
    expect(fills.some((f) => f.fill === '#ffd700')).toBe(true);
  });

  it('draws a complete house with screens, fills and multiple shapes', () => {
    // 端到端：验证典型 agent 生成的"小房子"脚本能正确产出所有填充与描边
    const items = runTurtle(
      `import turtle
window = turtle.Screen()
window.bgcolor("lightblue")
pen = turtle.Turtle()
pen.speed(5)
pen.penup()
pen.goto(-100, -100)
pen.pendown()
pen.color("black", "yellow")
pen.begin_fill()
for _ in range(4):
    pen.forward(200)
    pen.left(90)
pen.end_fill()
pen.penup()
pen.goto(-120, 100)
pen.pendown()
pen.color("black", "red")
pen.begin_fill()
pen.goto(0, 200)
pen.goto(120, 100)
pen.goto(-120, 100)
pen.end_fill()
pen.penup()
pen.goto(0, -70)
pen.pendown()
pen.color("gold")
pen.dot(10)
pen.penup()
pen.goto(-70, 0)
pen.pendown()
pen.color("black", "skyblue")
pen.begin_fill()
for _ in range(4):
    pen.forward(40)
    pen.left(90)
pen.end_fill()
pen.hideturtle()
window.mainloop()`,
      C,
    );
    const fills = items.filter((i) => 'fill' in i && i.fill);
    // 房子主体(黄)、屋顶(红)、门把手点(gold)、窗户(skyblue)
    expect(fills.some((f) => f.fill === '#f1c40f')).toBe(true);
    expect(fills.some((f) => f.fill === '#e74c3c')).toBe(true);
    expect(fills.some((f) => f.fill === '#ffd700')).toBe(true);
    expect(fills.some((f) => f.fill === '#87ceeb')).toBe(true);
  });

  it('maps position aliases setpos/setposition and home', () => {
    const out = pythonToTurtle(`t = turtle.Turtle()
t.setpos(100, -50)
t.setposition(-100, 50)
t.home()`);
    expect(out).toContain('goto 100, -50');
    expect(out).toContain('goto -100, 50');
    expect(out).toContain('home');
  });

  it('maps pen aliases up/down, width/pensize, seth/setheading', () => {
    const out = pythonToTurtle(`t = turtle.Turtle()
t.up()
t.goto(10, 10)
t.down()
t.pensize(4)
t.seth(90)
t.setheading(180)`);
    expect(out).toContain('pu');
    expect(out).toContain('pd');
    expect(out).toContain('width 4');
    // seth 与 setheading 都映射到 setheading
    expect(out).toContain('setheading 90');
    expect(out).toContain('setheading 180');
  });

  it('maps movement aliases back/bk and turn lt/rt', () => {
    const out = pythonToTurtle(`t = turtle.Turtle()
t.back(30)
t.bk(10)
t.lt(45)
t.rt(15)`);
    expect(out).toContain('bk 30');
    expect(out).toContain('bk 10');
    expect(out).toContain('lt 45');
    expect(out).toContain('rt 15');
  });

  it('maps pencolor/fillcolor/color separately and dot with color arg', () => {
    const out = pythonToTurtle(`t = turtle.Turtle()
t.pencolor('red')
t.fillcolor('blue')
t.color('green')
t.dot(10, 'gold')
t.dot(5)`);
    expect(out).toContain('pencolor red');
    expect(out).toContain('fillcolor blue');
    expect(out).toContain('color green');
    expect(out).toContain('dot 10, gold');
    expect(out).toContain('dot 5');
  });

  it('maps circle with extent and steps', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
t.circle(50, 180, 8)`,
      C,
    );
    // 半圆 180°，8 步 → 仍是多点笔画
    expect(items.length).toBe(1);
    expect(items[0].points.length).toBeGreaterThan(4);
  });

  it('ignores state queries and animation/event methods', () => {
    const out = pythonToTurtle(`t = turtle.Turtle()
t.pos()
t.xcor()
t.ycor()
t.heading()
t.isdown()
t.stamp()
t.write('hi')
t.undo()
t.shape('turtle')
t.tracer(0)
t.update()
t.setup(800, 600)
t.forward(50)`);
    // 所有查询/动画/事件行被忽略，只剩 forward
    expect(out).toContain('fd 50');
    expect(out.split('\n').length).toBeLessThanOrEqual(3);
    expect(out).not.toContain('pos');
    expect(out).not.toContain('stamp');
    expect(out).not.toContain('setup');
  });

  it('supports module-level turtle function calls', () => {
    const out = pythonToTurtle(`import turtle
t = turtle.Turtle()
turtle.penup()
turtle.goto(0, 0)
turtle.pendown()
turtle.forward(60)`);
    expect(out).toContain('pu');
    expect(out).toContain('goto 0, 0');
    expect(out).toContain('pd');
    expect(out).toContain('fd 60');
  });

  it('supports nested functions and recursion in python style', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
def draw(n):
    if n == 0:
        return
    t.forward(30)
    t.right(60)
    draw(n - 1)
draw(6)`,
      C,
    );
    expect(items.length).toBe(1);
    // 6 段前进，正六边形闭合于起点
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
    expect(Math.round(p[p.length - 2])).toBe(200);
    expect(Math.round(p[p.length - 1])).toBe(150);
  });

  it('supports multiple variables including underscore loop var', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
size = 40
for _ in range(3):
    t.forward(size)
    t.left(120)`,
      C,
    );
    // 3 段构成三角形，闭合于起点
    expect(items.length).toBe(1);
    const p = items[0].points;
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
    expect(Math.round(p[p.length - 2])).toBe(200);
    expect(Math.round(p[p.length - 1])).toBe(150);
  });

  it('supports while loop and boolean conditions in python style', () => {
    const items = runTurtle(
      `import turtle
t = turtle.Turtle()
i = 0
while i < 4:
    t.forward(20)
    i = i + 1
    if i == 2:
        t.color('red')`,
      C,
    );
    expect(items.length).toBe(1);
    // 4 段直线，其中一段中途换色
    const s = items[0];
    expect(s.colors.length).toBeGreaterThan(1);
    expect(s.colors.includes('#e74c3c')).toBe(true);
  });
});
