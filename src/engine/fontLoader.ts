// 字体文件注册与持久化
//
// 导入的字体文件与 User 级素材行为一致：
//   导入后进入字体列表、刷新页面仍在、可删除。
// 字体文件动辄数 MB，base64 后超出了 localStorage 配额，所以二进制放在 IndexedDB。
//
// 内存占用上做懒加载：启动时只读元数据（family / label）建列表，
// 真正选中某个字体时才把字体数据读出来注册 FontFace。

import type { CustomFontEntry } from '../types';

const DB_NAME = 'mywin-user-fonts';
const DB_VERSION = 2;
/** 字体数据：family -> { family, label, data } */
const FONT_STORE = 'fonts';
/** 字体元数据：family -> { family, label } */
const META_STORE = 'meta';

interface StoredFont {
  family: string;
  label: string;
  /** 字体文件二进制内容 */
  data: ArrayBuffer;
}

interface StoredFontMeta {
  family: string;
  label: string;
}

/** 本会话已注册的 FontFace（删除字体时需要从 document.fonts 里移除） */
const registered = new Map<string, FontFace>();

/** 复用一个数据库连接，避免每次操作都新建连接 */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FONT_STORE)) {
        db.createObjectStore(FONT_STORE, { keyPath: 'family' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'family' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** 等待事务完成 */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 只读取元数据，不加载字体二进制 */
async function getAllMeta(): Promise<StoredFontMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredFontMeta[]);
    req.onerror = () => reject(req.error);
  });
}

/** 按需读取某个字体的二进制数据 */
async function getFontData(family: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(FONT_STORE, 'readonly').objectStore(FONT_STORE).get(family);
    req.onsuccess = () => resolve(req.result ? (req.result as StoredFont).data : null);
    req.onerror = () => reject(req.error);
  });
}

async function putFont(font: StoredFont): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
  tx.objectStore(FONT_STORE).put(font);
  tx.objectStore(META_STORE).put({ family: font.family, label: font.label });
  await done(tx);
}

async function deleteFont(family: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FONT_STORE, META_STORE], 'readwrite');
  tx.objectStore(FONT_STORE).delete(family);
  tx.objectStore(META_STORE).delete(family);
  await done(tx);
}

/** 把字体二进制注册为可用的 font-family */
async function registerFace(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  registered.set(family, face);
}

/** 启动时恢复字体列表（只读元数据，不加载字体文件） */
export async function listStoredFonts(): Promise<CustomFontEntry[]> {
  try {
    const meta = await getAllMeta();
    return meta.map((f) => ({ source: 'file' as const, label: f.label, family: f.family }));
  } catch (e) {
    console.warn('读取用户字体失败：', e);
    return [];
  }
}

/** 选中字体时按需加载：从 IndexedDB 取出字体数据并注册 FontFace */
export async function ensureFontLoaded(family: string): Promise<void> {
  if (registered.has(family)) return;
  const data = await getFontData(family);
  if (!data) throw new Error('字体数据不存在');
  await registerFace(family, data);
}

/** 按文件名生成稳定的 font-family 名（同族名去重） */
function makeFamily(fileName: string, existing: StoredFontMeta[]): string {
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
 * 导入字体文件：持久化到 IndexedDB 并注册 FontFace
 * @returns 可直接用于字体列表与 CSS font-family 的条目
 */
export async function importUserFont(file: File): Promise<CustomFontEntry> {
  const data = await file.arrayBuffer();
  const family = makeFamily(file.name, await getAllMeta().catch(() => []));
  await registerFace(family, data);
  await putFont({ family, label: file.name, data });
  return { source: 'file', label: file.name, family };
}

/** 删除导入的字体（同时清理 IndexedDB 与已注册的 FontFace） */
export async function removeUserFont(family: string): Promise<void> {
  await deleteFont(family).catch((e) => console.warn('删除用户字体失败：', e));
  const face = registered.get(family);
  if (face) {
    document.fonts.delete(face);
    registered.delete(family);
  }
}
