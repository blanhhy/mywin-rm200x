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

  // 替换模式操作
  toggleDrawer: () => void;
  refreshPictures: () => Promise<void>;
  togglePictureSelection: (p: PictureEntry) => void;
  overwritePictureToWorkspace: (fileName: string, pngData: Uint8Array) => Promise<string | null>;
}

const savedTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('mywin-theme')) as 'dark' | 'light' | null;

export const useStore = create<StoreState>((set, get) => ({
  config: {
    ...DEFAULT_CONFIG,
  },
  activeTab: 'text',
  initialized: false,
  workspace: null,
  workspaceLoading: false,
  workspaceError: null,
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

  setInitialized: (v) => set({ initialized: v }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mywin-theme', next);
    document.documentElement.dataset.theme = next;
    set({ theme: next });
  },

  isFileSystemSupported: () => isFileSystemAccessSupported(),

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
    set({ selectedPicture: cur && cur.fileName === p.fileName ? null : p });
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