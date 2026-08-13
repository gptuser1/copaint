import { describe, it, expect } from 'vitest';
import { buildTurtlePrompt } from '../src/infrastructure/ai/client';

describe('ai turtle prompt', () => {
  const sys = buildTurtlePrompt('x', 800, 600, 'hint')[0].content;

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
});
