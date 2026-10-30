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
import PictureDrawer from './components/PictureDrawer';
import './styles/App.css';

function WorkspaceSelector() {
  const {
    workspace,
    workspaceLoading,
    workspaceError,
    recentWorkspaces,
    openWorkspace,
    openRecentWorkspace,
    forgetRecentWorkspace,
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

  // 最近打开的工作区（仅 filesystem 模式有句柄可复用）
  const recentSection = recentWorkspaces.length > 0 && (
    <div className="workspace-recent">
      <div className="workspace-recent-title">最近打开</div>
      {recentWorkspaces.map((r, i) => (
        <div
          key={`${r.name}-${i}`}
          className={`workspace-recent-item ${workspace?.name === r.name ? 'current' : ''}`}
        >
          <button
            type="button"
            className="workspace-recent-open"
            onClick={async () => {
              setMenuOpen(false);
              await openRecentWorkspace(r);
            }}
            title={`重新打开 ${r.name}`}
          >
            <span className="workspace-recent-name">{r.name}</span>
          </button>
          <button
            type="button"
            className="workspace-recent-remove"
            onClick={() => void forgetRecentWorkspace(r)}
            title="从最近列表移除"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

  if (!isFileSystemSupported()) {
    return (
      <button
        className="workspace-btn unsupported"
        onClick={() =>
          alert(
            '当前环境不支持选择文件夹。工作区需要在桌面版 Chrome/Edge 中使用；移动端请直接导入素材',
          )
        }
        title="当前环境不支持选择文件夹"
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
              <div className="workspace-menu-top">
                <div className="workspace-info">
                  <span className="workspace-label">工作区</span>
                  <span className="workspace-path">{workspace.name}</span>
                </div>
                {workspace.mode === 'virtual' && (
                  <div className="workspace-dir-hint">
                    虚拟工作区：素材保存在浏览器中，导出时会触发文件下载
                  </div>
                )}
                {recentSection}
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
              <div className="workspace-menu-top">
                <div className="workspace-empty">
                  未打开工作区
                </div>
                <div className="workspace-dir-hint">
                  打开文件夹后可持久化素材和导出
                </div>
                {recentSection}
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
  const { activeTab, setActiveTab, config, updateConfig, initialized, setInitialized, refreshRecentWorkspaces, theme, toggleTheme, workspace, drawerOpen, toggleDrawer, refreshAssets, assetRefreshing } =
    useStore();

  // 页面加载只填充"最近打开"列表，不自动打开上次的工程
  useEffect(() => {
    void refreshRecentWorkspaces();
  }, [refreshRecentWorkspaces]);

  // 初始化主题 data-theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

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
        <h1>MYWIN</h1>
        <div className="divider-v"></div>
        <WorkspaceSelector />
        <div className="header-actions">
          <button
            className="header-btn refresh-btn"
            onClick={() => refreshAssets()}
            disabled={!workspace || assetRefreshing}
            title={workspace ? '重载素材目录（System / FaceSet / Picture）' : '打开工作区后可刷新素材目录'}
          >
            ⟳
          </button>
          <button className="header-btn theme-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {workspace && (
            <button
              className={`header-btn drawer-btn ${drawerOpen ? 'active' : ''}`}
              onClick={toggleDrawer}
              title={drawerOpen ? '关闭图库' : '打开图库'}
            >
              ☰
            </button>
          )}
        </div>
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
        {workspace && drawerOpen && <PictureDrawer />}
      </main>
      <footer className="app-footer">
        <span>配置：{config.standardWindow ? '标准窗口' : '自定义窗口'}</span>
        <span>·</span>
        <span>背景：{config.backgroundMode}</span>
        <span>·</span>
        <span>
          脸图：{[
            config.faceLeft.enabled ? '左' : null,
            config.faceRight.enabled ? '右' : null,
          ]
            .filter(Boolean)
            .join('+') || '无'}
        </span>
      </footer>
    </div>
  );
}