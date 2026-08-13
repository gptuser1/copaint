// 前端构建脚本：将 React SPA 打包为单 bundle
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('public/js', { recursive: true });

await build({
  entryPoints: ['src/frontend/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/js/main.js',
  jsx: 'automatic',
  logLevel: 'warning',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

if (!existsSync('public/index.html')) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoPaint 在线画板</title>
  <link rel="stylesheet" href="/js/main.css">
  <style>
    html, body, #root { margin: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/js/main.js"></script>
</body>
</html>`;
  writeFileSync('public/index.html', html);
}

console.log('[build-frontend] done');
