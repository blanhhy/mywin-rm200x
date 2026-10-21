// 工作区引擎：使用 File System Access API 或 webkitdirectory 管理本地文件夹
//
// 工作区目录结构：
//   <workspace>/
//     System/          — System 图素材
//     FaceSet/         — FaceSet 素材
//     Picture/         — 导出的消息窗口图片
//
// 两种模式：
//   1. filesystem — 使用 File System Access API（桌面 Chrome/Edge）
//      showDirectoryPicker() 选择文件夹，FileSystemDirectoryHandle 持久化到 IndexedDB
//   2. virtual — 使用 webkitdirectory + IndexedDB（桌面 Firefox/Safari 等）
//      <input type="file" webkitdirectory> 选择文件夹，文件数据存储到 IndexedDB
//      下次打开页面时自动从 IndexedDB 恢复
//      注意：移动端浏览器的选择器会忽略 webkitdirectory（只能选文件），
//      因此移动端只有在支持 showDirectoryPicker 时才能使用工作区

import type { AssetCategory, AssetEntry } from './assetLoader';

/** 工作区模式 */
export type WorkspaceMode = 'filesystem' | 'virtual';

/** 工作区信息 */
export interface Workspace {
  /** 文件夹名称 */
  name: string;
  /** 文件夹句柄（仅 filesystem 模式） */
  handle?: FileSystemDirectoryHandle;
  /** 工作区模式 */
  mode: WorkspaceMode;
  /** 上次使用时间 */
  lastAccessed: number;
}

const INDEXEDDB_NAME = 'mywin-workspace';
const INDEXEDDB_STORE = 'handles';
const INDEXEDDB_KEY = 'workspace';
const VIRTUAL_META_STORE = 'virtual-meta';
const VIRTUAL_FILES_STORE = 'virtual-files';
const VIRTUAL_META_KEY = 'meta';

const REQUIRED_DIRS = ['System', 'FaceSet', 'Picture'] as const;

/** 工作区素材并发读取数（移动端 SAF 单次读取较慢，适度并发能明显缩短等待） */
const ASSET_READ_CONCURRENCY = 8;

