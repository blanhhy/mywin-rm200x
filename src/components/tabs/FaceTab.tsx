import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { type FaceMode, type FacePosition, type FaceSetRef } from '../../types';
import FaceSetPicker, { type FaceSetPickerValue } from '../pickers/FaceSetPicker';

export default function FaceTab() {
  const { config, updateConfig } = useStore();
  const [facesetPickerOpen, setFacesetPickerOpen] = useState(false);

  // 脸图仅在标准窗口下启用（用户需求）
  const disabled = !config.standardWindow;

  const handleModeChange = (mode: FaceMode) => {
    updateConfig((c) => ({ ...c, faceMode: mode }));
  };

  const handleFaceSetApply = (value: FaceSetPickerValue) => {
    updateConfig((c) => ({
      ...c,
      faceSet: {
        name: value.name,
        image: value.image,
      } as FaceSetRef,
      faceIndex: value.faceIndex,
    }));
  };

  const handlePositionChange = (pos: FacePosition) => {
    updateConfig((c) => ({ ...c, facePosition: pos }));
  };

  return (
    <div className={`tab-content ${disabled ? 'disabled' : ''}`}>
      {disabled && (
        <div className="warning-banner">
          脸图仅在标准窗口模式下可用。请先在【窗口】设置页打开【使用标准窗口】。
        </div>
      )}

      <div className="field-group">
        <label className="field-label">脸图模式</label>
        <div className="radio-stack">
          <label className="radio-row">
            <input
              type="radio"
              name="face-mode"
              checked={config.faceMode === 'none'}
              onChange={() => handleModeChange('none')}
              disabled={disabled}
            />
            禁用
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="face-mode"
              checked={config.faceMode === 'face'}
              onChange={() => handleModeChange('face')}
              disabled={disabled}
            />
            选择脸图
          </label>
        </div>
      </div>

      {config.faceMode === 'face' && (
        <>
          <div className="field-group">
            <label className="field-label">脸图位置</label>
            <div className="radio-stack">
              <label className="radio-row">
                <input
                  type="radio"
                  name="face-pos"
                  checked={config.facePosition === 'left'}
                  onChange={() => handlePositionChange('left')}
                  disabled={disabled}
                />
                左
              </label>
              <label className="radio-row">
                <input
                  type="radio"
                  name="face-pos"
                  checked={config.facePosition === 'right'}
                  onChange={() => handlePositionChange('right')}
                  disabled={disabled}
                />
                右
              </label>
            </div>
          </div>

          {config.faceMode === 'face' && (
            <>
              <div className="field-group">
                <label className="field-label">FaceSet</label>
                <div className="picker-row">
                  <button
                    type="button"
                    className="upload-btn"
                    onClick={() => setFacesetPickerOpen(true)}
                    disabled={disabled}
                    style={{ flex: 1, justifyContent: 'space-between' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {config.faceSet.name ?? '- 空 -'}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>选择…</span>
                  </button>
                </div>
              </div>

              {config.faceSet.image && (
                <div className="field-group">
                  <label className="field-label">选择脸图</label>
                  <div
                    className="face-grid"
                    style={{
                      width: 192,
                      height: 192,
                      backgroundImage: `url(${
                        config.faceSet.image instanceof HTMLImageElement
                          ? config.faceSet.image.src
                          : ''
                      })`,
                      backgroundSize: '192px 192px',
                      imageRendering: 'pixelated',
                    }}
                  >
                    {Array.from({ length: 16 }, (_, i) => {
                      const col = i % 4;
                      const row = Math.floor(i / 4);
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`face-cell ${i === config.faceIndex ? 'selected' : ''}`}
                          style={{
                            left: col * 48,
                            top: row * 48,
                            width: 48,
                            height: 48,
                          }}
                          onClick={() => updateConfig((c) => ({ ...c, faceIndex: i }))}
                          title={`脸图 ${i}`}
                        />
                      );
                    })}
                  </div>
                  <small className="field-hint">
                    当前选中：第 {config.faceIndex + 1} 张（行 {Math.floor(config.faceIndex / 4) + 1}
                    ，列 {config.faceIndex % 4 + 1}） 
                  </small>
                </div>
              )}

              <div className="field-group">
                <label className="field-label">翻转</label>
                <div className="checkbox-stack">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.faceFlipX}
                      onChange={(e) =>
                        updateConfig((c) => ({ ...c, faceFlipX: e.target.checked }))
                      }
                      disabled={disabled}
                    />
                    左右翻转
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.faceFlipY}
                      onChange={(e) =>
                        updateConfig((c) => ({ ...c, faceFlipY: e.target.checked }))
                      }
                      disabled={disabled}
                    />
                    上下翻转
                  </label>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <FaceSetPicker
        open={facesetPickerOpen}
        currentName={config.faceSet.name}
        currentFaceIndex={config.faceIndex}
        onClose={() => setFacesetPickerOpen(false)}
        onApply={handleFaceSetApply}
      />
    </div>
  );
}
