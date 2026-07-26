// RTP 资源加载器与运行时素材库
//
// 资源分两类：
//   1. built-in RTP 素材：随应用打包，来自 assets/RTP/{System,FaceSet}/*.png
//   2. user-added 素材：用户在运行时通过模态框"新增素材"导入，持久化到 localStorage
//
// 选择器组件通过 subscribe() 监听列表变化，无需手动刷新。

export type AssetCategory = 'System' | 'FaceSet';

export interface AssetEntry {
  /** 不含扩展名的素材名，如 "System" / "Royal" / "my-import" */
  name: string;
  /** 相对路径（仅 built-in 有效），如 "RTP/System/System.png" */
  path: string;
  /** 可直接用于 img.src 的 URL */
  url: string;
  category: AssetCategory;
  /** 来源：built-in 随应用打包；user 由用户导入（持久化） */
  source: 'builtin' | 'user';
  /** 用户素材的 dataURL（仅 source='user' 时有效，用于持久化） */
  dataUrl?: string;
}

// === 构建时收集 built-in RTP 素材 ===
// 路径相对于本文件 src/engine/assetLoader.ts：
//   ../../ → 项目根，再进入 assets/RTP/...
const systemModules = import.meta.glob('../../assets/RTP/System/*.{png,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const facesetModules = import.meta.glob('../../assets/RTP/FaceSet/*.{png,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function toBuiltinEntries(
  modules: Record<string, string>,
  category: AssetCategory,
): AssetEntry[] {
  return Object.entries(modules)
    .map(([path, url]) => {
      const fileName = path.split('/').pop() ?? '';
      const name = fileName.replace(/\.[^.]+$/, '');
      // path 形如 '../../assets/RTP/System/System.png'，去掉前导 '../' 序列得到 'assets/...'
      const relPath = path.replace(/^(?:\.\.\/)+/, '');
      return { name, path: relPath, url, category, source: 'builtin' as const };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const BUILTIN_SYSTEM: AssetEntry[] = toBuiltinEntries(systemModules, 'System');
const BUILTIN_FACESET: AssetEntry[] = toBuiltinEntries(facesetModules, 'FaceSet');

// === 用户素材持久化 ===
const STORAGE_KEY_SYSTEM = 'mywin:user-assets:system';
const STORAGE_KEY_FACESET = 'mywin:user-assets:faceset';

interface SerializedUserAsset {
  name: string;
  dataUrl: string;
}

function loadUserAssets(category: AssetCategory): AssetEntry[] {
  const key = category === 'System' ? STORAGE_KEY_SYSTEM : STORAGE_KEY_FACESET;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SerializedUserAsset[];
    return arr.map((s) => ({
      name: s.name,
      path: '',
      url: s.dataUrl,
      category,
      source: 'user' as const,
      dataUrl: s.dataUrl,
    }));
  } catch {
    return [];
  }
}

function saveUserAssets(category: AssetCategory, assets: AssetEntry[]): void {
  const key = category === 'System' ? STORAGE_KEY_SYSTEM : STORAGE_KEY_FACESET;
  const arr: SerializedUserAsset[] = assets.map((a) => ({
    name: a.name,
    dataUrl: a.dataUrl ?? a.url,
  }));
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // localStorage 配额可能不足（图片较大）
    console.warn('保存用户素材失败：', e);
  }
}

// === 运行时素材库（可订阅） ===
let userSystemAssets: AssetEntry[] = loadUserAssets('System');
let userFaceSetAssets: AssetEntry[] = loadUserAssets('FaceSet');

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyChange(): void {
  for (const l of listeners) l();
}

function makeUniqueName(base: string, existing: AssetEntry[]): string {
  // 去除扩展名
  const clean = base.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5\-_]/g, '_');
  if (!existing.some((a) => a.name === clean)) return clean;
  // 加数字后缀
  for (let i = 2; ; i++) {
    const candidate = `${clean}_${i}`;
    if (!existing.some((a) => a.name === candidate)) return candidate;
  }
}

/** 读取 File 为 dataURL */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// === 公开 API ===

/** 列出指定类别的全部素材（built-in + user） */
export function listAssets(category: AssetCategory): AssetEntry[] {
  const user = category === 'System' ? userSystemAssets : userFaceSetAssets;
  return [...BUILTIN_SYSTEM_OR_FACESET(category), ...user];
}

function BUILTIN_SYSTEM_OR_FACESET(category: AssetCategory): AssetEntry[] {
  return category === 'System' ? BUILTIN_SYSTEM : BUILTIN_FACESET;
}

/** 兼容旧导出名称 */
export const SYSTEM_ASSETS: AssetEntry[] = BUILTIN_SYSTEM;
export const FACESET_ASSETS: AssetEntry[] = BUILTIN_FACESET;

/** 按 name 查找素材 */
export function findAsset(category: AssetCategory, name: string): AssetEntry | null {
  return listAssets(category).find((a) => a.name === name) ?? null;
}

/** 获取素材 URL */
export function getAssetUrl(category: AssetCategory, name: string): string | null {
  return findAsset(category, name)?.url ?? null;
}

/** 列出所有 RTP System 素材名 */
export function listSystemAssets(): string[] {
  return listAssets('System').map((a) => a.name);
}

/** 列出所有 RTP FaceSet 素材名 */
export function listFaceSetAssets(): string[] {
  return listAssets('FaceSet').map((a) => a.name);
}

/**
 * 新增用户素材
 * @returns 新增的 AssetEntry；若名称冲突会自动加数字后缀
 */
export async function addUserAsset(
  category: AssetCategory,
  file: File,
): Promise<AssetEntry> {
  const dataUrl = await readFileAsDataURL(file);
  const existing = category === 'System' ? userSystemAssets : userFaceSetAssets;
  const name = makeUniqueName(file.name, existing);
  const entry: AssetEntry = {
    name,
    path: '',
    url: dataUrl,
    category,
    source: 'user',
    dataUrl,
  };
  if (category === 'System') {
    userSystemAssets = [...userSystemAssets, entry];
    saveUserAssets('System', userSystemAssets);
  } else {
    userFaceSetAssets = [...userFaceSetAssets, entry];
    saveUserAssets('FaceSet', userFaceSetAssets);
  }
  notifyChange();
  return entry;
}

/** 删除用户素材（不能删除 built-in） */
export function removeUserAsset(category: AssetCategory, name: string): boolean {
  if (category === 'System') {
    const before = userSystemAssets.length;
    userSystemAssets = userSystemAssets.filter((a) => a.name !== name);
    if (userSystemAssets.length === before) return false;
    saveUserAssets('System', userSystemAssets);
  } else {
    const before = userFaceSetAssets.length;
    userFaceSetAssets = userFaceSetAssets.filter((a) => a.name !== name);
    if (userFaceSetAssets.length === before) return false;
    saveUserAssets('FaceSet', userFaceSetAssets);
  }
  notifyChange();
  return true;
}

/** 订阅素材库变化 */
export function subscribeAssets(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
