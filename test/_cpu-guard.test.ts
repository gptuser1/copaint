// 正式守卫测试：验证爆炸场景 CPU 受控 + 正常创意画完整渲染（maxOps=16000 校准值）
import { describe, it, expect } from 'vitest';
import { runTurtle } from '../src/infrastructure/turtle';

const MAX_MS = 10;

function bench(script: string, maxOps = 16000, maxMs = 7, rounds = 5): { med: number; items: ReturnType<typeof runTurtle> } {
  const runs: Array<{ time: number; items: ReturnType<typeof runTurtle> }> = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    const items = runTurtle(script, { startX: 300, startY: 200, maxOps, maxMs });
    runs.push({ time: performance.now() - t0, items });
  }
  runs.sort((a, b) => a.time - b.time);
  const med = runs[Math.floor(runs.length / 2)];
  return { med: med.time, items: med.items };
}

function totalPts(items: ReturnType<typeof runTurtle>): number {
  return items.reduce((s, it) => s + ('points' in it ? it.points.length : 0), 0);
}

describe('turtle cpu guard (maxOps=16000)', () => {
  it('all explosion scenarios stay under 10ms', () => {
    const cases: Array<[string, string]> = [
      ['circle x2000', 'pd\nrepeat 2000 { circle 5 }'],
      ['nested circle 400x10', 'pd\nfor (i=0;i<400;i=i+1){ repeat 10 { circle 3 } }'],
      ['giant steps circle', 'pd\ncircle 5, 360, 100000'],
      ['dot x8000', 'repeat 8000 { dot 2 }'],
      ['fill 2000 moves', 'pd\nbegin_fill\nfor (i=0;i<2000;i=i+1){ fd 1 rt 1 }\nend_fill'],
      ['fib(25) recursion', 'to f(n) { if n <= 1 { return n } return f(n-1) + f(n-2) }\nf(25)'],
      ['infinite recursion', 'to loop(n) { loop(n) }\nloop(1)'],
      ['deep recursion 1000', 'to loop(n) { if n > 0 { loop(n - 1) } }\nloop(1000)'],
      ['while infinite', 'x=0\nwhile x < 1000000000 { x = x + 1 }'],
      ['triple nested dot', 'pd\nfor (i=0;i<30;i=i+1){ for (j=0;j<30;j=j+1){ for (k=0;k<30;k=k+1){ dot 2 } } }'],
      ['call chain in loop', 'to a(n) { b(n) }\nto b(n) { c(n) }\nto c(n) { dot 5 }\nrepeat 5000 { a(1) }'],
      ['multi-explode mix', 'pd\nrepeat 500 { circle 3 dot 2 fd 1 rt 1 }'],
    ];
    for (const [name, script] of cases) {
      const { med, items } = bench(script);
      const pts = totalPts(items);
      // eslint-disable-next-line no-console
      console.log(`${name}: ${med.toFixed(2)}ms items=${items.length} pts=${pts}`);
      expect(med).toBeLessThan(MAX_MS);
    }
  });

  it('creative scripts complete fully at maxOps=16000', () => {
    const cases: Array<[string, string]> = [
      // 基础创意
      ['房子+太阳', 'pd\nrepeat 4 { fd 80 lt 90 }\nlt 30\nrepeat 3 { fd 80 rt 120 }\npu\nlt 60 fd 120\npd\ncircle 20\npu\nrt 90 fd 60\npd\nrepeat 30 { fd 2 rt 12 }'],
      ['花田x12', 'pd\nto flower() { repeat 6 { circle 10 60 rt 60 } dot 6 }\nrepeat 12 { flower() pu lt 90 fd 40 rt 90 pd }'],
      ['城市天际线', 'pd\nrepeat 4 { fd 60 lt 90 }\npu rt 90 fd 90 lt 90 pd\nrepeat 4 { fd 90 lt 90 }\npu rt 90 fd 80 lt 90 pd\nrepeat 4 { fd 50 lt 90 }\npu lt 90 fd 25 lt 90 fd 120 pd\nrepeat 3 { dot 4 pu fd 20 pd }\npu lt 90 fd 20 lt 90 fd 120 pd\nrepeat 3 { dot 4 pu fd 20 pd }\npu lt 90 fd 40 lt 90 fd 30 pd\ncircle 18\npu lt 90 fd 120 rt 90 pd\nrepeat 5 { dot 3 pu lt 30 fd 40 rt 30 pd }'],
      ['森林', 'pd\nfd 60 bk 60\nlt 30\ncircle 20\nlt 90\ncircle 18\nlt 90\ncircle 15\npu lt 90 fd 80 rt 90 pd\nfd 70 bk 70\nlt 30\ncircle 22\nlt 90\ncircle 20\nlt 90\ncircle 17\npu lt 90 fd 40 lt 90 fd 140 rt 90 pd\ncircle 16\npu lt 90 fd 30 lt 90 fd 60 rt 90 pd\nrepeat 4 { circle 8 90 pu lt 90 fd 60 rt 90 pd }'],
      ['spiral+flowers', 'pd\nrepeat 360 { fd 1 rt 1 }\nrepeat 6 { circle 20 }'],
      // Python 风格真实创意场景（覆盖递归分形 / 密集重复 / 几何拼贴）
      ['花园+蝴蝶', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\ncolors = ["red", "orange", "yellow", "pink", "purple"]\ndef flower(x, y, c):\n    t.penup()\n    t.goto(x, y)\n    t.pendown()\n    for i in range(8):\n        t.color(c)\n        t.begin_fill()\n        t.circle(10)\n        t.end_fill()\n        t.left(45)\n    t.color("gold")\n    t.dot(8)\nflower(-120, -30, colors[0])\nflower(-60, 20, colors[1])\nflower(0, -40, colors[2])\nflower(60, 15, colors[3])\nflower(120, -25, colors[4])\nt.penup()\nt.goto(-140, 90)\nt.color("gold")\nt.begin_fill()\nt.circle(18)\nt.end_fill()\nt.penup()\nt.goto(150, 50)\nt.color("orange")\nt.pendown()\nt.left(30)\nfor i in range(2):\n    t.circle(10, 90)\n    t.left(90)\nfor i in range(2):\n    t.circle(10, 90)\n    t.left(90)\nt.penup()\nt.goto(150, 45)\nt.pendown()\nt.left(90)\nfor i in range(2):\n    t.circle(10, 90)\n    t.left(90)'],
      // 密集花园：24 朵花 ≈14770 op，是 16000 定值的依据
      ['花园x24', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\ncolors = ["red", "orange", "yellow", "pink", "purple", "blue"]\ndef flower(x, y, c, s):\n    t.penup()\n    t.goto(x, y)\n    t.pendown()\n    for i in range(6):\n        t.color(c)\n        t.begin_fill()\n        t.circle(s)\n        t.end_fill()\n        t.left(60)\n    t.color("gold")\n    t.dot(6)\nfor r in range(4):\n    for k in range(6):\n        flower(k * 60 - 150, 100 - r * 50, colors[(r + k) % 6], 12)\nt.hideturtle()\nturtle.done()'],
      ['分形树 d8', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ndef branch(n):\n    if n == 0:\n        t.forward(8)\n    else:\n        t.forward(16)\n        t.left(30)\n        branch(n - 1)\n        t.right(60)\n        branch(n - 1)\n        t.left(30)\n        t.backward(16)\nbranch(8)\nt.hideturtle()\nturtle.done()'],
      ['分形树 d9', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ndef branch(n):\n    if n == 0:\n        t.forward(4)\n    else:\n        t.forward(8)\n        t.left(30)\n        branch(n - 1)\n        t.right(60)\n        branch(n - 1)\n        t.left(30)\n        t.backward(8)\nbranch(9)\nt.hideturtle()\nturtle.done()'],
      ['科赫雪花', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ndef koch(n, size):\n    if n == 0:\n        t.forward(size)\n    else:\n        koch(n - 1, size / 3)\n        t.left(60)\n        koch(n - 1, size / 3)\n        t.right(120)\n        koch(n - 1, size / 3)\n        t.left(60)\n        koch(n - 1, size / 3)\nt.penup()\nt.goto(-120, 80)\nt.pendown()\nfor i in range(3):\n    koch(3, 240)\n    t.right(120)\nt.hideturtle()\nturtle.done()'],
      ['谢尔宾斯基', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ndef sierp(n, size):\n    if n == 0:\n        for i in range(3):\n            t.forward(size)\n            t.left(120)\n    else:\n        sierp(n - 1, size / 2)\n        t.forward(size / 2)\n        sierp(n - 1, size / 2)\n        t.backward(size / 2)\n        t.left(60)\n        t.forward(size / 2)\n        t.right(60)\n        sierp(n - 1, size / 2)\n        t.left(60)\n        t.backward(size / 2)\n        t.right(60)\nsierp(4, 320)\nt.hideturtle()\nturtle.done()'],
      ['星空 x160', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.penup()\ncolors = ["white", "yellow", "lightblue", "pink", "orange"]\nfor i in range(160):\n    t.goto(i * 3 - 240, (i * 37 % 70) - 60)\n    t.color(colors[i % 5])\n    t.dot(3)\nt.hideturtle()\nturtle.done()'],
      ['烟花 x6', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ndef burst(x, y, c):\n    t.penup()\n    t.goto(x, y)\n    t.pendown()\n    t.color(c)\n    for i in range(12):\n        t.forward(40)\n        t.backward(40)\n        t.right(30)\nburst(-100, 50, "red")\nburst(0, 80, "gold")\nburst(100, 30, "blue")\nburst(-50, -60, "purple")\nburst(60, -70, "orange")\nburst(120, -20, "pink")\nt.hideturtle()\nturtle.done()'],
      ['圣诞树', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.penup()\nt.goto(0, -140)\nt.pendown()\nt.color("brown")\nfor i in range(4):\n    t.forward(30)\n    t.left(90)\nt.color("green")\nt.penup()\nt.goto(-70, -130)\nt.pendown()\nfor level in range(3):\n    for i in range(3):\n        t.forward(140)\n        t.left(120)\n    t.penup()\n    t.goto(-50 + level * 10, -130 + (level + 1) * 45)\n    t.pendown()\nt.color("gold")\nfor i in range(8):\n    t.penup()\n    t.goto(-60 + i * 17, 40)\n    t.pendown()\n    t.dot(5)\nt.color("red")\nt.penup()\nt.goto(0, 70)\nt.pendown()\nt.begin_fill()\nfor i in range(5):\n    t.forward(20)\n    t.right(144)\nt.end_fill()\nt.hideturtle()\nturtle.done()'],
      ['向日葵', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.penup()\nt.goto(0, -60)\nt.pendown()\ncolors = ["yellow", "orange", "gold"]\nfor i in range(24):\n    t.color(colors[i % 3])\n    t.begin_fill()\n    t.circle(25)\n    t.end_fill()\n    t.left(15)\nt.color("brown")\nt.dot(30)\nt.hideturtle()\nturtle.done()'],
      ['曼陀罗 x40', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.penup()\nt.goto(0, 0)\nt.pendown()\ncolors = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "cyan"]\nfor i in range(40):\n    t.color(colors[i % 8])\n    t.circle(60, 120)\n    t.left(120)\nt.hideturtle()\nturtle.done()'],
      ['彩虹 x7', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ncolors = ["red", "orange", "yellow", "green", "blue", "indigo", "violet"]\nt.penup()\nt.goto(-120, -60)\nt.pendown()\nfor i in range(7):\n    t.color(colors[i])\n    t.penup()\n    t.goto(-120, -60 + i * 8)\n    t.pendown()\n    t.circle(120, 180)\nt.hideturtle()\nturtle.done()'],
      ['方格拼贴 x64', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ncolors = ["red", "blue", "green", "yellow"]\nfor row in range(8):\n    for col in range(8):\n        t.penup()\n        t.goto(-140 + col * 40, 120 - row * 40)\n        t.pendown()\n        t.color(colors[(row + col) % 4])\n        t.begin_fill()\n        for i in range(4):\n            t.forward(30)\n            t.left(90)\n        t.end_fill()\nt.hideturtle()\nturtle.done()'],
      ['六边形墙 x23', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\ncolors = ["red", "orange", "yellow", "green", "blue", "purple"]\ndef hexa(x, y, c):\n    t.penup()\n    t.goto(x, y)\n    t.pendown()\n    t.color(c)\n    t.begin_fill()\n    for i in range(6):\n        t.forward(24)\n        t.left(60)\n    t.end_fill()\nhexa(-120, 100, colors[0])\nhexa(-60, 100, colors[1])\nhexa(0, 100, colors[2])\nhexa(60, 100, colors[3])\nhexa(120, 100, colors[4])\nhexa(-90, 55, colors[5])\nhexa(-30, 55, colors[0])\nhexa(30, 55, colors[1])\nhexa(90, 55, colors[2])\nhexa(-120, 10, colors[3])\nhexa(-60, 10, colors[4])\nhexa(0, 10, colors[5])\nhexa(60, 10, colors[0])\nhexa(120, 10, colors[1])\nhexa(-90, -35, colors[2])\nhexa(-30, -35, colors[3])\nhexa(30, -35, colors[4])\nhexa(90, -35, colors[5])\nhexa(-120, -80, colors[0])\nhexa(-60, -80, colors[1])\nhexa(0, -80, colors[2])\nhexa(60, -80, colors[3])\nhexa(120, -80, colors[4])\nt.hideturtle()\nturtle.done()'],
      ['大螺旋 + 点', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.penup()\nt.goto(0, 0)\nt.pendown()\nfor i in range(90):\n    t.forward(i * 2)\n    t.left(30)\n    t.dot(3)\nt.hideturtle()\nturtle.done()'],
      // 更复杂的常见创意画（真实场景，非抽象几何）
      ['海边日落', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.penup()\nt.goto(0, 60)\nt.pendown()\nt.color("red")\nt.begin_fill()\nt.circle(25)\nt.end_fill()\nt.color("darkblue")\nt.penup()\nt.goto(-200, -20)\nt.pendown()\nt.begin_fill()\nt.goto(-200, 0)\nt.goto(200, 0)\nt.goto(200, -20)\nt.goto(-200, -20)\nt.end_fill()\nt.color("cyan")\nt.width(2)\nfor i in range(6):\n    t.penup()\n    t.goto(-170, -35 - i * 10)\n    t.pendown()\n    t.circle(15, 180)\n    t.left(180)\nt.color("black")\nt.width(2)\nt.penup()\nt.goto(-120, 70)\nt.pendown()\nt.left(60)\nt.forward(12)\nt.right(120)\nt.forward(12)\nt.penup()\nt.goto(-70, 90)\nt.pendown()\nt.left(120)\nt.forward(12)\nt.right(120)\nt.forward(12)\nt.hideturtle()\nturtle.done()'],
      ['生日蛋糕', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("pink")\nt.penup()\nt.goto(-70, -100)\nt.pendown()\nt.begin_fill()\nfor i in range(2):\n    t.forward(140)\n    t.left(90)\n    t.forward(60)\n    t.left(90)\nt.end_fill()\nt.color("skyblue")\nt.penup()\nt.goto(-45, -40)\nt.pendown()\nt.begin_fill()\nfor i in range(2):\n    t.forward(90)\n    t.left(90)\n    t.forward(50)\n    t.left(90)\nt.end_fill()\nt.color("white")\nt.penup()\nt.goto(-70, -40)\nt.pendown()\nfor i in range(7):\n    t.circle(10, 180)\n    t.left(180)\n    t.forward(20)\nt.color("red")\nt.penup()\nt.goto(-70, -60)\nt.pendown()\nfor i in range(7):\n    t.circle(8)\nt.penup()\n    t.goto(-60 + i * 20, -65)\nt.pendown()\nt.color("brown")\nt.penup()\nt.goto(-25, 10)\nt.pendown()\nt.forward(25)\nt.penup()\nt.goto(0, 10)\nt.pendown()\nt.forward(25)\nt.penup()\nt.goto(25, 10)\nt.pendown()\nt.forward(25)\nt.color("yellow")\nfor i in range(3):\n    t.penup()\n    t.goto(-25 + i * 25, 35)\n    t.pendown()\n    t.begin_fill()\n    t.circle(5)\n    t.end_fill()\nt.hideturtle()\nturtle.done()'],
      ['小汽车', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("red")\nt.penup()\nt.goto(-80, -20)\nt.pendown()\nt.begin_fill()\nt.goto(80, -20)\nt.goto(80, 10)\nt.goto(30, 10)\nt.goto(10, 40)\nt.goto(-40, 40)\nt.goto(-80, 10)\nt.goto(-80, -20)\nt.end_fill()\nt.color("skyblue")\nt.penup()\nt.goto(-30, 15)\nt.pendown()\nt.begin_fill()\nt.goto(0, 15)\nt.goto(0, 35)\nt.goto(-30, 35)\nt.goto(-30, 15)\nt.end_fill()\nt.penup()\nt.goto(10, 15)\nt.pendown()\nt.begin_fill()\nt.goto(30, 15)\nt.goto(30, 35)\nt.goto(10, 35)\nt.goto(10, 15)\nt.end_fill()\nt.color("black")\nfor i in range(2):\n    t.penup()\n    t.goto(-50 + i * 100, -40)\n    t.pendown()\n    t.begin_fill()\n    t.circle(12)\n    t.end_fill()\nt.color("gray")\nfor i in range(2):\n    t.penup()\n    t.goto(-50 + i * 100, -40)\n    t.pendown()\n    t.begin_fill()\n    t.circle(5)\n    t.end_fill()\nt.color("black")\nt.penup()\nt.goto(-80, -20)\nt.pendown()\nt.width(3)\nt.goto(-80, -20)\nt.hideturtle()\nturtle.done()'],
      ['小猫', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("orange")\nt.penup()\nt.goto(-40, -80)\nt.pendown()\nt.begin_fill()\nt.circle(40)\nt.end_fill()\nt.penup()\nt.goto(-15, 40)\nt.pendown()\nt.begin_fill()\nt.circle(25)\nt.end_fill()\nt.penup()\nt.goto(-35, 60)\nt.pendown()\nt.begin_fill()\nt.goto(-40, 85)\nt.goto(-15, 68)\nt.goto(-35, 60)\nt.end_fill()\nt.penup()\nt.goto(5, 60)\nt.pendown()\nt.begin_fill()\nt.goto(10, 85)\nt.goto(-10, 68)\nt.goto(5, 60)\nt.end_fill()\nt.color("black")\nt.penup()\nt.goto(-8, 50)\nt.pendown()\nt.dot(4)\nt.penup()\nt.goto(12, 50)\nt.pendown()\nt.dot(4)\nt.penup()\nt.goto(-25, 40)\nt.pendown()\nt.goto(-50, 35)\nt.penup()\nt.goto(-25, 30)\nt.pendown()\nt.goto(-50, 30)\nt.penup()\nt.goto(15, 40)\nt.pendown()\nt.goto(40, 35)\nt.penup()\nt.goto(15, 30)\nt.pendown()\nt.goto(40, 30)\nt.hideturtle()\nturtle.done()'],
      ['雪人', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("white")\nt.penup()\nt.goto(0, -120)\nt.pendown()\nt.begin_fill()\nt.circle(50)\nt.end_fill()\nt.penup()\nt.goto(0, -20)\nt.pendown()\nt.begin_fill()\nt.circle(35)\nt.end_fill()\nt.penup()\nt.goto(0, 50)\nt.pendown()\nt.begin_fill()\nt.circle(25)\nt.end_fill()\nt.color("black")\nt.penup()\nt.goto(-10, 65)\nt.pendown()\nt.dot(4)\nt.penup()\nt.goto(10, 65)\nt.pendown()\nt.dot(4)\nt.color("orange")\nt.penup()\nt.goto(0, 55)\nt.pendown()\nt.width(3)\nt.goto(20, 50)\nt.color("red")\nt.penup()\nt.goto(-20, 35)\nt.pendown()\nt.width(4)\nt.goto(20, 35)\nt.penup()\nt.goto(-15, 32)\nt.pendown()\nt.goto(-5, 10)\nt.color("brown")\nt.penup()\nt.goto(-15, -60)\nt.pendown()\nt.width(3)\nt.goto(-15, -20)\nt.penup()\nt.goto(15, -60)\nt.pendown()\nt.goto(15, -20)\nt.hideturtle()\nturtle.done()'],
      ['火箭', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("silver")\nt.penup()\nt.goto(-20, -100)\nt.pendown()\nt.begin_fill()\nt.goto(-20, 80)\nt.goto(20, 80)\nt.goto(20, -100)\nt.goto(-20, -100)\nt.end_fill()\nt.color("red")\nt.penup()\nt.goto(-20, 80)\nt.pendown()\nt.begin_fill()\nt.goto(0, 130)\nt.goto(20, 80)\nt.goto(-20, 80)\nt.end_fill()\nt.color("skyblue")\nt.penup()\nt.goto(0, 30)\nt.pendown()\nt.begin_fill()\nt.circle(12)\nt.end_fill()\nt.color("red")\nt.penup()\nt.goto(-20, -60)\nt.pendown()\nt.begin_fill()\nt.goto(-50, -100)\nt.goto(-20, -80)\nt.goto(-20, -60)\nt.end_fill()\nt.penup()\nt.goto(20, -60)\nt.pendown()\nt.begin_fill()\nt.goto(50, -100)\nt.goto(20, -80)\nt.goto(20, -60)\nt.end_fill()\nt.color("orange")\nt.penup()\nt.goto(-20, -100)\nt.pendown()\nt.begin_fill()\nt.goto(0, -140)\nt.goto(20, -100)\nt.goto(-20, -100)\nt.end_fill()\nt.color("yellow")\nt.penup()\nt.goto(-10, -100)\nt.pendown()\nt.begin_fill()\nt.goto(0, -125)\nt.goto(10, -100)\nt.goto(-10, -100)\nt.end_fill()\nt.color("gold")\nfor i in range(8):\n    t.penup()\n    t.goto(-160 + i * 45, 120)\n    t.pendown()\n    t.dot(3)\nt.hideturtle()\nturtle.done()'],
      ['带院子的房子', 'import turtle\nt = turtle.Turtle()\nt.speed(0)\nt.hideturtle()\nt.color("lightgreen")\nt.penup()\nt.goto(-200, -150)\nt.pendown()\nt.begin_fill()\nt.goto(-200, -60)\nt.goto(200, -60)\nt.goto(200, -150)\nt.goto(-200, -150)\nt.end_fill()\nt.color("tan")\nt.penup()\nt.goto(-70, -60)\nt.pendown()\nt.begin_fill()\nt.goto(-70, 20)\nt.goto(70, 20)\nt.goto(70, -60)\nt.goto(-70, -60)\nt.end_fill()\nt.color("red")\nt.penup()\nt.goto(-85, 20)\nt.pendown()\nt.begin_fill()\nt.goto(0, 70)\nt.goto(85, 20)\nt.goto(-85, 20)\nt.end_fill()\nt.color("brown")\nt.penup()\nt.goto(-15, -60)\nt.pendown()\nt.begin_fill()\nt.goto(-15, -10)\nt.goto(15, -10)\nt.goto(15, -60)\nt.goto(-15, -60)\nt.end_fill()\nt.color("skyblue")\nfor i in range(2):\n    t.penup()\n    t.goto(-55 + i * 100, -5)\n    t.pendown()\n    t.begin_fill()\n    t.goto(-55 + i * 100, 10)\n    t.goto(-35 + i * 100, 10)\n    t.goto(-35 + i * 100, -5)\n    t.goto(-55 + i * 100, -5)\n    t.end_fill()\nt.color("gray")\nt.penup()\nt.goto(40, 20)\nt.pendown()\nt.begin_fill()\nt.goto(40, 50)\nt.goto(55, 50)\nt.goto(55, 20)\nt.goto(40, 20)\nt.end_fill()\nfor i in range(3):\n    t.penup()\n    t.goto(48, 55 + i * 12)\n    t.pendown()\n    t.circle(5)\nt.color("brown")\nt.penup()\nt.goto(130, -60)\nt.pendown()\nt.begin_fill()\nt.goto(130, 0)\nt.goto(145, 0)\nt.goto(145, -60)\nt.goto(130, -60)\nt.end_fill()\nt.color("green")\nt.penup()\nt.goto(110, 0)\nt.pendown()\nt.begin_fill()\nt.circle(30)\nt.end_fill()\nt.penup()\nt.goto(158, 5)\nt.pendown()\nt.begin_fill()\nt.circle(25)\nt.end_fill()\nt.color("tan")\nt.width(3)\nfor i in range(5):\n    t.penup()\n    t.goto(-160 + i * 30, -60)\n    t.pendown()\n    t.goto(-160 + i * 30, -20)\nt.color("yellow")\nt.penup()\nt.goto(160, 100)\nt.pendown()\nt.begin_fill()\nt.circle(18)\nt.end_fill()\nt.color("white")\nt.penup()\nt.goto(-140, 110)\nt.pendown()\nt.circle(10)\nt.circle(14)\nt.penup()\nt.goto(-60, 130)\nt.pendown()\nt.circle(10)\nt.circle(14)\nt.hideturtle()\nturtle.done()'],
    ];
    for (const [name, script] of cases) {
      // 完整性：验证 maxOps=16000 足够画完整张图（墙钟给宽松上限，排除并行测试机负载噪声）
      const full = totalPts(runTurtle(script, { startX: 300, startY: 200, maxOps: 500000, maxMs: 1000 }));
      const at16k = totalPts(runTurtle(script, { startX: 300, startY: 200, maxOps: 16000, maxMs: 100 }));
      const complete = at16k >= full;
      // 耗时：真实守卫（7ms）下中位数必须在 CF 10ms 限制内
      const { med } = bench(script);
      // eslint-disable-next-line no-console
      console.log(`${name}: ${med.toFixed(2)}ms pts=${at16k}/${full} ${complete ? 'COMPLETE' : 'TRUNCATED'}`);
      expect(complete).toBe(true);
      expect(med).toBeLessThan(MAX_MS);
    }
  });

  it('bounded point output for explosion scenarios', () => {
    const { items } = bench('pd\nrepeat 2000 { circle 5 }');
    const pts = totalPts(items);
    // maxOps=16000：circle 每点计 1 op + 每语句计 1，点总数应被限制在 ~32000 坐标内（不会 36 万），
    // 且墙钟守卫会让其在 ~7ms 处提前截断，实际点更少。
    expect(pts).toBeLessThan(40000);
    // eslint-disable-next-line no-console
    console.log(`bounded circle pts=${pts} (<40000)`);
  });

  it('wall-clock guard bounds high-op-cost recursion regardless of maxOps', () => {
    // fib 每 op 单价高（递归+表达式求值）：即使放开 maxOps，墙钟 7ms 硬上限也必须拦截，
    // 否则会逼近 CF 的 10ms CPU 限制。maxOps 给到 100 万排除 op 计数的干扰，证明是时间在兜底。
    const { med } = bench(
      'to f(n) { if n <= 1 { return n } return f(n-1) + f(n-2) }\nf(28)',
      1000000,
      7,
    );
    // eslint-disable-next-line no-console
    console.log(`fib(28) high maxOps: ${med.toFixed(2)}ms (wall-clock guard)`);
    expect(med).toBeLessThan(MAX_MS);
    expect(med).toBeLessThan(9);
  });
});
