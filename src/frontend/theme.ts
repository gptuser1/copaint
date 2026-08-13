// 前端主题：亮/暗切换，默认暗色，持久化到 localStorage，注入 <html data-theme>
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'copaint_theme';

export function loadTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' ? 'light' : 'dark'; // 默认暗色
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}

// 画布底色：暗色深灰（非纯黑），亮色白
export const BOARD_BG: Record<Theme, string> = { dark: '#2b2b2b', light: '#ffffff' };
