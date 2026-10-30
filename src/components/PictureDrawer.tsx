// 替换模式抽屉：展示工作区 Picture 目录中的图片
// 单击选中（再次单击取消），选中后保存时将覆盖该图片
//
// Picture 目录可能有上万张图：列表按行虚拟化，只挂载视口附近的行；
// 缩略图滚到可见区域才读取，并用 canvas 缩到格子尺寸
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { loadImage } from '../engine/messageWindow';
import { pictureMetaExists } from '../engine/pictureMeta';
import Modal from './Modal';
import {
  readPictureDataUrl,
  type PictureEntry,
  type Workspace,
} from '../engine/workspace';

// 抽屉开合时会卸载重建，用模块级变量保留滚动位置
// 以工作区实例为键：关闭工作区后再次打开会重置
let savedScroll: { workspace: unknown; scrollTop: number } = {
  workspace: null,
  scrollTop: 0,
};

// 同理保留搜索状态：关闭再打开抽屉时筛选条件与滚动进度都还在
let savedSearch: { workspace: unknown; input: string; query: string } = {
  workspace: null,
  input: '',
  query: '',
};

/** 网格间距与最小列宽，与 App.css 中 .picture-grid 保持一致 */
const GRID_GAP = 8;
const MIN_CELL_W = 96;
/** .picture-drawer-body 的左右/内边距 */
const BODY_PADDING = 12;
/**
 * 条目中除缩略图以外的高度：
 * 上下 padding 4×2 + 上下边框 1×2 + 缩略图与名称间隔 4 + 名称行高 10×1.3
 */
const ITEM_CHROME_H = 27;
/** 缩略图可用宽度（含 padding/边框时被扣掉的部分） */
const ITEM_CHROME_W = 10;
/** 视口上下额外多渲染的行数，避免快速滚动时露白 */
const OVERSCAN_ROWS = 2;

// 共享的可见性观察器：避免为每张图片单独创建 observer
const visibilityCallbacks = new Map<Element, () => void>();
let sharedObserver: IntersectionObserver | null = null;

function observeVisible(el: Element, cb: () => void): void {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = visibilityCallbacks.get(entry.target);
          if (!callback) continue;
          visibilityCallbacks.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
          callback();
        }
      },
      { root: null, rootMargin: '300px 0px' },
    );
  }
  visibilityCallbacks.set(el, cb);
  sharedObserver.observe(el);
}

function unobserveVisible(el: Element): void {
  visibilityCallbacks.delete(el);
  sharedObserver?.unobserve(el);
}

// 桌面端一次性排队读取全部缩略图，限制并发，避免同时发起上万个文件读取
const MAX_CONCURRENT_READS = 8;
const readWaiters: (() => void)[] = [];
let activeReads = 0;

function scheduleRead<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeReads += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeReads -= 1;
          readWaiters.shift()?.();
        });
    };
    if (activeReads < MAX_CONCURRENT_READS) run();
    else readWaiters.push(run);
  });
}

/** 缩略图最长边：与格子宽度一致，且只缩小不放大 */
const THUMB_MAX_EDGE = 96;

/**
 * 缩略图缓存
 * 以 entry 对象为键：刷新列表会重建 entry，缓存随之失效，
 * 覆盖图片后能正确显示新内容。
 */
const thumbCache = new WeakMap<PictureEntry, string>();

/**
 * 把原图缩到缩略图尺寸
 * 原图本来就不大时直接用原图，避免解码后又放大
 */
async function buildThumb(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return dataUrl;
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(w, h));
  if (scale >= 1) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  // 像素画缩放：与列表里 image-rendering: pixelated 的观感保持一致
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * 缩略图：滚动到可见区域才读取/解码
 * （几千张图时，打开抽屉只需要处理首屏那几十张）
 *
 * memo：图库因选中项等状态重渲染时，不重复解码已有缩略图
 */
