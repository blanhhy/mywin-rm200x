// 替换模式抽屉：展示工作区 Picture 目录中的图片
// 单击选中（再次单击取消），选中后保存时将覆盖该图片
//
// Picture 目录可能有上万张图：
//   1. 缩略图只在滚动到可见区域时才从磁盘读取（共享一个 IntersectionObserver）
//   2. 列表分批渲染（滚动接近底部时追加），避免一次挂载上万个节点
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { readPictureDataUrl, type PictureEntry, type Workspace } from '../engine/workspace';

// 抽屉开合时会卸载重建，用模块级变量保留滚动位置
// 以工作区实例为键：关闭工作区后再次打开会重置
let savedScroll: { workspace: unknown; scrollTop: number } = {
  workspace: null,
  scrollTop: 0,
};

/** 每批渲染的图片数量 */
const PICTURE_PAGE_SIZE = 300;

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

/** 缩略图：滚动到可见区域后才读取文件 */
function PictureThumb({
  entry,
  workspace,
}: {
  entry: PictureEntry;
  workspace: Workspace;
}) {
  const [src, setSrc] = useState<string | null>(entry.dataUrl ?? null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (src) return;
    const el = imgRef.current;
    if (!el) return;
    let cancelled = false;
    observeVisible(el, () => {
      readPictureDataUrl(workspace, entry)
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          // 读取失败保持占位
        });
    });
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PICTURE_PAGE_SIZE);

  // 绘制前恢复上次的滚动位置，避免闪烁
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (savedScroll.workspace !== workspace) {
      savedScroll = { workspace, scrollTop: 0 };
    }
    body.scrollTop = savedScroll.scrollTop;
  }, [workspace]);

  // 列表刷新后从头分批展示
  useEffect(() => {
    setVisibleCount(PICTURE_PAGE_SIZE);
  }, [pictures]);

  const handleScroll = () => {
    const body = bodyRef.current;
    if (body) savedScroll = { workspace, scrollTop: body.scrollTop };
    // 接近底部时追加下一批
    if (
      body &&
      visibleCount < pictures.length &&
      body.scrollTop + body.clientHeight >= body.scrollHeight - 400
    ) {
      setVisibleCount((n) => Math.min(n + PICTURE_PAGE_SIZE, pictures.length));
    }
  };

  return (
    <aside className="picture-drawer">
      <div className="picture-drawer-header">
        <span className="picture-drawer-title">Picture</span>
        <span className="picture-drawer-count">
          {visibleCount < pictures.length
            ? `${visibleCount} / ${pictures.length} 张`
            : `${pictures.length} 张`}
        </span>
        <button
          className="picture-refresh-btn"
          onClick={() => refreshPictures()}
          title="刷新列表"
        >
          ⟳
        </button>
      </div>
      <div className="picture-drawer-body" ref={bodyRef} onScroll={handleScroll}>
        <p className="picture-drawer-hint">
          单击选中 Picture 目录中的图片，再次单击取消选中。<br />
          选中后保存将<b>覆盖</b>该图片。
        </p>
        {pictures.length === 0 ? (
          <div className="picture-empty">没有图片</div>
        ) : (
          <div className="picture-grid">
            {pictures.slice(0, visibleCount).map((p) => {
              const selected = selectedPicture?.fileName === p.fileName;
              return (
                <button
                  key={p.fileName}
                  className={`picture-item ${selected ? 'selected' : ''}`}
                  onClick={() => togglePictureSelection(p)}
                  title={selected ? `${p.fileName}（单击取消选中）` : `选中以替换：${p.fileName}`}
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
        )}
      </div>
    </aside>
  );
}
