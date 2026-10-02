// 替换模式抽屉：展示工作区 Picture 目录中的图片
// 单击选中（再次单击取消），选中后保存时将覆盖该图片
import { useStore } from '../store/useStore';

export default function PictureDrawer() {
  const pictures = useStore((s) => s.pictures);
  const selectedPicture = useStore((s) => s.selectedPicture);
  const togglePictureSelection = useStore((s) => s.togglePictureSelection);
  const refreshPictures = useStore((s) => s.refreshPictures);

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
      <div className="picture-drawer-body">
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
                >
                  <img className="picture-thumb" src={p.dataUrl} alt={p.fileName} />
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