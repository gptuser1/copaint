// 正式守卫测试：验证爆炸场景 CPU 受控 + 正常分形完整渲染（maxOps=20000 校准值）
import { describe, it, expect } from 'vitest';
import { runTurtle } from '../src/infrastructure/turtle';

const MAX_MS = 10;

function bench(script: string, maxOps = 20000, maxMs = 7, rounds = 5): { med: number; items: ReturnType<typeof runTurtle> } {
  let items: ReturnType<typeof runTurtle> = [];
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    items = runTurtle(script, { startX: 300, startY: 200, maxOps, maxMs });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { med: times[Math.floor(times.length / 2)], items };
}

function totalPts(items: ReturnType<typeof runTurtle>): number {
  return items.reduce((s, it) => s + ('points' in it ? it.points.length : 0), 0);
}

describe('turtle cpu guard (maxOps=20000)', () => {
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
    ];
    for (const [name, script] of cases) {
      const { med, items } = bench(script);
      const pts = totalPts(items);
      // eslint-disable-next-line no-console
      console.log(`${name}: ${med.toFixed(2)}ms items=${items.length} pts=${pts}`);
      expect(med).toBeLessThan(MAX_MS);
    }
  });

  it('normal complex art completes fully at maxOps=20000', () => {
    const cases: Array<[string, string]> = [
      ['koch seg(5)', 'pd\nto seg(n,len) { if n==0 { fd len } else { seg(n-1,len/3) lt 60 seg(n-1,len/3) rt 120 seg(n-1,len/3) lt 60 seg(n-1,len/3) } }\nseg(5,200)'],
      ['tree depth 10', 'pd\nto branch(n) { if n > 0 { fd 30 lt 30 branch(n-1) rt 60 branch(n-1) lt 30 bk 30 } }\nbranch(10)'],
      ['spiral+flowers', 'pd\nrepeat 360 { fd 1 rt 1 }\nrepeat 6 { circle 20 }'],
      ['koch seg(4)', 'pd\nto seg(n,len) { if n==0 { fd len } else { seg(n-1,len/3) lt 60 seg(n-1,len/3) rt 120 seg(n-1,len/3) lt 60 seg(n-1,len/3) } }\nseg(4,200)'],
    ];
    for (const [name, script] of cases) {
      const { med, items } = bench(script);
      const full = totalPts(runTurtle(script, { startX: 300, startY: 200, maxOps: 500000 }));
      const at20k = totalPts(items);
      const complete = at20k >= full;
      // eslint-disable-next-line no-console
      console.log(`${name}: ${med.toFixed(2)}ms pts=${at20k}/${full} ${complete ? 'COMPLETE' : 'TRUNCATED'}`);
      expect(complete).toBe(true);
      expect(med).toBeLessThan(MAX_MS);
    }
  });

  it('bounded point output for explosion scenarios', () => {
    const { items } = bench('pd\nrepeat 2000 { circle 5 }');
    const pts = totalPts(items);
    // maxOps=20000：circle 每点计 1 op + 每语句计 1，点总数应被限制（不会 36 万）
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
