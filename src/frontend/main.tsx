// CoPaint 前端入口（阶段4填充完整画布）
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
      CoPaint 加载中…
    </div>,
  );
}