// === IndexedDB 持久化（共用） ===

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INDEXEDDB_NAME, 2);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(INDEXEDDB_STORE);
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(VIRTUAL_META_STORE);
        db.createObjectStore(VIRTUAL_FILES_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- filesystem 模式句柄 ---

export async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE, 'readwrite');
    tx.objectStore(INDEXEDDB_STORE).put(handle, INDEXEDDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE, 'readonly');
    const req = tx.objectStore(INDEXEDDB_STORE).get(INDEXEDDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE, 'readwrite');
    tx.objectStore(INDEXEDDB_STORE).delete(INDEXEDDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- 最近打开的工作区 ---
//
// 只对 filesystem 模式有意义：句柄可以复用，因此能直接重新打开。
// virtual 模式（webkitdirectory）拿不到句柄，重新打开必须再次选择文件夹。
// 注意：API 不提供完整路径，只能拿到文件夹名。

const RECENTS_KEY = 'workspace-recents';
const MAX_RECENT_WORKSPACES = 5;

/** 最近打开的工作区条目 */
export interface RecentWorkspace {
  /** 文件夹名（浏览器不提供完整路径） */
  name: string;
  /** 目录句柄，可用于重新打开 */
  handle: FileSystemDirectoryHandle;
  lastAccessed: number;
}

async function loadRecentList(): Promise<RecentWorkspace[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE, 'readonly');
    const req = tx.objectStore(INDEXEDDB_STORE).get(RECENTS_KEY);
    req.onsuccess = () => resolve((req.result as RecentWorkspace[] | undefined) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecentList(list: RecentWorkspace[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE, 'readwrite');
    tx.objectStore(INDEXEDDB_STORE).put(list, RECENTS_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 判断两个句柄是否指向同一目录（失效句柄视为不同） */
export async function isSameDirectoryHandle(
  a: FileSystemDirectoryHandle,
  b: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    return await a.isSameEntry(b);
  } catch {
    return false;
  }
}

/** 列出最近打开的工作区（按最近使用排序） */
export async function listRecentWorkspaces(): Promise<RecentWorkspace[]> {
  try {
    return await loadRecentList();
  } catch {
    return [];
  }
}

/** 记录一次最近打开的工作区（去重后置顶，最多保留 MAX_RECENT_WORKSPACES 条） */
export async function addRecentWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  const list = await loadRecentList();
  const kept: RecentWorkspace[] = [];
  for (const item of list) {
    if (!(await isSameDirectoryHandle(item.handle, handle))) kept.push(item);
  }
  kept.unshift({ name: handle.name, handle, lastAccessed: Date.now() });
  await saveRecentList(kept.slice(0, MAX_RECENT_WORKSPACES));
}

/** 从最近列表移除某个工作区（目录失效时清理） */
export async function removeRecentWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  const list = await loadRecentList();
  const kept: RecentWorkspace[] = [];
  for (const item of list) {
    if (!(await isSameDirectoryHandle(item.handle, handle))) kept.push(item);
  }
  await saveRecentList(kept);
}

// --- virtual 模式元数据与文件 ---

interface VirtualMeta {
  name: string;
  lastAccessed: number;
}

interface VirtualFile {
  name: string;
  dataUrl: string;
}

async function saveVirtualMeta(meta: VirtualMeta): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_META_STORE, 'readwrite');
    tx.objectStore(VIRTUAL_META_STORE).put(meta, VIRTUAL_META_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadVirtualMeta(): Promise<VirtualMeta | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_META_STORE, 'readonly');
    const req = tx.objectStore(VIRTUAL_META_STORE).get(VIRTUAL_META_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearVirtualData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([VIRTUAL_META_STORE, VIRTUAL_FILES_STORE], 'readwrite');
    tx.objectStore(VIRTUAL_META_STORE).clear();
    tx.objectStore(VIRTUAL_FILES_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function storeVirtualFile(key: string, file: VirtualFile): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FILES_STORE, 'readwrite');
    tx.objectStore(VIRTUAL_FILES_STORE).put(file, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteVirtualFile(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FILES_STORE, 'readwrite');
    tx.objectStore(VIRTUAL_FILES_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listVirtualFiles(
  prefix: string,
): Promise<{ key: string; name: string; dataUrl: string }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIRTUAL_FILES_STORE, 'readonly');
    const req = tx.objectStore(VIRTUAL_FILES_STORE).openCursor();
    const results: { key: string; name: string; dataUrl: string }[] = [];
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null;
      if (cursor) {
        const key = cursor.key as string;
        if (key.startsWith(prefix)) {
          const value = cursor.value as VirtualFile;
          results.push({ key, name: value.name, dataUrl: value.dataUrl });
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// === 辅助函数 ===

async function ensureDir(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(name, { create: true });
}

/**
 * 并发执行并限制同时在跑的任务数
 * 单个失败不会中断整体，对应位置返回 null
 */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function listPngFiles(
  dir: FileSystemDirectoryHandle,
): Promise<{ name: string; file: FileSystemFileHandle }[]> {
  const results: { name: string; file: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && /\.(png|PNG|bmp|BMP)$/.test(name)) {
      results.push({ name, file: handle as FileSystemFileHandle });
    }
  }
  return results;
}

async function fileHandleToDataUrl(
  fileHandle: FileSystemFileHandle,
): Promise<string> {
  const file = await fileHandle.getFile();
  return readFileAsDataUrl(file);
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// === 公开 API ===

/** 是否为移动端浏览器（移动端的选择器无法选文件夹） */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  if (uaData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * 检查浏览器是否支持工作区功能
 * 优先检测 File System Access API，回退检测 webkitdirectory
 *
 * 移动端不纳入支持范围：Android/iOS 的文件选择器会忽略 webkitdirectory，
 * 只会返回单个文件（webkitRelativePath 为空），无法表达"打开一个文件夹"。
 */
export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if ('showDirectoryPicker' in window) return true;
  if (isMobileBrowser()) return false;
  const input = document.createElement('input');
  return 'webkitdirectory' in input;
}

/**
 * 尝试从 IndexedDB 恢复工作区（不需要用户交互）
 * 优先恢复 filesystem 模式，其次恢复 virtual 模式
 */
export async function tryRestoreWorkspace(): Promise<Workspace | null> {
  // 1. 尝试恢复 filesystem 模式
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    const saved = await loadHandle();
    if (saved) {
      let permission: PermissionState;
      try {
        permission = await saved.queryPermission({ mode: 'read' });
      } catch {
        // 句柄已失效，清理后放弃恢复
        await clearHandle();
        permission = 'denied';
      }
      // 权限为 prompt 时无法在没有用户手势的情况下恢复，
      // 此时保留句柄，让用户从"最近打开"里手动重开
      if (permission === 'granted') {
        return {
          name: saved.name,
          handle: saved,
          mode: 'filesystem',
          lastAccessed: Date.now(),
        };
      }
      return null;
    }
  }

  // 2. 尝试恢复 virtual 模式
  // 移动端的选择器无法选文件夹，不会再有可用的虚拟工作区；
  // 同时忽略旧版本在移动端误建的"文件即文件夹"元数据
  if (isMobileBrowser()) return null;
  const virtualMeta = await loadVirtualMeta();
  if (virtualMeta) {
    return {
      name: virtualMeta.name,
      mode: 'virtual',
      lastAccessed: virtualMeta.lastAccessed,
    };
  }

  return null;
}

/**
 * 打开工作区：让用户选择文件夹（始终弹出选择器）
 * 支持 showDirectoryPicker 的浏览器（含 Android Chrome）走文件系统模式，
 * 其余桌面浏览器回退到 webkitdirectory
 */
export async function openWorkspace(): Promise<Workspace | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('当前浏览器不支持文件夹访问，请使用 Chrome/Edge 最新版本');
  }

  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    return openWorkspaceViaFileSystem();
  }
  return openWorkspaceViaInput();
}

