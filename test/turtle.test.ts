import { describe, it, expect } from 'vitest';
import { runTurtle } from '../src/infrastructure/turtle';

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

  it('circle produces an arc', () => {
    const items = runTurtle(`pd\ncircle 50`, { startX: 200, startY: 150 });
    expect(items.length).toBe(1);
    expect(items[0].points.length).toBeGreaterThan(10);
    // 闭合：绕一整圈首尾接近
    const p = items[0].points;
    expect(Math.abs(p[0] - p[p.length - 2])).toBeLessThan(5);
    expect(Math.abs(p[1] - p[p.length - 1])).toBeLessThan(5);
  });

  it('dot emits a filled shape', () => {
    const items = runTurtle(`dot 20 red`, { startX: 100, startY: 100 });
    const d = items[0];
    expect('fill' in d).toBe(true);
    if ('fill' in d) {
      expect(d.fill).toBe('#e74c3c');
      expect(d.points.length).toBeGreaterThan(4);
    }
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
    expect(Math.round(p[0])).toBe(300);
    expect(Math.round(p[1])).toBe(100);
    // heading 90 → 朝下，y 增加
    expect(Math.round(p[p.length - 1])).toBeGreaterThan(100);
  });
});
