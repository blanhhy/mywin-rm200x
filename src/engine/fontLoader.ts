// 字体文件注册与持久化
//
// 导入的字体文件与 User 级素材行为一致：
//   导入后进入字体列表、刷新页面仍在、可删除。
// 区别只是存储介质：字体文件动辄数 MB，base64 后会超出 localStorage 配额，
// 因此二进制数据放在 IndexedDB，而不是像图片素材那样用 dataURL。

import type { CustomFontEntry } from '../types';

const DB_NAME = 'mywin-user-fonts';
const STORE_NAME = 'fonts';

interface StoredFont {
  family: string;
  label: string;
  /** 字体文件二进制内容 */
  data: ArrayBuffer;
}

/** 本会话已注册的 FontFace（删除字体时需要从 document.fonts 里移除） */
const registered = new Map<string, FontFace>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'family' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllStored(): Promise<StoredFont[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as StoredFont[]);
    req.onerror = () => reject(req.error);
  });
}

async function putStored(font: StoredFont): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(font);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteStored(family: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(family);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 把字体二进制注册为可用的 font-family */
async function registerFace(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  registered.set(family, face);
}

/** 启动时恢复持久化的字体：重新注册 FontFace，并返回列表条目 */
export async function registerStoredFonts(): Promise<CustomFontEntry[]> {
  let stored: StoredFont[] = [];
  try {
    stored = await getAllStored();
  } catch (e) {
    console.warn('读取用户字体失败：', e);
    return [];
  }
  const entries: CustomFontEntry[] = [];
  for (const f of stored) {
    entries.push({ source: 'file', label: f.label, family: f.family });
    if (registered.has(f.family)) continue;
    try {
      await registerFace(f.family, f.data);
    } catch (e) {
      console.warn(`注册字体"${f.label}"失败：`, e);
    }
  }
  return entries;
}

/** 按文件名生成稳定的 font-family 名（同族名去重） */
function makeFamily(fileName: string, existing: StoredFont[]): string {
  const base =
    `mywin-font-${fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'font'}`;
  const used = new Set(existing.map((f) => f.family));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * 导入字体文件：注册 FontFace 并持久化到 IndexedDB
 * @returns 可直接用于字体列表与 CSS font-family 的条目
 */
export async function importUserFont(file: File): Promise<CustomFontEntry> {
  const data = await file.arrayBuffer();
  const family = makeFamily(file.name, await getAllStored().catch(() => []));
  await registerFace(family, data);
  await putStored({ family, label: file.name, data });
  return { source: 'file', label: file.name, family };
}

/** 删除导入的字体（同时清理 IndexedDB 与已注册的 FontFace） */
export async function removeUserFont(family: string): Promise<void> {
  await deleteStored(family).catch((e) => console.warn('删除用户字体失败：', e));
  const face = registered.get(family);
  if (face) {
    document.fonts.delete(face);
    registered.delete(family);
  }
}
