// 全局状态管理（zustand）

import { create } from 'zustand';
import {
  DEFAULT_CONFIG,
  RPG_CONSTANTS,
  type MessageWindowConfig,
  type Padding,
  type CustomFontEntry,
  type LoadedImage,
} from '../types';
import {
  setWorkspaceAssets,
  clearWorkspaceAssets,
  type AssetCategory,
  type AssetEntry,
} from '../engine/assetLoader';
import { loadImage } from '../engine/messageWindow';
import { dataUrlToBytes, parsePalette0 } from '../engine/transparentColorInference';
import { buildConfigFromMeta, readPictureMeta } from '../engine/pictureMeta';
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
  readPictureDataUrl,
  overwritePictureInWorkspace,
  saveHandle as saveWorkspaceHandle,
  addRecentWorkspace,
  listRecentWorkspaces,
  removeRecentWorkspace,
  isSameDirectoryHandle,
  type Workspace as WorkspaceInfo,
  type PictureEntry,
  type RecentWorkspace,
} from '../engine/workspace';

interface StoreState {
  config: MessageWindowConfig;
  activeTab: 'text' | 'window' | 'background' | 'face';
  initialized: boolean;
  workspace: WorkspaceInfo | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  assetRefreshing: boolean;
  recentWorkspaces: RecentWorkspace[];
  theme: 'dark' | 'light';
  /** 已添加到字体选择器的字体（本机字体 + 导入的字体文件） */
  customFonts: CustomFontEntry[];

  // 替换模式（右侧 Picture 图库抽屉）
  drawerOpen: boolean;
  pictures: PictureEntry[];
  selectedPicture: PictureEntry | null;
  /** 背景参考图片的来源文件名（来自工作区 Picture 时记录，用于随图保存参数） */
  backgroundImageFileName: string | null;

  updateConfig: (updater: (config: MessageWindowConfig) => MessageWindowConfig) => void;
  patchConfig: (partial: Partial<MessageWindowConfig>) => void;
  setActiveTab: (tab: StoreState['activeTab']) => void;
  restoreStandardWindow: () => void;
  setFollowTargetPicture: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  toggleTheme: () => void;
  /** 把字体加入已添加列表（同来源同 family 去重） */
  addCustomFonts: (items: CustomFontEntry[]) => void;
  /** 从已添加列表移除一项 */
  removeCustomFont: (family: string) => void;