async function openWorkspaceViaFileSystem(): Promise<Workspace | null> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });
  } catch (e) {
    // 用户取消选择：不算错误
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }

  // 目录创建失败要暴露出来，否则用户只会看到"点了没反应"
  try {
    for (const dir of REQUIRED_DIRS) {
      await ensureDir(handle, dir);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`无法在工作区「${handle.name}」中创建素材目录（${reason}）`);
  }

  await saveHandle(handle);
  return {
    name: handle.name,
    handle,
    mode: 'filesystem',
    lastAccessed: Date.now(),
  };
}

function openWorkspaceViaInput(): Promise<Workspace | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');

    // 用户取消时 resolve(null)
    input.addEventListener('cancel', () => resolve(null));

    input.onchange = async () => {
      try {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) {
          resolve(null);
          return;
        }

        // 选到文件夹时每个文件都带相对路径；只有文件没有路径，说明当前
        // 浏览器的选择器忽略了 webkitdirectory，不能把文件名当成文件夹名
        if (!files.some((f) => f.webkitRelativePath)) {
          reject(
            new Error(
              '当前浏览器无法选择文件夹（只能选择文件）。请使用桌面版 Chrome/Edge，或在移动端直接导入素材',
            ),
          );
          return;
        }

        // 从第一个文件的相对路径提取文件夹名
        const firstPath = files[0].webkitRelativePath || files[0].name;
        const folderName = firstPath.split('/')[0] || 'workspace';

        // 清除之前的虚拟工作区数据
        await clearVirtualData();

        // 读取文件夹中的素材文件
        for (const file of files) {
          const relPath = file.webkitRelativePath || file.name;
          const parts = relPath.split('/');
          // 期望路径格式：folderName/Subdir/filename.png
          if (parts.length >= 3) {
            const subdir = parts[1];
            if (subdir === 'System' || subdir === 'FaceSet' || subdir === 'Picture') {
              const fileName = parts.slice(2).join('/');
              if (/\.(png|PNG|bmp|BMP)$/.test(fileName)) {
                const dataUrl = await readFileAsDataUrl(file);
                const cleanName = fileName.replace(/\.[^.]+$/, '');
                await storeVirtualFile(`${subdir}/${fileName}`, {
                  name: cleanName,
                  dataUrl,
                });
              }
            }
          }
        }

        const meta = { name: folderName, lastAccessed: Date.now() };
        await saveVirtualMeta(meta);

        resolve({ name: folderName, mode: 'virtual', lastAccessed: Date.now() });
      } catch (e) {
        reject(e);
      }
    };

    input.click();
  });
}

