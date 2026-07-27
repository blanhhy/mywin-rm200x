import { useEffect, useState } from 'react';
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

function WorkspaceSelector() {
  const {
    workspace,
    workspaceLoading,
    workspaceError,
    openWorkspace,
    closeWorkspace,
    isFileSystemSupported,
  } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.workspace-selector')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!isFileSystemSupported()) {
    return (
      <button
        className="workspace-btn unsupported"
        onClick={() =>
          alert('当前浏览器不支持文件夹访问，请使用 Chrome/Edge 最新版本')
        }
        title="当前浏览器不支持文件夹访问"
      >
        <span className="workspace-icon">📁</span>
        <span className="workspace-name">工作区</span>
      </button>
    );
  }

  return (
    <div className="workspace-selector">
      <button
        className={`workspace-btn ${workspace ? 'active' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
        title={workspace ? `当前工作区：${workspace.name}` : '打开工作区'}
      >
        <span className="workspace-icon">📁</span>
        <span className="workspace-name">
          {workspace ? workspace.name : '打开工作区'}
        </span>
        <span className="workspace-arrow">▾</span>
      </button>

      {menuOpen && (
        <div className="workspace-menu">
          {workspaceError && (
            <div className="workspace-error">{workspaceError}</div>
          )}
          {workspaceLoading ? (
            <div className="workspace-loading">加载中...</div>
          ) : workspace ? (
            <>
              <div className="workspace-info">
                <span className="workspace-label">工作区</span>
                <span className="workspace-path">{workspace.name}</span>
              </div>
              <div className="workspace-dir-hint">
                System/ · Faceset/ · Picture/
              </div>
              <button
                className="workspace-menu-item"
                onClick={async () => {
                  setMenuOpen(false);
                  await openWorkspace();
                }}
              >
                切换文件夹...
              </button>
              <button
                className="workspace-menu-item danger"
                onClick={async () => {
                  setMenuOpen(false);
                  await closeWorkspace();
                }}
              >
                关闭工作区
              </button>
            </>
          ) : (
            <>
              <div className="workspace-empty">
                未打开工作区
              </div>
              <div className="workspace-dir-hint">
                打开文件夹后可持久化素材和导出
              </div>
              <button
                className="workspace-menu-item"
                onClick={async () => {
                  setMenuOpen(false);
                  await openWorkspace();
                }}
              >
                打开文件夹...
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { activeTab, setActiveTab, config, updateConfig, initialized, setInitialized, resetConfig, restoreWorkspace } =
    useStore();

  // 应用启动时自动恢复上次的工作区
  useEffect(() => {
    restoreWorkspace();
  }, [restoreWorkspace]);

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
        <WorkspaceSelector />
        <button className="reset-btn" onClick={resetConfig} title="重置为默认配置">
          重置
        </button>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
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
          <section className="settings-panel">
            {activeTab === 'text' && <TextTab />}
            {activeTab === 'window' && <WindowTab />}
            {activeTab === 'background' && <BackgroundTab />}
            {activeTab === 'face' && <FaceTab />}
          </section>
        </aside>
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