import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { RPG_CONSTANTS, type FaceSlot } from '../../types';
import { computeWindowSize } from '../../engine/messageWindow';
import FaceSetPicker, { type FaceSetPickerValue } from '../pickers/FaceSetPicker';

type FaceSide = 'left' | 'right';

export default function FaceTab() {
  const { config, updateConfig } = useStore();
  const [pickerSide, setPickerSide] = useState<FaceSide | null>(null);

  // 标准窗口检测不看【使用标准窗口】开关，而是看实际宽高是否等于 RPG 标准值
  const { width, height } = useMemo(() => computeWindowSize(config), [config]);
  const disabled =
    width !== RPG_CONSTANTS.MESSAGE_BOX_WIDTH || height !== RPG_CONSTANTS.MESSAGE_BOX_HEIGHT;

  const updateSlot = (side: FaceSide, patch: Partial<FaceSlot>) => {
    updateConfig((c) =>
      side === 'left'
        ? { ...c, faceLeft: { ...c.faceLeft, ...patch } }
        : { ...c, faceRight: { ...c.faceRight, ...patch } },
    );
  };

  // 左右脸图目前互斥：启用一侧时关闭另一侧
  const toggleEnabled = (side: FaceSide, enabled: boolean) => {
    updateConfig((c) => ({
      ...c,
      faceLeft: { ...c.faceLeft, enabled: side === 'left' ? enabled : false },
      faceRight: { ...c.faceRight, enabled: side === 'right' ? enabled : false },
    }));
  };

  const handleFaceSetApply = (value: FaceSetPickerValue) => {
    if (!pickerSide) return;
    updateSlot(pickerSide, {
      faceSet: { name: value.name, image: value.image },
      faceIndex: value.faceIndex,
    });
  };

  const renderSection = (side: FaceSide) => {
    const slot = side === 'left' ? config.faceLeft : config.faceRight;
    // 页面禁用或该侧未启用时，下方内容保持展示但不可操作
    const bodyDisabled = disabled || !slot.enabled;
    const imageSrc =
      slot.faceSet.image instanceof HTMLImageElement ? slot.faceSet.image.src : '';

    return (
      <div className="face-section" key={side}>
        <div className="field-label">{side === 'left' ? '左侧脸图' : '右侧脸图'}</div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={(e) => toggleEnabled(side, e.target.checked)}
            disabled={disabled}
          />
          启用
        </label>

        <div className={`face-section-body ${bodyDisabled ? 'disabled' : ''}`}>
          <div className="field-group">
            <label className="field-label">FaceSet</label>
            <div className="picker-row">
              <button
                type="button"
                className="upload-btn"
                onClick={() => setPickerSide(side)}
                disabled={bodyDisabled}
                style={{ flex: 1, justifyContent: 'space-between' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {slot.faceSet.name ?? '- 空 -'}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>选择…</span>
              </button>
              {slot.faceSet.name && (
                <button
                  type="button"
                  className="upload-btn"
                  onClick={() =>
                    updateSlot(side, {
                      faceSet: { name: null, image: null },
                      faceIndex: 0,
                    })
                  }
                  disabled={bodyDisabled}
                >
                  清除
                </button>
              )}
            </div>
          </div>

          {slot.faceSet.image && (
            <div className="field-group">
              <label className="field-label">选择脸图</label>
              <div
                className="face-grid"
                style={{
                  width: 192,
                  height: 192,
                  backgroundImage: imageSrc ? `url(${imageSrc})` : undefined,
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
                      className={`face-cell ${i === slot.faceIndex ? 'selected' : ''}`}
                      style={{
                        left: col * 48,
                        top: row * 48,
                        width: 48,
                        height: 48,
                      }}
                      onClick={() => updateSlot(side, { faceIndex: i })}
                      disabled={bodyDisabled}
                      title={`脸图 ${i}`}
                    />
                  );
                })}
              </div>
              <small className="field-hint">
                当前选中：第 {slot.faceIndex + 1} 张（行 {Math.floor(slot.faceIndex / 4) + 1}
                ，列 {slot.faceIndex % 4 + 1}）
              </small>
            </div>
          )}

          <div className="field-group">
            <div className="checkbox-stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={slot.flipX}
                  onChange={(e) => updateSlot(side, { flipX: e.target.checked })}
                  disabled={bodyDisabled}
                />
                左右翻转
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={slot.flipY}
                  onChange={(e) => updateSlot(side, { flipY: e.target.checked })}
                  disabled={bodyDisabled}
                />
                上下翻转
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const pickerSlot = pickerSide === 'left' ? config.faceLeft : config.faceRight;

  return (
    <div className="tab-content">
      {disabled && (
        <div className="warning-banner">
          脸图仅在窗口实际尺寸为 RPG 标准 {RPG_CONSTANTS.MESSAGE_BOX_WIDTH} ×{' '}
          {RPG_CONSTANTS.MESSAGE_BOX_HEIGHT} 时可用。
        </div>
      )}

      {renderSection('left')}
      {renderSection('right')}

      <FaceSetPicker
        open={pickerSide !== null}
        title={pickerSide === 'left' ? '选择左脸图 FaceSet' : '选择右脸图 FaceSet'}
        currentName={pickerSlot.faceSet.name}
        currentFaceIndex={pickerSlot.faceIndex}
        onClose={() => setPickerSide(null)}
        onApply={handleFaceSetApply}
      />
    </div>
  );
}
