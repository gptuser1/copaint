// 验证递归深度守卫：深递归被截断且 CPU 受控；正常递归（分形）不受影响
import { describe, it, expect } from 'vitest';
import { runTurtle } from '../src/infrastructure/turtle';

function bench(script: string, maxOps = 20000, rounds = 5): number {
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    runTurtle(script, { startX: 300, startY: 200, maxOps });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe('turtle recursion depth guard', () => {
  it('deep linear recursion is capped under 10ms', () => {
    // 线性递归深度 1000：超过 64 层守卫，应立即截断
    for (const script of [
      'to loop(n) { if n > 0 { loop(n - 1) } }\nloop(1000)',
      'to loop(n) { loop(n) }\nloop(1)', // 无限递归
    ]) {
      const ms = bench(script);
      // eslint-disable-next-line no-console
      console.log(`deep recursion: ${ms.toFixed(2)}ms`);
      expect(ms).toBeLessThan(10);
    }
  });

  it('normal fractal recursion still works', () => {
    // 深度 <=64 的正常递归（分形树/科赫）应正常完成且耗时可接受
    const script = 'pd\nto seg(n,len) { if n==0 { fd len } else { seg(n-1,len/3) lt 60 seg(n-1,len/3) rt 120 seg(n-1,len/3) lt 60 seg(n-1,len/3) } }\nseg(4,200)';
    const items = runTurtle(script, { startX: 300, startY: 200 });
    const ms = bench(script);
    // eslint-disable-next-line no-console
    console.log(`koch seg(4) depth4: ${ms.toFixed(2)}ms items=${items.length}`);
    expect(items.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10);
  });

  it('tree depth 10 still renders', () => {
    // 树脚本未写 pd：只移动不画点，items 可能为 0；核心是耗时可接受且不 abort 崩溃
    const script = 'to branch(n) { if n > 0 { fd 30 lt 30 branch(n-1) rt 60 branch(n-1) lt 30 bk 30 } }\nbranch(10)';
    const items = runTurtle(script, { startX: 300, startY: 200 });
    const ms = bench(script);
    // eslint-disable-next-line no-console
    console.log(`tree depth10: ${ms.toFixed(2)}ms items=${items.length}`);
    expect(ms).toBeLessThan(10);

    // pd 版本确认真能画出来（depth 10 未被深度守卫误伤）
    const painted = runTurtle('pd\n' + script, { startX: 300, startY: 200 });
    const ms2 = bench('pd\n' + script);
    // eslint-disable-next-line no-console
    console.log(`tree depth10 pd: ${ms2.toFixed(2)}ms items=${painted.length}`);
    expect(painted.length).toBeGreaterThan(0);
    expect(ms2).toBeLessThan(10);
  });
});
