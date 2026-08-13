// 基于 pngjs 的纯 JS 光栅渲染器（无原生依赖，workerd 兼容）
import { PNG } from 'pngjs';
import type { BoardElement } from '../../domain/types';

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, Math.round(alpha * 255)];
}

function setPx(buf: Buffer, w: number, x: number, y: number, c: [number, number, number, number]) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  const a = c[3] / 255;
  buf[i] = Math.round(c[0] * a + buf[i] * (1 - a));
  buf[i + 1] = Math.round(c[1] * a + buf[i + 1] * (1 - a));
  buf[i + 2] = Math.round(c[2] * a + buf[i + 2] * (1 - a));
  buf[i + 3] = 255;
}

// Bresenham 画线段（含宽度：用圆刷）
function drawLine(buf: Buffer, w: number, x0: number, y0: number, x1: number, y1: number, color: [number,number,number,number], sw: number) {
  const r = Math.max(1, Math.floor(sw / 2));
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) setPx(buf, w, cx + dx, cy + dy, color);
      }
    }
  }
}

// 画矩形边框
function drawRect(buf: Buffer, w: number, x: number, y: number, width: number, height: number, color: [number,number,number,number], sw: number) {
  drawLine(buf, w, x, y, x + width, y, color, sw);
  drawLine(buf, w, x, y + height, x + width, y + height, color, sw);
  drawLine(buf, w, x, y, x, y + height, color, sw);
  drawLine(buf, w, x + width, y, x + width, y + height, color, sw);
}

// 画椭圆/圆边框（中点椭圆算法）
function drawEllipse(buf: Buffer, w: number, cx: number, cy: number, rx: number, ry: number, color: [number,number,number,number], sw: number) {
  const n = Math.max(64, Math.ceil(Math.max(rx, ry) * 6));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const px = cx + rx * Math.cos(t);
    const py = cy + ry * Math.sin(t);
    const pxn = cx + rx * Math.cos(t + (Math.PI * 2) / n);
    const pyn = cy + ry * Math.sin(t + (Math.PI * 2) / n);
    drawLine(buf, w, px, py, pxn, pyn, color, sw);
  }
}

export function renderBoardToPng(elements: BoardElement[], width: number, height: number): PNG {
  const png = new PNG({ width, height });
  const buf = png.data;
  // 白底
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 255;
  }

  for (const el of elements) {
    const color = hexToRgba(el.color || '#000000', 1);
    const sw = el.strokeWidth || 2;
    switch (el.type) {
      case 'pen':
      case 'eraser': {
        const pts = el.points || [];
        const widths = el.widths || [];
        const colors = el.colors || [];
        for (let i = 2; i + 1 < pts.length; i += 2) {
          const segColor = colors[(i - 2) / 2] || el.color || '#000000';
          const c = hexToRgba(segColor, 1);
          // 段宽：取两端顶点宽度的均值，实现粗细渐变
          const w0 = widths[(i - 2) / 2] ?? sw;
          const w1 = widths[(i - 2) / 2 + 1] ?? w0;
          drawLine(buf, width, pts[i - 2], pts[i - 1], pts[i], pts[i + 1], c, (w0 + w1) / 2);
        }
        break;
      }
      case 'line': {
        drawLine(buf, width, el.x || 0, el.y || 0, el.x2 || 0, el.y2 || 0, color, sw);
        break;
      }
      case 'rect': {
        drawRect(buf, width, el.x || 0, el.y || 0, el.width || 0, el.height || 0, color, sw);
        break;
      }
      case 'ellipse': {
        drawEllipse(buf, width, (el.x || 0) + (el.width || 0) / 2, (el.y || 0) + (el.height || 0) / 2, (el.width || 0) / 2, (el.height || 0) / 2, color, sw);
        break;
      }
    }
  }
  return png;
}
