import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { loadImage } from './engine/messageWindow';
import { inferTransparentColorFromBuffer } from './engine/transparentColorInference';
import { SYSTEM_ASSETS } from './engine/assetLoader';
import TextTab from './components/tabs/TextTab';
import WindowTab from './components/tabs/WindowTab';
import BackgroundTab from './components/tabs/BackgroundTab';
import FaceTab from './components/tabs/FaceTab';
import Preview from './components/Preview';
import './styles/App.css';

export default function App() {
  const { activeTab, setActiveTab, config, updateConfig, initialized, setInitialized, resetConfig } =
    useStore();

  // 初始化：加载默认 System 图（用于背景和配色），并推断透明色
  // 透明色推断优先解析 PNG 调色板 index 0（RTP 标准素材约定）
  useEffect(() => {
    if (initialized) return;
    const defaultSystem = SYSTEM_ASSETS.find((a) => a.name === 'System') ?? SYSTEM_ASSETS[0];
    if (!defaultSystem) {
      setInitialized(true);
      return;
    }
    loadImage(defaultSystem.url).then(async (img) => {
      const transparentColor = await inferTransparentColorFromBuffer(
        defaultSystem.url,
        img,
        { systemLayout: true },
      ) ?? '#000000';
      updateConfig((c) => ({
        ...c,
        backgroundSystem: { ...c.backgroundSystem, name: defaultSystem.name, image: img, transparentColor },
        colorSystem: { ...c.colorSystem, name: defaultSystem.name, image: img, transparentColor },
      }));
      setInitialized(true);
    }).catch(() => setInitialized(true));
  }, [initialized, updateConfig, setInitialized]);

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'text', label: '文字' },
    { id: 'window', label: '窗口' },
    { id: 'background', label: '背景' },
    { id: 'face', label: '脸图' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>MyWin RM200X</h1>
        <button className="reset-btn" onClick={resetConfig} title="重置为默认配置">
          重置
        </button>
      </header>
      <nav className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        <section className="settings-panel">
          {activeTab === 'text' && <TextTab />}
          {activeTab === 'window' && <WindowTab />}
          {activeTab === 'background' && <BackgroundTab />}
          {activeTab === 'face' && <FaceTab />}
        </section>
        <section className="preview-panel">
          <Preview />
        </section>
      </main>
      <footer className="app-footer">
        <span>配置：{config.standardWindow ? '标准窗口' : '自定义窗口'}</span>
        <span>·</span>
        <span>背景：{config.backgroundMode}</span>
        <span>·</span>
        <span>脸图：{config.faceMode}</span>
      </footer>
    </div>
  );
}
