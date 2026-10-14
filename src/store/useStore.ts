// 全局状态管理（zustand）

import { create } from 'zustand';
import {
  DEFAULT_CONFIG,
  RPG_CONSTANTS,
  type MessageWindowConfig,
  type Padding,
} from '../types';
import {
  setWorkspaceAssets,
  clearWorkspaceAssets,
  type AssetCategory,
  type AssetEntry,
} from '../engine/assetLoader';
import { loadImage } from '../engine/messageWindow';
import {
  openWorkspace,
  closeWorkspace as closeWorkspaceDir,
  tryRestoreWorkspace,
  listWorkspaceAssets,
  saveAssetToWorkspace,
  removeAssetFromWorkspace,
  exportToWorkspace,
  isFileSystemAccessSupported,
  listWorkspacePictures,
  overwritePictureInWorkspace,
  type Workspace as WorkspaceInfo,
  type PictureEntry,
} from '../engine/workspace';

interface StoreState {
  config: MessageWindowConfig;
  activeTab: 'text' | 'window' | 'background' | 'face';
  initialized: boolean;
  workspace: WorkspaceInfo | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  assetRefreshing: boolean;
  theme: 'dark' | 'light';

  // 替换模式（右侧 Picture 图库抽屉）
  drawerOpen: boolean;
  pictures: PictureEntry[];
  selectedPicture: PictureEntry | null;

  updateConfig: (updater: (config: MessageWindowConfig) => MessageWindowConfig) => void;
  patchConfig: (partial: Partial<MessageWindowConfig>) => void;
  setActiveTab: (tab: StoreState['activeTab']) => void;
  resetConfig: () => void;
  restoreStandardWindow: () => void;
  setFollowTargetPicture: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  toggleTheme: () => void;

  // 工作区操作
  openWorkspace: () => Promise<void>;
  restoreWorkspace: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  saveAssetToWorkspace: (category: AssetCategory, file: File) => Promise<AssetEntry | null>;
  removeAssetFromWorkspace: (category: AssetCategory, name: string) => Promise<boolean>;
  exportPNGToWorkspace: (filename: string, pngData: Uint8Array) => Promise<string | null>;
  isFileSystemSupported: () => boolean;
  /** 重载工作区素材目录（System / FaceSet / Picture），不改动任何表单配置 */
  refreshAssets: () => Promise<void>;
  /** 距上次重载超过最小间隔时才重载（素材选择器打开时调用） */
  refreshAssetsIfStale: () => void;

  // 替换模式操作
  toggleDrawer: () => void;
  refreshPictures: () => Promise<void>;
  togglePictureSelection: (p: PictureEntry) => void;
  overwritePictureToWorkspace: (fileName: string, pngData: Uint8Array) => Promise<string | null>;
}

const savedTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('mywin-theme')) as 'dark' | 'light' | null;

/** 素材目录自动重载的最小间隔，避免短时间内反复读取磁盘 */
const ASSET_REFRESH_MIN_INTERVAL_MS = 3000;

/** 上次重载素材目录的时间（仅用于节流，不参与渲染） */
let lastAssetRefreshAt = 0;

/** 记录一次素材目录重载时间点 */
function markAssetsRefreshed(): void {
  lastAssetRefreshAt = Date.now();
}

/**
 * 跟随目标图片：把宽高记录更新为图片尺寸
 * （窗口设置只有这一份记录，跟随只是适时更新它）
 */
function syncFollowTargetSize(
  picture: PictureEntry,
  get: () => StoreState,
  set: (partial: (s: StoreState) => Partial<StoreState>) => void,
): void {
  if (!get().config.followTargetPicture) return;
  loadImage(picture.dataUrl)
    .then((img) => {
      // 加载期间选中项若已变化，丢弃过期结果
      if (get().selectedPicture?.fileName !== picture.fileName) return;
      set((s) => ({
        config: { ...s.config, width: img.naturalWidth, height: img.naturalHeight },
      }));
    })
    .catch(() => {
      // 图片加载失败时保持原记录
    });
}

