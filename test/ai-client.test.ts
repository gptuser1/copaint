import { describe, it, expect } from 'vitest';
import { buildTurtlePrompt } from '../src/infrastructure/ai/client';
import type { BoardElement } from '../src/domain/types';

const emptyExisting: BoardElement[] = [];

describe('ai turtle prompt', () => {
  const sys = buildTurtlePrompt('x', 800, 600, 'hint', emptyExisting)[0].content;

  it('enumerates all supported color names', () => {
    const names = ['red', 'green', 'blue', 'black', 'white', 'yellow', 'orange',
      'purple', 'pink', 'brown', 'gray', 'grey', 'cyan', 'teal', 'gold',
      'silver', 'navy', 'lime', 'magenta'];
    for (const c of names) expect(sys).toContain(c);
  });

  it('documents hex color support', () => {
    expect(sys).toContain('#rrggbb');
    expect(sys).toContain('#rgb');
  });

  it('states coordinate system and initial pen state', () => {
    expect(sys).toContain('原点');
    expect(sys).toContain('+y 向上');
    expect(sys).toContain('pd');
    expect(sys).toContain('pu');
  });

  it('demands strict output format', () => {
    expect(sys).toContain('只输出');
    expect(sys).toContain('禁止');
    expect(sys).toContain('markdown');
  });

  it('covers core commands in the reference', () => {
    for (const cmd of ['fd', 'lt', 'rt', 'pu', 'pd', 'color', 'width', 'goto',
      'circle', 'dot', 'rect', 'ellipse', 'line', 'begin_fill', 'repeat']) {
      expect(sys).toContain(cmd);
    }
  });

  it('includes existing elements summary when elements exist', () => {
    const existing: BoardElement[] = [
      { id: '1', type: 'rect', x: 100, y: 100, width: 200, height: 150, color: '#e74c3c', strokeWidth: 3, by: 'ai', createdAt: 1 },
      { id: '2', type: 'line', x: 300, y: 50, x2: 400, y2: 200, color: '#3498db', strokeWidth: 2, by: 'ai', createdAt: 2 },
      { id: '3', type: 'pen', points: [350, 250, 360, 260, 370, 270], color: '#000', strokeWidth: 3, by: 'user', createdAt: 3 },
    ];
    const s = buildTurtlePrompt('test', 800, 600, 'hint', existing)[0].content;
    expect(s).toContain('existing');
    expect(s).toContain('rect');
    expect(s).toContain('line');
    expect(s).toContain('pen');
    expect(s).toContain('#e74c3c');
  });

  it('shows none when no existing elements', () => {
    expect(sys).toContain('none（空画板）');
  });
});