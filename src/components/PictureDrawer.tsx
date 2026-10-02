// 替换模式抽屉：展示工作区 Picture 目录中的图片
// 单击选中（再次单击取消），选中后保存时将覆盖该图片
import { useLayoutEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

// 抽屉开合时会卸载重建，用模块级变量保留滚动位置
// 以工作区实例为键：关闭工作区后再次打开会重置
let savedScroll: { workspace: unknown; scrollTop: number } = {
  workspace: null,
  scrollTop: 0,
};

export default function PictureDrawer() {
  const pictures = useStore((s) => s.pictures);
  const selectedPicture = useStore((s) => s.selectedPicture);
  const togglePictureSelection = useStore((s) => s.togglePictureSelection);
  const refreshPictures = useStore((s) => s.refreshPictures);
  const workspace = useStore((s) => s.workspace);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 绘制前恢复上次的滚动位置，避免闪烁
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (savedScroll.workspace !== workspace) {
      savedScroll = { workspace, scrollTop: 0 };
    }
    body.scrollTop = savedScroll.scrollTop;
  }, [workspace]);

  const handleScroll = () => {
    const body = bodyRef.current;
    if (body) savedScroll = { workspace, scrollTop: body.scrollTop };
  };

  return (
    <aside className="picture-drawer">
      <div className="picture-drawer-header">
        <span className="picture-drawer-title">Picture</span>
        <span className="picture-drawer-count">{pictures.length} 张</span>
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
            {pictures.map((p) => {
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
                  <img className="picture-thumb" src={p.dataUrl} alt={p.fileName} draggable={false} />
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