/**
 * 关闭工作区（清除所有持久化数据）
 */
export async function closeWorkspace(): Promise<void> {
  await clearHandle();
  await clearVirtualData();
}

/**
 * 列出工作区中指定类别的素材
 */
export async function listWorkspaceAssets(
  workspace: Workspace,
  category: AssetCategory,
): Promise<AssetEntry[]> {
  if (workspace.mode === 'virtual') {
    return listVirtualWorkspaceAssets(category);
  }
  return listFilesystemWorkspaceAssets(workspace, category);
}

async function listFilesystemWorkspaceAssets(
  workspace: Workspace,
  category: AssetCategory,
): Promise<AssetEntry[]> {
  if (!workspace.handle) return [];
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const dir = await workspace.handle.getDirectoryHandle(dirName, { create: true });
  const files = await listPngFiles(dir);

  // 单次读取在移动端 SAF 上要几百毫秒，全部串行会让素材列表迟迟出不来
  const read = await mapLimited<{ name: string; file: FileSystemFileHandle }, AssetEntry>(
    files,
    ASSET_READ_CONCURRENCY,
    async ({ name, file }) => {
      const dataUrl = await fileHandleToDataUrl(file);
      return {
        name: name.replace(/\.[^.]+$/, ''),
        path: `${dirName}/${name}`,
        url: dataUrl,
        category,
        source: 'workspace',
        dataUrl,
      };
    },
  );

  return read.filter((a): a is AssetEntry => a !== null).sort((a, b) => a.name.localeCompare(b.name));
}