const PictureThumb = memo(function PictureThumb({
  entry,
  workspace,
}: {
  entry: PictureEntry;
  workspace: Workspace;
}) {
  const [src, setSrc] = useState<string | null>(() => thumbCache.get(entry) ?? null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 刷新列表（含覆盖图片后的刷新）会产生新的 entry 对象：
  // 丢弃旧缩略图，按新内容重新生成
  useEffect(() => {
    setSrc(thumbCache.get(entry) ?? null);
  }, [entry]);

  useEffect(() => {
    if (src) return;
    let cancelled = false;
    const load = () => {
      scheduleRead(async () => {
        const cached = thumbCache.get(entry);
        if (cached) return cached;
        const full = entry.dataUrl ?? (await readPictureDataUrl(workspace, entry));
        const thumb = await buildThumb(full);
        thumbCache.set(entry, thumb);
        return thumb;
      })
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          // 读取失败保持占位
        });
    };

    const el = imgRef.current;
    if (!el) {
      load();
      return () => {
        cancelled = true;
      };
    }

    observeVisible(el, load);
    return () => {
      cancelled = true;
      unobserveVisible(el);
    };
  }, [src, entry, workspace]);

  return (
    <img
      ref={imgRef}
      className={`picture-thumb ${src ? '' : 'placeholder'}`}
      src={src ?? undefined}
      alt={entry.fileName}
      decoding="async"
      draggable={false}
    />
  );
});

