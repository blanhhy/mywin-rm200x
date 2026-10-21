import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store/useStore';
import { listStoredFonts } from './engine/fontLoader';
import './styles/index.css';

// 恢复用户导入的字体列表（只读元数据，字体文件在选中时才加载）
void listStoredFonts().then((fonts) => useStore.getState().addCustomFonts(fonts));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