  // 工作区操作
  openWorkspace: () => Promise<void>;
  restoreWorkspace: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  /** 从最近列表重新打开一个工作区（filesystem 模式） */
  openRecentWorkspace: (entry: RecentWorkspace) => Promise<void>;
  /** 从最近列表移除一条记录（不影响已打开的工作区） */
  forgetRecentWorkspace: (entry: RecentWorkspace) => Promise<void>;
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
  /** 应用背景参考图片（上传为 null 文件名，图库拖入/右键设为背景为图片文件名） */
  applyReferenceBackground: (
    image: LoadedImage,
    palette0: string | null,
    fileName: string | null,
  ) => void;
  /** 仅把图片设为参考（对照/覆盖目标） */
  setPictureAsReference: (p: PictureEntry) => void;
  /** 把图库图片设为背景参考 */
  setPictureAsBackground: (p: PictureEntry) => Promise<boolean>;
  /** 读入图片随图保存的参数并设为参考 */
  editPictureFromMeta: (p: PictureEntry) => Promise<{ ok: boolean; message: string }>;
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
  const workspace = get().workspace;
  if (!workspace) return;
  readPictureDataUrl(workspace, picture)
    .then((dataUrl) => loadImage(dataUrl))
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

/** 读取最近打开的工作区列表到 state */
async function loadRecentsInto(
  set: (partial: (s: StoreState) => Partial<StoreState>) => void,
): Promise<void> {
  const recents = await listRecentWorkspaces();
  set(() => ({ recentWorkspaces: recents }));
}

/**
 * 接管一个工作区：更新 state、读取素材目录，并把该目录记入最近列表
 * （先设置 workspace，素材读取失败也不至于丢失工作区本身）
 *
 * Picture 目录可能上万张图（移动端枚举要十几秒），
 * 因此不在这里读取，等用户打开图库时再列。
 */
async function adoptWorkspace(
  ws: WorkspaceInfo,
  set: (partial: (s: StoreState) => Partial<StoreState>) => void,
): Promise<void> {
  set(() => ({ workspace: ws, selectedPicture: null, pictures: [] }));
  const [sysAssets, faceAssets] = await Promise.all([
    listWorkspaceAssets(ws, 'System'),
    listWorkspaceAssets(ws, 'FaceSet'),
  ]);
  setWorkspaceAssets('System', sysAssets);
  setWorkspaceAssets('FaceSet', faceAssets);
  markAssetsRefreshed();
  if (ws.handle) await addRecentWorkspace(ws.handle);
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
  recentWorkspaces: [],
  theme: savedTheme ?? 'dark',
  // 导入的字体文件由 main.tsx 从 IndexedDB 恢复后加入
  customFonts: [],
  drawerOpen: false,
  pictures: [],
  selectedPicture: null,
  backgroundImageFileName: null,

  updateConfig: (updater) =>
    set((state) => ({
      config: updater(state.config),
    })),

  patchConfig: (partial) =>
    set((state) => ({
      config: { ...state.config, ...partial },
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

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

  addCustomFonts: (items) =>
    set((state) => {
      const incoming = items.filter(
        (it) =>
          !state.customFonts.some((p) => p.source === it.source && p.family === it.family),
      );
      if (incoming.length === 0) return {};
      return { customFonts: [...incoming, ...state.customFonts] };
    }),

  removeCustomFont: (family) =>
    set((state) => ({
      customFonts: state.customFonts.filter((f) => f.family !== family),
    })),

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
      if (ws) await adoptWorkspace(ws, set);
    } catch (e) {
      set({ workspaceError: e instanceof Error ? e.message : String(e) || '打开工作区失败' });
    } finally {
      set({ workspaceLoading: false });
      await loadRecentsInto(set);
    }
  },

  restoreWorkspace: async () => {
    try {
      const ws = await tryRestoreWorkspace();
      if (ws) await adoptWorkspace(ws, set);
    } catch {
      // 静默失败，不影响应用正常使用
    }
    await loadRecentsInto(set);
  },

  openRecentWorkspace: async (entry) => {
    if (get().workspaceLoading) return;
    const handle = entry.handle;

    // 已是当前工作区则无需重开
    const current = get().workspace?.handle;
    if (current && (await isSameDirectoryHandle(current, handle))) return;

    set({ workspaceLoading: true, workspaceError: null });
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'prompt') {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (permission !== 'granted') {
        set({ workspaceError: '未获得该目录的访问权限' });
        return;
      }
      await saveWorkspaceHandle(handle);
      await adoptWorkspace(
        { name: handle.name, handle, mode: 'filesystem', lastAccessed: Date.now() },
        set,
      );
    } catch (e) {
      // 目录被移动/删除等：从最近列表移除，避免留下无法打开的条目
      await removeRecentWorkspace(handle);
      set({ workspaceError: `该目录已不可用，已从最近列表移除（${String(e)}）` });
    } finally {
      set({ workspaceLoading: false });
      await loadRecentsInto(set);
    }
  },

  forgetRecentWorkspace: async (entry) => {
    await removeRecentWorkspace(entry.handle);
    await loadRecentsInto(set);
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

  toggleDrawer: () => {
    const willOpen = !get().drawerOpen;
    set({ drawerOpen: willOpen });
    // 图库关闭期间不会读取 Picture 目录，首次打开时才去枚举
    if (willOpen && get().pictures.length === 0) void get().refreshPictures();
  },

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

  applyReferenceBackground: (image, palette0, fileName) => {
    set((s) => ({
      backgroundImageFileName: fileName,
      config: {
        ...s.config,
        backgroundImage: image,
        // 更换图片时，重置 tile rect 为"左上角角框右下角的 2×2"
        backgroundImageTileRect: {
          x: s.config.backgroundImageCornerThickness,
          y: s.config.backgroundImageCornerThickness,
          w: 2,
          h: 2,
        },
        // 自动检测到调色板 idx-0 则默认启用透明色，否则不启用
        backgroundImageTransparentColor: palette0,
        backgroundImageUseTransparentColor: palette0 !== null,
      },
    }));
  },

  setPictureAsReference: (p) => {
    set({ selectedPicture: p });
    syncFollowTargetSize(p, get, set);
  },

  setPictureAsBackground: async (p) => {
    const { workspace } = get();
    if (!workspace) return false;
    try {
      const dataUrl = await readPictureDataUrl(workspace, p);
      const img = await loadImage(dataUrl);
      let palette0: string | null = null;
      try {
        palette0 = parsePalette0(dataUrlToBytes(dataUrl));
      } catch {
        // 解析失败时不启用透明色
      }
      get().applyReferenceBackground(img, palette0, p.fileName);
      set((s) => ({ config: { ...s.config, backgroundMode: 'image' } }));
      return true;
    } catch (e) {
      set({ workspaceError: String(e) || '读取图片失败' });
      return false;
    }
  },

  editPictureFromMeta: async (p) => {
    const { workspace } = get();
    if (!workspace) return { ok: false, message: '未打开工作区' };
    const meta = await readPictureMeta(workspace, p.fileName);
    if (!meta) return { ok: false, message: '不是由 mywin 创建的图片' };
    try {
      const restored = await buildConfigFromMeta(meta, workspace);
      set((s) => ({
        config: { ...s.config, ...restored.config },
        selectedPicture: p,
        backgroundImageFileName: restored.backgroundImageFileName,
      }));
      return {
        ok: true,
        message:
          restored.warnings.length > 0 ? restored.warnings.join('；') : '',
      };
    } catch (e) {
      return { ok: false, message: '读取参数失败' };
    }
  },
}));