import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { loadImage } from '../../engine/messageWindow';
import { parsePalette0 } from '../../engine/transparentColorInference';
import { readPictureDataUrl } from '../../engine/workspace';
import { type BackgroundMode, type StretchMode, type SystemImageRef } from '../../types';
import SystemPicker, { type SystemPickerValue } from '../pickers/SystemPicker';
import BackgroundFrameEditor, { type TileRect } from '../BackgroundFrameEditor';

/** 将 data URL 解码为字节，用于解析图片格式与调色板 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function BackgroundTab() {
  const { config, updateConfig } = useStore();
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const [frameEditorOpen, setFrameEditorOpen] = useState(false);
  const [referenceDragOver, setReferenceDragOver] = useState(false);

  /** 应用可视化框选的结果：同时更新角框/边框厚度与底纹区域 */
  const handleFrameApply = (corner: number, edge: number, rect: TileRect) => {
    updateConfig((c) => ({
      ...c,
      backgroundImageCornerThickness: corner,
      backgroundImageEdgeThickness: edge,
      backgroundImageTileRect: rect,
    }));
  };

  const handleModeChange = (mode: BackgroundMode) => {
    updateConfig((c) => ({ ...c, backgroundMode: mode }));
  };

  const handleStretchChange = (mode: StretchMode) => {
    updateConfig((c) => ({ ...c, backgroundStretch: mode }));
  };

  const handleSystemApply = (value: SystemPickerValue) => {
    updateConfig((c) => ({
      ...c,
      backgroundSystem: {
        name: value.name,
        image: value.image,
        transparentColor: value.transparentColor,
      } as SystemImageRef,
    }));
  };

  /** 应用参考图片（上传与拖拽共用）：重置底纹推断区域，并按调色板初始化透明色 */
  const applyReferenceImage = (img: HTMLImageElement, palette0: string | null) => {
    updateConfig((c) => ({
      ...c,
      backgroundImage: img,
      // 更换图片时，重置 tile rect 为"左上角角框右下角的 2×2"
      backgroundImageTileRect: {
        x: c.backgroundImageCornerThickness,
        y: c.backgroundImageCornerThickness,
        w: 2,
        h: 2,
      },
      // 自动检测到调色板 idx-0 则默认启用透明色，否则不启用
      backgroundImageTransparentColor: palette0,
      backgroundImageUseTransparentColor: palette0 !== null,
    }));
  };

  const handleImageUpload = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);

    // 尝试从调色板提取 idx-0 作为透明色（PNG / BMP 同一条路径）
    let palette0: string | null = null;
    try {
      const buffer = await file.arrayBuffer();
      palette0 = parsePalette0(buffer);
    } catch {
      // 解析失败，不使用透明色
    }

    applyReferenceImage(img, palette0);
  };

  const handleReferenceDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    if (!e.dataTransfer.types.includes('application/x-mywin-picture')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setReferenceDragOver(true);
  };

  const handleReferenceDragLeave = () => setReferenceDragOver(false);

  const handleReferenceDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setReferenceDragOver(false);
    const fileName =
      e.dataTransfer.getData('application/x-mywin-picture') ||
      e.dataTransfer.getData('text/plain');
    if (!fileName) return;
    const pic = useStore.getState().pictures.find((p) => p.fileName === fileName);
    if (!pic) return;
    const workspace = useStore.getState().workspace;
    if (!workspace) return;

    let picDataUrl: string;
    try {
      picDataUrl = await readPictureDataUrl(workspace, pic);
    } catch {
      return;
    }
    const img = await loadImage(picDataUrl);
    // 解析调色板 idx-0 作为透明色（PNG / BMP 同一条路径）
    let palette0: string | null = null;
    try {
      palette0 = parsePalette0(dataUrlToBytes(picDataUrl));
    } catch {
      // 解析失败，不使用透明色
    }
    applyReferenceImage(img, palette0);
  };

  /** 角框边长（≤8）；底纹框若吸附在左上角角框上则跟着移动 */
  const handleCornerThickness = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isNaN(v)) return;
    const next = Math.max(0, Math.min(8, Math.floor(v)));
    updateConfig((c) => {
      const prev = c.backgroundImageCornerThickness;
      const current = c.backgroundImageTileRect;
      const tileRect = !current
        ? { x: next, y: next, w: 2, h: 2 }
        : current.x === prev && current.y === prev
          ? { ...current, x: next, y: next }
          : current;
      return {
        ...c,
        backgroundImageCornerThickness: next,
        backgroundImageTileRect: tileRect,
      };
    });
  };

  /** 边框厚度（≤16，四边同步） */
  const handleEdgeThickness = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isNaN(v)) return;
    updateConfig((c) => ({
      ...c,
      backgroundImageEdgeThickness: Math.max(0, Math.min(16, Math.floor(v))),
    }));
  };

  const handleTileRectChange = (
    key: 'x' | 'y' | 'w' | 'h',
    value: number,
  ) => {
    if (Number.isNaN(value)) return;
    updateConfig((c) => ({
      ...c,
      backgroundImageTileRect: {
        x: c.backgroundImageTileRect?.x ?? c.backgroundImageCornerThickness,
        y: c.backgroundImageTileRect?.y ?? c.backgroundImageCornerThickness,
        w: c.backgroundImageTileRect?.w ?? 2,
        h: c.backgroundImageTileRect?.h ?? 2,
        [key]: Math.max(1, Math.floor(value)),
      },
    }));
  };

  return (
    <div className="tab-content">
      <div className="field-group">
        <label className="field-label">背景模式</label>
        <div className="radio-stack">
          <label className="radio-row">
            <input
              type="radio"
              name="bg-mode"
              checked={config.backgroundMode === 'transparent'}
              onChange={() => handleModeChange('transparent')}
            />
            透明
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="bg-mode"
              checked={config.backgroundMode === 'system'}
              onChange={() => handleModeChange('system')}
            />
            系统背景
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="bg-mode"
              checked={config.backgroundMode === 'image'}
              onChange={() => handleModeChange('image')}
            />
            参考已有
          </label>
        </div>
      </div>

      {config.backgroundMode === 'system' && (
        <>
          <div className="field-group">
            <label className="field-label">System 图</label>
            <div className="picker-row">
              <button
                type="button"
                className="upload-btn"
                onClick={() => setSystemPickerOpen(true)}
                style={{ flex: 1, justifyContent: 'space-between' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {config.backgroundSystem.name ?? '- 空 -'}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>选择…</span>
              </button>
            </div>
            <div className="transparent-color-row">
              透明色：
              <input
                type="color"
                value={config.backgroundSystem.transparentColor}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    backgroundSystem: {
                      ...c.backgroundSystem,
                      transparentColor: e.target.value,
                    },
                  }))
                }
              />
              <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {config.backgroundSystem.transparentColor.toUpperCase()}
              </code>
            </div>
            {config.backgroundSystem.image && (
              <div className="system-preview">
                <img
                  src={
                    config.backgroundSystem.image instanceof HTMLImageElement
                      ? config.backgroundSystem.image.src
                      : ''
                  }
                  alt="System"
                  style={{ width: 160, height: 80, imageRendering: 'pixelated' }}
                />
              </div>
            )}
          </div>
        </>
      )}

      {config.backgroundMode === 'image' && (
        <>
          <div className="field-group">
            <label className="field-label">参考图片</label>
            <label
              className={`upload-btn ${referenceDragOver ? 'drag-over' : ''}`}
              onDragOver={handleReferenceDragOver}
              onDragLeave={handleReferenceDragLeave}
              onDrop={handleReferenceDrop}
            >
              选择 Message 图片或从右侧图库拖入…
              <input
                type="file"
                accept="image/png,image/bmp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f);
                }}
              />
            </label>
            {config.backgroundImage && (
              <div className="image-preview">
                <img
                  src={
                    config.backgroundImage instanceof HTMLImageElement
                      ? config.backgroundImage.src
                      : ''
                  }
                  alt="Background"
                  style={{ maxWidth: 200, imageRendering: 'pixelated' }}
                />
              </div>
            )}
          </div>
          <div className="field-group">
            <div className="checkbox-row">
              <input
                type="checkbox"
                checked={config.backgroundImageUseTransparentColor}
                onChange={(e) =>
                  updateConfig((c) => ({
                    ...c,
                    backgroundImageUseTransparentColor: e.target.checked,
                  }))
                }
                disabled={!config.backgroundImageTransparentColor}
              />
              <span>
                使用透明色
                {config.backgroundImageTransparentColor
                  ? `（${config.backgroundImageTransparentColor.toUpperCase()}）`
                  : '（未检测到调色板）'}
              </span>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">边框厚度</label>
            <div className="tile-rect-row">
              <label>
                角
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageCornerThickness}
                  onChange={handleCornerThickness}
                  min={0}
                  max={8}
                />
              </label>
              <label>
                边
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageEdgeThickness}
                  onChange={handleEdgeThickness}
                  min={0}
                  max={8}
                />
              </label>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">底纹推断</label>
            <small className="field-hint">
              仅支持重复的底纹，选择最小重复单位
            </small>
            <div className="tile-rect-row">
              <label>
                X
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.x ?? config.backgroundImageCornerThickness}
                  onChange={(e) => handleTileRectChange('x', Number(e.target.value))}
                  min={0}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.y ?? config.backgroundImageCornerThickness}
                  onChange={(e) => handleTileRectChange('y', Number(e.target.value))}
                  min={0}
                />
              </label>
              <label>
                宽
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.w ?? 2}
                  onChange={(e) => handleTileRectChange('w', Number(e.target.value))}
                  min={1}
                />
              </label>
              <label>
                高
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.h ?? 2}
                  onChange={(e) => handleTileRectChange('h', Number(e.target.value))}
                  min={1}
                />
              </label>
            </div>
            <button
              type="button"
              className="upload-btn frame-editor-open-btn"
              onClick={() => setFrameEditorOpen(true)}
              disabled={!config.backgroundImage}
              title="在放大的参照图上框选边框厚度与底纹区域"
            >
              可视化框选
            </button>
          </div>
        </>
      )}

      {config.backgroundMode !== 'transparent' && (
        <div className="field-group">
          <label className="field-label">绘制模式</label>
          <div className="radio-stack">
            <label className="radio-row">
              <input
                type="radio"
                name="stretch-mode"
                checked={config.backgroundStretch === 'stretch'}
                onChange={() => handleStretchChange('stretch')}
              />
              拉伸
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="stretch-mode"
                checked={config.backgroundStretch === 'tile'}
                onChange={() => handleStretchChange('tile')}
              />
              平铺
            </label>
          </div>
        </div>
      )}

      <SystemPicker
        open={systemPickerOpen}
        currentName={config.backgroundSystem.name}
        currentTransparentColor={config.backgroundSystem.transparentColor}
        onClose={() => setSystemPickerOpen(false)}
        onApply={handleSystemApply}
        title="选择背景 System 图"
      />

      <BackgroundFrameEditor
        open={frameEditorOpen}
        image={config.backgroundImage}
        cornerThickness={config.backgroundImageCornerThickness}
        edgeThickness={config.backgroundImageEdgeThickness}
        tileRect={config.backgroundImageTileRect}
        onClose={() => setFrameEditorOpen(false)}
        onApply={handleFrameApply}
      />
    </div>
  );
}