export const useStore = create<StoreState>((set, get) => ({
  config: {
    ...DEFAULT_CONFIG,
  },
  activeTab: 'text',
  initialized: false,
  workspace: null,
  workspaceLoading: false,
  workspaceError: null,
  assetRefreshing: false,
  theme: savedTheme ?? 'dark',
  drawerOpen: false,
  pictures: [],
  selectedPicture: null,

  updateConfig: (updater) =>
    set((state) => ({
      config: updater(state.config),
    })),

  patchConfig: (partial) =>
    set((state) => ({
      config: { ...state.config, ...partial },
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  resetConfig: () =>
    set({
      config: { ...DEFAULT_CONFIG },
    }),

  restoreStandardWindow: () =>
    set((state) => ({
      config: {
        ...state.config,
        standardWindow: false,
        width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
        height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
        padding: {
          top: RPG_CONSTANTS.BORDER_THICKNESS,
          right: RPG_CONSTANTS.BORDER_THICKNESS,
          bottom: RPG_CONSTANTS.BORDER_THICKNESS,
          left: RPG_CONSTANTS.BORDER_THICKNESS,
        } as Padding,
      },
    })),

  setFollowTargetPicture: (v) => {
    set((s) => ({
      config: {
        ...s.config,
        followTargetPicture: v,
        // 跟随模式下需退出标准窗口锁定，宽高才能跟随图片
        ...(v ? { standardWindow: false } : {}),
      },
    }));
    // 已有目标图片时，立即用它的尺寸刷新记录
    const sel = get().selectedPicture;
    if (v && sel) syncFollowTargetSize(sel, get, set);
  },

  setInitialized: (v) => set({ initialized: v }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mywin-theme', next);
    document.documentElement.dataset.theme = next;
    set({ theme: next });
  },

  isFileSystemSupported: () => isFileSystemAccessSupported(),

  refreshAssets: async () => {
    const { workspace, assetRefreshing } = get();
    if (!workspace || assetRefreshing) return;
    set({ assetRefreshing: true, workspaceError: null });
    try {
      // 外部对素材目录的增删改不会被浏览器感知，只能重新读取
      const [sysAssets, faceAssets] = await Promise.all([
        listWorkspaceAssets(workspace, 'System'),
        listWorkspaceAssets(workspace, 'FaceSet'),
      ]);
      setWorkspaceAssets('System', sysAssets);
      setWorkspaceAssets('FaceSet', faceAssets);
      await get().refreshPictures();
      markAssetsRefreshed();
    } catch (e) {
      set({ workspaceError: String(e) || '刷新素材目录失败' });
    } finally {
      set({ assetRefreshing: false });
    }
  },

  refreshAssetsIfStale: () => {
    if (!get().workspace) return;
    if (Date.now() - lastAssetRefreshAt < ASSET_REFRESH_MIN_INTERVAL_MS) return;
    void get().refreshAssets();
  },

  openWorkspace: async () => {
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const ws = await openWorkspace();
      if (ws) {
        set({ workspace: ws, selectedPicture: null });
        const sysAssets = await listWorkspaceAssets(ws, 'System');
        const faceAssets = await listWorkspaceAssets(ws, 'FaceSet');
        const pictures = await listWorkspacePictures(ws);
        setWorkspaceAssets('System', sysAssets);
        setWorkspaceAssets('FaceSet', faceAssets);
        set({ pictures });
        markAssetsRefreshed();
      }
    } catch (e) {
      set({ workspaceError: String(e) || '打开工作区失败' });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  restoreWorkspace: async () => {
    try {
      const ws = await tryRestoreWorkspace();
      if (ws) {
        set({ workspace: ws });
        const sysAssets = await listWorkspaceAssets(ws, 'System');
        const faceAssets = await listWorkspaceAssets(ws, 'FaceSet');
        const pictures = await listWorkspacePictures(ws);
        setWorkspaceAssets('System', sysAssets);
        setWorkspaceAssets('FaceSet', faceAssets);
        set({ pictures });
        markAssetsRefreshed();
      }
    } catch {
      // 静默失败，不影响应用正常使用
    }
  },

  closeWorkspace: async () => {
    set({ workspaceLoading: true });
    try {
      await closeWorkspaceDir();
      clearWorkspaceAssets();
      set({
        workspace: null,
        workspaceError: null,
        drawerOpen: false,
        pictures: [],
        selectedPicture: null,
      });
    } catch (e) {
      set({ workspaceError: String(e) || '关闭工作区失败' });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  saveAssetToWorkspace: async (category: AssetCategory, file: File) => {
    const { workspace } = get();
    if (!workspace) return null;
    try {
      const entry = await saveAssetToWorkspace(workspace, category, file);
      // 重新加载列表
      const updated = await listWorkspaceAssets(workspace, category);
      setWorkspaceAssets(category, updated);
      return entry;
    } catch (e) {
      set({ workspaceError: String(e) || '保存素材失败' });
      return null;
    }
  },

  removeAssetFromWorkspace: async (category: AssetCategory, name: string) => {
    const { workspace } = get();
    if (!workspace) return false;
    try {
      const ok = await removeAssetFromWorkspace(workspace, category, name);
      if (ok) {
        const updated = await listWorkspaceAssets(workspace, category);
        setWorkspaceAssets(category, updated);
      }
      return ok;
    } catch (e) {
      set({ workspaceError: String(e) || '删除素材失败' });
      return false;
    }
  },

  exportPNGToWorkspace: async (filename: string, pngData: Uint8Array) => {
    const { workspace } = get();
    if (!workspace) return null;
    try {
      return await exportToWorkspace(workspace, filename, pngData);
    } catch (e) {
      set({ workspaceError: String(e) || '导出到工作区失败' });
      return null;
    }
  },

  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

  refreshPictures: async () => {
    const { workspace, selectedPicture } = get();
    if (!workspace) {
      set({ pictures: [], selectedPicture: null });
      return;
    }
    try {
      const pics = await listWorkspacePictures(workspace);
      set({
        pictures: pics,
        // 同步选中项，使缩略图与对照图指向最新内容
        selectedPicture: selectedPicture
          ? pics.find((p) => p.fileName === selectedPicture.fileName) ?? null
          : null,
      });
    } catch (e) {
      set({ workspaceError: String(e) || '读取 Picture 目录失败' });
    }
  },

  togglePictureSelection: (p) => {
    const cur = get().selectedPicture;
    const next = cur && cur.fileName === p.fileName ? null : p;
    set({ selectedPicture: next });
    // 选中新图片后，跟随模式下的宽高记录随之更新
    if (next) syncFollowTargetSize(next, get, set);
  },

  overwritePictureToWorkspace: async (fileName: string, pngData: Uint8Array) => {
    const { workspace } = get();
    if (!workspace) return null;
    try {
      return await overwritePictureInWorkspace(workspace, fileName, pngData);
    } catch (e) {
      set({ workspaceError: String(e) || '覆盖图片失败' });
      return null;
    }
  },
}));