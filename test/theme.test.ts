import { describe, it, expect } from 'vitest';
import { mapColorForTheme } from '../src/frontend/theme';

describe('mapColorForTheme (画布黑白互换)', () => {
  it('dark: black -> white, white -> black, others unchanged', () => {
    expect(mapColorForTheme('#000000', 'dark')).toBe('#ffffff');
    expect(mapColorForTheme('#ffffff', 'dark')).toBe('#000000');
    expect(mapColorForTheme('#ff8800', 'dark')).toBe('#ff8800');
    expect(mapColorForTheme('#e74c3c', 'dark')).toBe('#e74c3c');
  });

  it('light: all colors unchanged', () => {
    expect(mapColorForTheme('#000000', 'light')).toBe('#000000');
    expect(mapColorForTheme('#ffffff', 'light')).toBe('#ffffff');
    expect(mapColorForTheme('#ff8800', 'light')).toBe('#ff8800');
  });

  it('handles shorthand and uppercase hex', () => {
    expect(mapColorForTheme('#fff', 'dark')).toBe('#000000'); // 白简写 -> 黑
    expect(mapColorForTheme('#000', 'dark')).toBe('#ffffff'); // 黑简写 -> 白
    expect(mapColorForTheme('#FFFFFF', 'dark')).toBe('#000000');
    expect(mapColorForTheme('#FF8800', 'dark')).toBe('#FF8800'); // 非黑白颜色原样保留
  });
});
