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

  it('includes existing elements summary at the end of user message', () => {
    const existing: BoardElement[] = [
      { id: '1', type: 'rect', x: 100, y: 100, width: 200, height: 150, color: '#e74c3c', strokeWidth: 3, by: 'ai', createdAt: 1 },
      { id: '2', type: 'line', x: 300, y: 50, x2: 400, y2: 200, color: '#3498db', strokeWidth: 2, by: 'ai', createdAt: 2 },
      { id: '3', type: 'pen', points: [350, 250, 360, 260, 370, 270], color: '#000', strokeWidth: 3, by: 'user', createdAt: 3 },
    ];
    const [sys, user] = buildTurtlePrompt('test', 800, 600, 'hint', existing);
    // 动态内容只出现在 user 末尾，system 保持固定前缀
    expect(sys.content).not.toContain('existing');
    expect(user.content).toContain('existing');
    expect(user.content).toContain('rect');
    expect(user.content).toContain('line');
    expect(user.content).toContain('pen');
    expect(user.content).toContain('#e74c3c');
  });

  it('shows none when no existing elements', () => {
    const [, user] = buildTurtlePrompt('x', 800, 600, 'hint', emptyExisting);
    expect(user.content).toContain('none（空画板）');
  });

  it('keeps system prefix byte-stable across different steps', () => {
    const a = buildTurtlePrompt('x', 800, 600, '第 1/3 步', emptyExisting)[0].content;
    const b = buildTurtlePrompt('x', 800, 600, '第 2/3 步', [
      { id: '1', type: 'rect', x: 10, y: 10, width: 50, height: 50, color: '#000', strokeWidth: 3, by: 'ai', createdAt: 1 },
    ])[0].content;
    // system 固定，不随 stepHint/existing 变化 → 前缀可命中缓存
    expect(a).toBe(b);
  });
});