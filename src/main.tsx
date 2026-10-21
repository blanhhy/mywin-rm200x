import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store/useStore';
import { registerStoredFonts } from './engine/fontLoader';
import './styles/index.css';

// 恢复用户导入的字体文件（与 User 级素材一致：持久化、刷新后仍在列表中）
void registerStoredFonts().then((fonts) => useStore.getState().addCustomFonts(fonts));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