// memo：上层（App）因其它状态重渲染时不必重建整个图库
function PictureDrawer() {
  const pictures = useStore((s) => s.pictures);
  const selectedPicture = useStore((s) => s.selectedPicture);
  const togglePictureSelection = useStore((s) => s.togglePictureSelection);
  const refreshPictures = useStore((s) => s.refreshPictures);
  const workspace = useStore((s) => s.workspace);
  const editPictureFromMeta = useStore((s) => s.editPictureFromMeta);
  const setPictureAsReference = useStore((s) => s.setPictureAsReference);
  const setPictureAsBackground = useStore((s) => s.setPictureAsBackground);
  const checkPictureMeta = useStore((s) => s.checkPictureMeta);
  const deletePicture = useStore((s) => s.deletePicture);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 网格几何：列数、行高与可视区高度（由容器实际尺寸测得） */
  const [geom, setGeom] = useState<{ cols: number; rowH: number; viewH: number } | null>(null);
  /** 内容区已滚动的距离（桌面取 body.scrollTop，移动端布局由页面滚动换算） */
  const [scrollTop, setScrollTop] = useState(0);
  /** 首次恢复滚动位置之后，滚动时才写回 savedScroll */
  const restoredRef = useRef(false);
  /** 搜索框内容（回车/点搜索按钮才生效，不实时筛选） */
  const [queryInput, setQueryInput] = useState(() =>
    savedSearch.workspace === workspace ? savedSearch.input : '',
  );
  /** 已生效的搜索词 */
  const [query, setQuery] = useState(() =>
    savedSearch.workspace === workspace ? savedSearch.query : '',
  );

  // 记住搜索状态，供关闭再打开时恢复
  useEffect(() => {
    savedSearch = { workspace, input: queryInput, query };
  }, [workspace, queryInput, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pictures.filter((p) => p.fileName.toLowerCase().includes(q)) : pictures;
  }, [pictures, query]);

  // 只渲染视口附近的行；上下用等高的占位块维持滚动条长度
  const rowPitch = geom ? geom.rowH + GRID_GAP : 0;
  const totalRows = geom ? Math.ceil(filtered.length / geom.cols) : 0;
  const firstRow = geom
    ? Math.max(0, Math.floor(scrollTop / rowPitch) - OVERSCAN_ROWS)
    : 0;
  const lastRow = geom
    ? Math.min(totalRows, Math.ceil((scrollTop + geom.viewH) / rowPitch) + OVERSCAN_ROWS)
    : 0;
  const visiblePictures = geom
    ? filtered.slice(firstRow * geom.cols, Math.min(filtered.length, lastRow * geom.cols))
    : [];

  /** 右键 / 长按菜单 */
  const [menu, setMenu] = useState<{ x: number; y: number; picture: PictureEntry } | null>(null);
  /** 删除确认弹窗的目标（hasMeta 决定是否显示“撤回到编辑器”） */
  const [deleteTarget, setDeleteTarget] = useState<{
    picture: PictureEntry;
    hasMeta: boolean;
  } | null>(null);
  /** 删除前是否先把参数应用回编辑器 */
  const [restoreParams, setRestoreParams] = useState(false);
  /** 勾选撤回时正在读取参数 */
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** 操作结果提示 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 长按已弹出菜单时，随后的 click 不应触发选中切换 */
  const suppressClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // 关闭菜单：点菜单外任意处或滚动
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  useEffect(() => clearLongPress, []);

  // 提示几秒后自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openMenu = (x: number, y: number, picture: PictureEntry) => {
    // 菜单尺寸固定，靠近视口边缘时向内收，避免长按在屏幕角落时菜单被截断
    const MENU_W = 180;
    const MENU_H = 150;
    const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8));
    suppressClickRef.current = true;
    setMenu({ x: left, y: top, picture });
  };

  const handleMenuAction = async (
    action: 'edit' | 'reference' | 'background' | 'delete',
  ) => {
    if (!menu) return;
    const picture = menu.picture;
    setMenu(null);
    // 成功不打扰；只有出错或部分参数恢复不了才提示
    if (action === 'edit') {
      const result = await editPictureFromMeta(picture);
      if (result.message) setNotice(result.message);
    } else if (action === 'reference') {
      setPictureAsReference(picture);
    } else if (action === 'background') {
      const ok = await setPictureAsBackground(picture);
      if (!ok) setNotice(`无法读取 ${picture.fileName}，无法设为背景`);
    } else {
      const hasMeta = workspace ? await pictureMetaExists(workspace, picture.fileName) : false;
      setRestoreParams(false);
      setDeleteTarget({ picture, hasMeta });
    }
  };

  // 勾选时只检查参数能否读入；读不出来则自动取消勾选并提示
  const handleRestoreToggle = async (checked: boolean) => {
    if (!deleteTarget) return;
    if (!checked) {
      setRestoreParams(false);
      return;
    }
    setRestoreParams(true);
    setRestoreBusy(true);
    const result = await checkPictureMeta(deleteTarget.picture);
    setRestoreBusy(false);
    if (!result.ok) {
      setRestoreParams(false);
      setNotice(result.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const result = await deletePicture(
      deleteTarget.picture,
      restoreParams && deleteTarget.hasMeta,
    );
    setDeleteBusy(false);
    setDeleteTarget(null);
    if (result.message) setNotice(result.message);
  };

  // 测量网格几何（列数 → 格子宽 → 行高），并跟踪滚动位置
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (savedScroll.workspace !== workspace) {
      savedScroll = { workspace, scrollTop: 0 };
    }

    const update = () => {
      const rect = body.getBoundingClientRect();
      const innerW = Math.max(0, body.clientWidth - BODY_PADDING * 2);
      const cols = Math.max(1, Math.floor((innerW + GRID_GAP) / (MIN_CELL_W + GRID_GAP)));
      const cellW = (innerW - (cols - 1) * GRID_GAP) / cols;
      const rowH = (cellW - ITEM_CHROME_W) * 0.75 + ITEM_CHROME_H;
      // 桌面布局：body 自身滚动；移动端布局：body 高度自适应、随页面滚动
      const scrollable = body.scrollHeight > body.clientHeight + 1;
      const visibleTop = Math.max(rect.top, 0);
      const visibleBottom = Math.min(rect.bottom, window.innerHeight);
      const nextTop = scrollable
        ? body.scrollTop
        : Math.max(0, visibleTop - rect.top - BODY_PADDING);
      const viewH = scrollable ? body.clientHeight : Math.max(0, visibleBottom - visibleTop);

      setGeom((prev) =>
        prev &&
        prev.cols === cols &&
        Math.abs(prev.rowH - rowH) < 0.5 &&
        prev.viewH === viewH
          ? prev
          : { cols, rowH, viewH },
      );
      setScrollTop((prev) => (Math.abs(prev - nextTop) < 1 ? prev : nextTop));
      if (restoredRef.current) {
        savedScroll = { workspace, scrollTop: nextTop };
      }
    };

    update();

    // 滚动与尺寸变化合并到一帧内测量，避免滚动时反复触发布局
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    // 捕获阶段监听：既覆盖 body 自身滚动，也覆盖移动端页面滚动
    window.addEventListener('scroll', schedule, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [workspace]);

  // 几何生效后内容高度才建立，这时才能恢复上次的滚动位置（否则会被夹成 0）
  useLayoutEffect(() => {
    if (restoredRef.current || !geom) return;
    const body = bodyRef.current;
    if (!body) return;
    restoredRef.current = true;
    if (savedScroll.scrollTop > 0) {
      body.scrollTop = savedScroll.scrollTop;
      setScrollTop(body.scrollTop);
      savedScroll = { workspace, scrollTop: body.scrollTop };
    }
  }, [geom, workspace]);

  // 筛选条件变化时回到列表顶部（结果与原来的滚动位置无关）
  const scrollToTop = () => {
    const body = bodyRef.current;
    if (body) body.scrollTop = 0;
    setScrollTop(0);
    savedScroll = { workspace, scrollTop: 0 };
  };

  const applySearch = () => {
    setQuery(queryInput);
    scrollToTop();
  };

  const clearSearch = () => {
    setQueryInput('');
    setQuery('');
    scrollToTop();
  };

  return (
    <aside className="picture-drawer">
      <div className="picture-drawer-header">
        <div className="picture-drawer-titlebar">
          <span className="picture-drawer-title">Picture</span>
          <span className="picture-drawer-count">{filtered.length} 张</span>
          <div className="picture-drawer-actions">
            <button
              className="picture-refresh-btn"
              onClick={clearSearch}
              disabled={!query && !queryInput}
              title="清除搜索"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M3 12h9M3 18h9" />
                <path d="M15 12l6 6 M21 12l-6 6" />
              </svg>
            </button>
            <button
              className="picture-refresh-btn"
              onClick={() => refreshPictures()}
              title="刷新列表"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17.66 6.34A8 8 0 1 1 12 4" />
                <path d="M9.12 2.6L12 4l-1.88 2.59" />
              </svg>
            </button>
          </div>
        </div>
        <form
          className="picture-search"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <input
            className="picture-search-input"
            type="text"
            placeholder="搜索图片名称..."
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
          <button className="picture-search-btn" type="submit" title="搜索">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.2 15.2L20 20" />
            </svg>
          </button>
        </form>
      </div>
      <div className="picture-drawer-body" ref={bodyRef}>
        {pictures.length === 0 ? (
          <div className="picture-empty">没有图片</div>
        ) : filtered.length === 0 ? (
          <div className="picture-empty">没有匹配的图片</div>
        ) : (
          <>
            {firstRow > 0 && <div style={{ height: firstRow * rowPitch }} />}
            <div className="picture-grid">
              {visiblePictures.map((p) => {
                const selected = selectedPicture?.fileName === p.fileName;
                return (
                  <button
                    key={p.fileName}
                    className={`picture-item ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      // 长按菜单已经把这次点击消费掉了，不再切换选中
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      togglePictureSelection(p);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e.clientX, e.clientY, p);
                    }}
                    onPointerDown={(e) => {
                      // 触屏长按弹出菜单；鼠标用右键
                      if (e.pointerType === 'mouse') return;
                      clearLongPress();
                      longPressTimerRef.current = window.setTimeout(() => {
                        longPressTimerRef.current = null;
                        openMenu(e.clientX, e.clientY, p);
                      }, 500);
                    }}
                    onPointerMove={clearLongPress}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    draggable
                    onDragStart={(e) => {
                      // 供【背景】页"参考已有"模式接收
                      e.dataTransfer.setData('application/x-mywin-picture', p.fileName);
                      e.dataTransfer.setData('text/plain', p.fileName);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    {workspace ? (
                      <PictureThumb entry={p} workspace={workspace} />
                    ) : (
                      <img
                        className="picture-thumb"
                        src={p.dataUrl}
                        alt={p.fileName}
                        draggable={false}
                      />
                    )}
                    <span className="picture-name">{p.fileName}</span>
                  </button>
                );
              })}
            </div>
            {totalRows - lastRow > 0 && (
              <div style={{ height: (totalRows - lastRow) * rowPitch }} />
            )}
          </>
        )}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="picture-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button role="menuitem" onClick={() => handleMenuAction('edit')}>
            重新编辑
          </button>
          <button role="menuitem" onClick={() => handleMenuAction('reference')}>
            设为参考
          </button>
          <button role="menuitem" onClick={() => handleMenuAction('background')}>
            设为背景
          </button>
          <button role="menuitem" onClick={() => handleMenuAction('delete')}>
            删除图片
          </button>
        </div>
      )}
      <Modal
        open={deleteTarget !== null}
        title="删除图片"
        onClose={() => setDeleteTarget(null)}
        width={420}
        footer={
          <>
            <button className="modal-btn" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button
              className="modal-btn danger-solid"
              onClick={confirmDelete}
              disabled={deleteBusy || restoreBusy}
            >
              删除
            </button>
          </>
        }
      >
        <div className="delete-picture-body">
          <p>
            确定删除 <strong>{deleteTarget?.picture.fileName}</strong> 吗？删除后无法恢复。
          </p>
          {deleteTarget?.hasMeta && (
            <>
              <p>这张图片带有 mywin 保存的创建参数，删除图片时会一并清除参数。</p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={restoreParams}
                  disabled={restoreBusy}
                  onChange={(e) => handleRestoreToggle(e.target.checked)}
                />
                撤回到 mywin 编辑器（删除前先应用它的参数）
              </label>
            </>
          )}
        </div>
      </Modal>
      {notice && (
        <div className="picture-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </aside>
  );
}

export default memo(PictureDrawer);
