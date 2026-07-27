// 工作区引擎：使用 File System Access API 或 webkitdirectory 管理本地文件夹
//
// 工作区目录结构：
//   <workspace>/
//     System/          — System 图素材
//     Faceset/         — FaceSet 素材
//     Picture/         — 导出的消息窗口图片
//
// 两种模式：
//   1. filesystem — 使用 File System Access API（桌面 Chrome/Edge）
//      showDirectoryPicker() 选择文件夹，FileSystemDirectoryHandle 持久化到 IndexedDB
//   2. virtual — 使用 webkitdirectory + IndexedDB（移动端等其他浏览器）
//      <input type="file" webkitdirectory> 选择文件夹，文件数据存储到 IndexedDB
//      下次打开页面时自动从 IndexedDB 恢复

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

const REQUIRED_DIRS = ['System', 'Faceset', 'Picture'] as const;

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

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
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

/**
 * 检查浏览器是否支持工作区功能
 * 优先检测 File System Access API，回退检测 webkitdirectory
 */
export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if ('showDirectoryPicker' in window) return true;
  // webkitdirectory 回退（移动端 Chrome/Edge/Firefox/Safari 均支持）
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
      try {
        await saved.queryPermission('read');
        return {
          name: saved.name,
          handle: saved,
          mode: 'filesystem',
          lastAccessed: Date.now(),
        };
      } catch {
        await clearHandle();
      }
    }
  }

  // 2. 尝试恢复 virtual 模式
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
 * 桌面端使用 showDirectoryPicker，移动端使用 webkitdirectory
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
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });
    const workspace: Workspace = {
      name: handle.name,
      handle,
      mode: 'filesystem',
      lastAccessed: Date.now(),
    };
    await saveHandle(handle);
    for (const dir of REQUIRED_DIRS) {
      await ensureDir(handle, dir);
    }
    return workspace;
  } catch {
    return null;
  }
}

function openWorkspaceViaInput(): Promise<Workspace | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');

    // 用户取消时 resolve(null)
    input.addEventListener('cancel', () => resolve(null));

    input.onchange = async () => {
      if (!input.files || input.files.length === 0) {
        resolve(null);
        return;
      }

      // 从第一个文件的相对路径提取文件夹名
      const firstPath = input.files[0].webkitRelativePath || input.files[0].name;
      const folderName = firstPath.split('/')[0] || 'workspace';

      // 清除之前的虚拟工作区数据
      await clearVirtualData();

      // 读取文件夹中的素材文件
      for (const file of Array.from(input.files)) {
        const relPath = file.webkitRelativePath || file.name;
        const parts = relPath.split('/');
        // 期望路径格式：folderName/Subdir/filename.png
        if (parts.length >= 3) {
          const subdir = parts[1];
          if (subdir === 'System' || subdir === 'Faceset' || subdir === 'Picture') {
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
  const dirName = category === 'System' ? 'System' : 'Faceset';
  const dir = await workspace.handle.getDirectoryHandle(dirName, { create: true });
  const files = await listPngFiles(dir);
  const assets: AssetEntry[] = [];

  for (const { name, file } of files) {
    try {
      const dataUrl = await fileHandleToDataUrl(file);
      const cleanName = name.replace(/\.[^.]+$/, '');
      assets.push({
        name: cleanName,
        path: `${dirName}/${name}`,
        url: dataUrl,
        category,
        source: 'workspace' as const,
        dataUrl,
      });
    } catch {
      // 忽略无法读取的文件
    }
  }

  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

async function listVirtualWorkspaceAssets(
  category: AssetCategory,
): Promise<AssetEntry[]> {
  const dirName = category === 'System' ? 'System' : 'Faceset';
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
  const dirName = category === 'System' ? 'System' : 'Faceset';
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
  const dirName = category === 'System' ? 'System' : 'Faceset';
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
  const dirName = category === 'System' ? 'System' : 'Faceset';
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
  const dirName = category === 'System' ? 'System' : 'Faceset';
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
  const picDir = await ensureDir(workspace.handle, 'Picture');

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

/**
 * 请求工作区写权限（仅 filesystem 模式需要）
 */
export async function requestWorkspacePermission(
  workspace: Workspace,
): Promise<boolean> {
  if (workspace.mode === 'virtual') return true;
  if (!workspace.handle) return false;
  const result = await workspace.handle.requestPermission('readwrite');
  return result === 'granted';
}
