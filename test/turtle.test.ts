import { describe, it, expect } from 'vitest';
import { runTurtle } from '../src/infrastructure/turtle';

describe('turtle', () => {
  it('draws a square with repeat', () => {
    const strokes = runTurtle(
      `pd\nrepeat 4 {\n fd 50\n rt 90\n}`,
      { startX: 200, startY: 150, startHeading: 0 },
    );
    expect(strokes.length).toBe(1);
    expect(strokes[0].points.length).toBeGreaterThan(4);
    const p = strokes[0].points;
    expect(Math.round(p[0])).toBe(200);
    expect(Math.round(p[1])).toBe(150);
    expect(Math.round(p[p.length - 2])).toBe(200);
    expect(Math.round(p[p.length - 1])).toBe(150);
  });

  it('splits strokes across pen up/down', () => {
    const strokes = runTurtle(
      `pd fd 20 pu fd 20 pd fd 20`,
      { startX: 100, startY: 100 },
    );
    expect(strokes.length).toBe(2);
  });

  it('records color and width changes', () => {
    const strokes = runTurtle(
      `color red\nwidth 8\npd fd 30\ncolor blue\nfd 30`,
      { startX: 0, startY: 0 },
    );
    const s = strokes[0];
    expect(s.colors[0]).toBe('#e74c3c');
    expect(s.widths[0]).toBe(8);
    expect(s.colors.includes('#2980b9')).toBe(true);
  });
});