async function listVirtualWorkspaceAssets(
  category: AssetCategory,
): Promise<AssetEntry[]> {
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const files = await listVirtualFiles(`${dirName}/`);
  return files
    .map((f) => ({
      name: f.name,
      path: f.key,
      url: f.dataUrl,
      category,
      source: 'workspace' as const,
      dataUrl: f.dataUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 保存素材到工作区
 */
export async function saveAssetToWorkspace(
  workspace: Workspace,
  category: AssetCategory,
  file: File,
): Promise<AssetEntry> {
  if (workspace.mode === 'virtual') {
    return saveAssetToVirtual(category, file);
  }
  return saveAssetToFilesystem(workspace, category, file);
}

async function saveAssetToFilesystem(
  workspace: Workspace,
  category: AssetCategory,
  file: File,
): Promise<AssetEntry> {
  if (!workspace.handle) throw new Error('工作区句柄不可用');
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const dir = await ensureDir(workspace.handle, dirName);

  const ext = file.name.match(/\.(png|PNG|bmp|BMP)$/)?.[1] ?? 'png';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  let fileName = `${baseName}.${ext}`;
  let counter = 2;

  let existing = await dir.getFileHandle(fileName).catch(() => null);
  while (existing) {
    fileName = `${baseName}_${counter}.${ext}`;
    existing = await dir.getFileHandle(fileName).catch(() => null);
    counter++;
  }

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const buf = await file.arrayBuffer();
  await writable.write(buf);
  await writable.close();

  const dataUrl = await fileHandleToDataUrl(fileHandle);
  const cleanName = fileName.replace(/\.[^.]+$/, '');

  return {
    name: cleanName,
    path: `${dirName}/${fileName}`,
    url: dataUrl,
    category,
    source: 'workspace' as const,
    dataUrl,
  };
}

async function saveAssetToVirtual(
  category: AssetCategory,
  file: File,
): Promise<AssetEntry> {
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const ext = file.name.match(/\.(png|PNG|bmp|BMP)$/)?.[1] ?? 'png';
  const baseName = file.name.replace(/\.[^.]+$/, '');

  // 检查重名
  const existing = await listVirtualFiles(`${dirName}/`);
  let fileName = `${baseName}.${ext}`;
  let counter = 2;
  while (existing.some((f) => f.key === `${dirName}/${fileName}`)) {
    fileName = `${baseName}_${counter}.${ext}`;
    counter++;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const cleanName = fileName.replace(/\.[^.]+$/, '');
  const key = `${dirName}/${fileName}`;
  await storeVirtualFile(key, { name: cleanName, dataUrl });

  return {
    name: cleanName,
    path: key,
    url: dataUrl,
    category,
    source: 'workspace' as const,
    dataUrl,
  };
}

/**
 * 从工作区删除素材
 */
export async function removeAssetFromWorkspace(
  workspace: Workspace,
  category: AssetCategory,
  name: string,
): Promise<boolean> {
  if (workspace.mode === 'virtual') {
    return removeAssetFromVirtual(category, name);
  }
  return removeAssetFromFilesystem(workspace, category, name);
}

async function removeAssetFromFilesystem(
  workspace: Workspace,
  category: AssetCategory,
  name: string,
): Promise<boolean> {
  if (!workspace.handle) return false;
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const dir = await workspace.handle.getDirectoryHandle(dirName, { create: true });

  for await (const [fileName, handle] of dir.entries()) {
    if (handle.kind === 'file' && fileName.replace(/\.[^.]+$/, '') === name) {
      await dir.removeEntry(fileName);
      return true;
    }
  }
  return false;
}

async function removeAssetFromVirtual(
  category: AssetCategory,
  name: string,
): Promise<boolean> {
  const dirName = category === 'System' ? 'System' : 'FaceSet';
  const files = await listVirtualFiles(`${dirName}/`);
  const target = files.find((f) => f.name === name);
  if (target) {
    await deleteVirtualFile(target.key);
    return true;
  }
  return false;
}

/**
 * 导出 PNG 到工作区 Picture 目录
 * virtual 模式下存储到 IndexedDB 并触发下载
 */
export async function exportToWorkspace(
  workspace: Workspace,
  filename: string,
  pngData: Uint8Array,
): Promise<string> {
  if (workspace.mode === 'virtual') {
    return exportFromVirtual(filename, pngData);
  }
  return exportToFilesystem(workspace, filename, pngData);
}

async function exportToFilesystem(
  workspace: Workspace,
  filename: string,
  pngData: Uint8Array,
): Promise<string> {
  if (!workspace.handle) throw new Error('工作区句柄不可用');
  const picDir = await getPictureDir(workspace);

  let finalName = filename.endsWith('.png') ? filename : `${filename}.png`;
  let counter = 2;
  let existing = await picDir.getFileHandle(finalName).catch(() => null);
  while (existing) {
    const base = finalName.replace(/\.png$/, '');
    finalName = `${base}_${counter}.png`;
    existing = await picDir.getFileHandle(finalName).catch(() => null);
    counter++;
  }

  const fileHandle = await picDir.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  const buf = pngData.buffer.slice(
    pngData.byteOffset,
    pngData.byteOffset + pngData.byteLength,
  ) as ArrayBuffer;
  await writable.write(buf);
  await writable.close();

  return finalName;
}

async function exportFromVirtual(
  filename: string,
  pngData: Uint8Array,
): Promise<string> {
  let finalName = filename.endsWith('.png') ? filename : `${filename}.png`;

  // 检查重名
  const existing = await listVirtualFiles('Picture/');
  let counter = 2;
  while (existing.some((f) => f.key === `Picture/${finalName}`)) {
    const base = finalName.replace(/\.png$/, '');
    finalName = `${base}_${counter}.png`;
    counter++;
  }

  // 存储到 IndexedDB
  const blob = new Blob([pngData.buffer.slice(
    pngData.byteOffset,
    pngData.byteOffset + pngData.byteLength,
  ) as ArrayBuffer], { type: 'image/png' });
  const dataUrl = await blobToDataUrl(blob);
  const cleanName = finalName.replace(/\.[^.]+$/, '');
  await storeVirtualFile(`Picture/${finalName}`, { name: cleanName, dataUrl });

  // 同时触发下载（虚拟模式无法直接写入文件系统）
  downloadBlob(blob, finalName);

  return finalName;
}

// === Picture 目录（替换模式） ===

/** Picture 目录中的图片条目 */
export interface PictureEntry {
  /** 完整文件名（含扩展名），如 "mywin-123.png" / "System.bmp" */
  fileName: string;
  /**
   * 可直接用于 img.src 的 dataURL。
   * filesystem 模式下不预先读取（大目录可能有上万张图），
   * 需要时调用 readPictureDataUrl 读取并回填。
   */
  dataUrl?: string;
}

/** 按扩展名判断 Picture 条目是否可用作覆盖目标 */
function isPictureFile(name: string): boolean {
  return /\.(png|bmp)$/i.test(name);
}

/** 按扩展名给出 MIME 类型（virtual 模式下 dataURL 需要正确的类型才能解码） */
function mimeFromFileName(fileName: string): string {
  return /\.bmp$/i.test(fileName) ? 'image/bmp' : 'image/png';
}

/**
 * 列出工作区 Picture 目录中的图片
 * 覆盖时按目标文件的扩展名写入同名格式（PNG / BMP），因此两者都能列为目标
 */
export async function listWorkspacePictures(
  workspace: Workspace,
): Promise<PictureEntry[]> {
  if (workspace.mode === 'virtual') {
    const files = await listVirtualFiles('Picture/');
    return files
      .map((f) => ({
        fileName: f.key.slice('Picture/'.length),
        dataUrl: f.dataUrl,
      }))
      .filter((p) => isPictureFile(p.fileName))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  if (!workspace.handle) return [];
  const dir = await getPictureDir(workspace);
  // 只枚举文件名：RPG 工程的 Picture 目录可能有上万张图，
  // 逐个读取数据会耗尽内存并让移动端长时间无响应
  const results: PictureEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && isPictureFile(name)) {
      results.push({ fileName: name });
    }
  }
  return results.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/**
 * 取得 Picture 目录句柄并缓存
 * 移动端 SAF 每次 getDirectoryHandle 都要好几秒，缩略图逐张读取时不能反复取
 */
const pictureDirCache = new WeakMap<Workspace, Promise<FileSystemDirectoryHandle>>();

function getPictureDir(workspace: Workspace): Promise<FileSystemDirectoryHandle> {
  if (!workspace.handle) return Promise.reject(new Error('工作区句柄不可用'));
  let cached = pictureDirCache.get(workspace);
  if (!cached) {
    cached = workspace.handle.getDirectoryHandle('Picture', { create: true });
    pictureDirCache.set(workspace, cached);
  }
  return cached.catch((e) => {
    pictureDirCache.delete(workspace);
    throw e;
  });
}

/**
 * 按需读取 Picture 条目的 dataURL（filesystem 模式）
 * 读取结果会回填到 entry.dataUrl 作为缓存
 */
export async function readPictureDataUrl(
  workspace: Workspace,
  entry: PictureEntry,
): Promise<string> {
  if (entry.dataUrl) return entry.dataUrl;
  const dir = await getPictureDir(workspace);
  const fileHandle = await dir.getFileHandle(entry.fileName);
  const dataUrl = await fileHandleToDataUrl(fileHandle);
  entry.dataUrl = dataUrl;
  return dataUrl;
}

/**
 * 覆盖 Picture 目录中的指定图片
 * virtual 模式下会同时触发下载
 */
export async function overwritePictureInWorkspace(
  workspace: Workspace,
  fileName: string,
  pngData: Uint8Array,
): Promise<string> {
  if (workspace.mode === 'virtual') {
    return overwriteVirtualPicture(fileName, pngData);
  }
  if (!workspace.handle) throw new Error('工作区句柄不可用');
  const picDir = await getPictureDir(workspace);
  const fileHandle = await picDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const buf = pngData.buffer.slice(
    pngData.byteOffset,
    pngData.byteOffset + pngData.byteLength,
  ) as ArrayBuffer;
  await writable.write(buf);
  await writable.close();
  return fileName;
}

async function overwriteVirtualPicture(
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  const blob = new Blob([data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer], { type: mimeFromFileName(fileName) });
  const dataUrl = await blobToDataUrl(blob);
  const cleanName = fileName.replace(/\.[^.]+$/, '');
  await storeVirtualFile(`Picture/${fileName}`, { name: cleanName, dataUrl });
  // 虚拟模式无法直接写入文件系统，触发下载
  downloadBlob(blob, fileName);
  return fileName;
}

/**
 * 请求工作区写权限（仅 filesystem 模式需要）
 */
export async function requestWorkspacePermission(
  workspace: Workspace,
): Promise<boolean> {
  if (workspace.mode === 'virtual') return true;
  if (!workspace.handle) return false;
  const result = await workspace.handle.requestPermission({ mode: 'readwrite' });
  return result === 'granted';
}
