import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { loadImage } from '../../engine/messageWindow';
import { parsePNGPalette0 } from '../../engine/transparentColorInference';
import { type BackgroundMode, type StretchMode, type SystemImageRef } from '../../types';
import SystemPicker, { type SystemPickerValue } from '../pickers/SystemPicker';

export default function BackgroundTab() {
  const { config, updateConfig } = useStore();
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);

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

  const handleImageUpload = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const t = config.backgroundImageBorderThickness;

    // 尝试从 PNG 调色板提取 idx-0 作为透明色
    let palette0: string | null = null;
    try {
      const buffer = await file.arrayBuffer();
      palette0 = parsePNGPalette0(buffer);
    } catch {
      // 非 PNG 或解析失败，不使用透明色
    }

    updateConfig((c) => ({
      ...c,
      backgroundImage: img,
      // 上传新图片时，重置 tile rect 为"边框内左上角 4×4"
      backgroundImageTileRect: { x: t, y: t, w: 4, h: 4 },
      // 自动检测到调色板 idx-0 则默认启用透明色，否则不启用
      backgroundImageTransparentColor: palette0,
      backgroundImageUseTransparentColor: palette0 !== null,
    }));
  };

  const handleBorderThickness = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v) && v >= 0) {
      const borderT = Math.floor(v);
      updateConfig((c) => {
        const current = c.backgroundImageTileRect;
        const hasImage = !!c.backgroundImage;
        let imgW = 0, imgH = 0;
        if (hasImage) {
          const img = c.backgroundImage as HTMLImageElement;
          imgW = img.naturalWidth || img.width;
          imgH = img.naturalHeight || img.height;
        }
        // 如果 tile rect 还没设置过（或与边框冲突），自动调整到"除去边框后的左上角"
        const needAuto = !current
          || current.x < borderT
          || current.y < borderT
          || (current.x + current.w > imgW - borderT && imgW > 0)
          || (current.y + current.h > imgH - borderT && imgH > 0);
        const tileRect = needAuto && imgW > 0 && imgH > 0
          ? { x: borderT, y: borderT, w: 4, h: 4 }
          : (current ?? { x: borderT, y: borderT, w: 4, h: 4 });
        return {
          ...c,
          backgroundImageBorderThickness: borderT,
          backgroundImageTileRect: tileRect,
        };
      });
    }
  };

  const handleTileRectChange = (
    key: 'x' | 'y' | 'w' | 'h',
    value: number,
  ) => {
    if (Number.isNaN(value)) return;
    updateConfig((c) => ({
      ...c,
      backgroundImageTileRect: {
        x: c.backgroundImageTileRect?.x ?? c.backgroundImageBorderThickness,
        y: c.backgroundImageTileRect?.y ?? c.backgroundImageBorderThickness,
        w: c.backgroundImageTileRect?.w ?? 4,
        h: c.backgroundImageTileRect?.h ?? 4,
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
            <label className="upload-btn">
              选择一张Message窗口图片...
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
            <input
              type="number"
              className="number-input"
              value={config.backgroundImageBorderThickness}
              onChange={handleBorderThickness}
              min={0}
              max={16}
            />
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
                  value={config.backgroundImageTileRect?.x ?? config.backgroundImageBorderThickness}
                  onChange={(e) => handleTileRectChange('x', Number(e.target.value))}
                  min={0}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.y ?? config.backgroundImageBorderThickness}
                  onChange={(e) => handleTileRectChange('y', Number(e.target.value))}
                  min={0}
                />
              </label>
              <label>
                宽
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.w ?? 4}
                  onChange={(e) => handleTileRectChange('w', Number(e.target.value))}
                  min={1}
                />
              </label>
              <label>
                高
                <input
                  type="number"
                  className="number-input"
                  value={config.backgroundImageTileRect?.h ?? 4}
                  onChange={(e) => handleTileRectChange('h', Number(e.target.value))}
                  min={1}
                />
              </label>
            </div>
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
    </div>
  );
}
