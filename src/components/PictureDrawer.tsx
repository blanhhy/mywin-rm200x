// 替换模式抽屉：展示工作区 Picture 目录中的图片
// 单击选中（再次单击取消），选中后保存时将覆盖该图片
//
// Picture 目录可能有上万张图，桌面端与移动端策略不同：
//   桌面（读取快）：一次渲染全部条目，缩略图在后台异步逐个读取（并发 8）
//   移动（SAF 单次读取几百毫秒）：列表分批渲染，缩略图滚到可见区域才读取
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { pictureMetaExists } from '../engine/pictureMeta';
import Modal from './Modal';
import {
  isMobileBrowser,
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

/** 移动端每批渲染的图片数量 */
const PICTURE_PAGE_SIZE = 300;

/** 是否为移动端（UA 运行期间不会变化） */
const IS_MOBILE = isMobileBrowser();

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

/**
 * 缩略图
 * eager：挂载后立即读取（桌面端后台加载全部）
 * 否则等滚动到可见区域再读取（移动端）
 */
function PictureThumb({
  entry,
  workspace,
  eager,
}: {
  entry: PictureEntry;
  workspace: Workspace;
  eager: boolean;
}) {
  const [src, setSrc] = useState<string | null>(entry.dataUrl ?? null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 刷新列表（含覆盖图片后的刷新）会产生新的 entry 对象：
  // 丢弃旧缩略图，按新内容重新读取，否则图中显示的仍是覆盖前的像素
  useEffect(() => {
    setSrc(entry.dataUrl ?? null);
  }, [entry]);

  useEffect(() => {
    if (src) return;
    let cancelled = false;
    const load = () => {
      scheduleRead(() => readPictureDataUrl(workspace, entry))
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          // 读取失败保持占位
        });
    };

    const el = imgRef.current;
    if (eager || !el) {
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
  }, [src, entry, workspace, eager]);

  return (
    <img
      ref={imgRef}
      className={`picture-thumb ${src ? '' : 'placeholder'}`}
      src={src ?? undefined}
      alt={entry.fileName}
      draggable={false}
    />
  );
}

export default function PictureDrawer() {
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
  // 桌面端不截断：visibleCount 足够大即可一次渲染全部
  const [visibleCount, setVisibleCount] = useState(
    IS_MOBILE ? PICTURE_PAGE_SIZE : Number.MAX_SAFE_INTEGER,
  );
  /** 搜索框内容（回车/点搜索按钮才生效，不实时筛选） */
  const [queryInput, setQueryInput] = useState('');
  /** 已生效的搜索词 */
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pictures.filter((p) => p.fileName.toLowerCase().includes(q)) : pictures;
  }, [pictures, query]);

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

  // 绘制前恢复上次的滚动位置，避免闪烁
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (savedScroll.workspace !== workspace) {
      savedScroll = { workspace, scrollTop: 0 };
    }
    body.scrollTop = savedScroll.scrollTop;
  }, [workspace]);

  // 列表刷新或筛选条件变化后从头分批展示（移动端）
  useEffect(() => {
    if (IS_MOBILE) setVisibleCount(PICTURE_PAGE_SIZE);
  }, [pictures, query]);

  // 筛选条件变化时回到列表顶部（结果与原来的滚动位置无关）
  const scrollToTop = () => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = 0;
      savedScroll = { workspace, scrollTop: 0 };
    }
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

  const handleScroll = () => {
    const body = bodyRef.current;
    if (body) savedScroll = { workspace, scrollTop: body.scrollTop };
    // 接近底部时追加下一批（移动端）
    if (
      IS_MOBILE &&
      body &&
      visibleCount < filtered.length &&
      body.scrollTop + body.clientHeight >= body.scrollHeight - 400
    ) {
      setVisibleCount((n) => Math.min(n + PICTURE_PAGE_SIZE, filtered.length));
    }
  };

  return (
    <aside className="picture-drawer">
      <div className="picture-drawer-header">
        <div className="picture-drawer-titlebar">
          <span className="picture-drawer-title">Picture</span>
          <span className="picture-drawer-count">
            {query.trim()
              ? `${filtered.length} 张`
              : visibleCount < pictures.length
                ? `${visibleCount} / ${pictures.length} 张`
                : `${pictures.length} 张`}
          </span>
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
      <div className="picture-drawer-body" ref={bodyRef} onScroll={handleScroll}>
        {pictures.length === 0 ? (
          <div className="picture-empty">没有图片</div>
        ) : filtered.length === 0 ? (
          <div className="picture-empty">没有匹配的图片</div>
        ) : (
          <div className="picture-grid">
            {filtered.slice(0, visibleCount).map((p) => {
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
                    <PictureThumb entry={p} workspace={workspace} eager={!IS_MOBILE} />
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
