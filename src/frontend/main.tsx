// CoPaint 前端入口：/view 为观看模式（只读画布），其余为主应用
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { View } from './View';
import './styles.css';

const el = document.getElementById('root');
if (el) {
  const isView = window.location.pathname.startsWith('/view');
  createRoot(el).render(isView ? <View /> : <App />);
}
