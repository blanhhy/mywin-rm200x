import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { SystemImageRenderer } from '../../engine/systemImage';
import { type SystemImageRef } from '../../types';
import SystemPicker, { type SystemPickerValue } from '../pickers/SystemPicker';

export default function TextTab() {
  const { config, updateConfig } = useStore();
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateConfig((c) => ({ ...c, text: e.target.value }));
  };

  const handleSystemApply = (value: SystemPickerValue) => {
    updateConfig((c) => ({
      ...c,
      colorSystem: {
        name: value.name,
        image: value.image,
        transparentColor: value.transparentColor,
      } as SystemImageRef,
    }));
  };

  // 提取配色列表用于展示和选择
  const colors = (() => {
    const ref = config.colorSystem;
    if (!ref.image) return [];
    try {
      const r = new SystemImageRenderer(ref.image, ref.transparentColor);
      return r.getAllColors();
    } catch {
      return [];
    }
  })();

  return (
    <div className="tab-content">
      <div className="field-group">
        <textarea
          className="text-input"
          value={config.text}
          onChange={handleTextChange}
          rows={6}
          placeholder={'请输入文本'}
        />
      </div>

      <div className="field-group">
        <label className="field-label">系统配色</label>
        <div className="picker-row">
          <button
            type="button"
            className="upload-btn"
            onClick={() => setSystemPickerOpen(true)}
            style={{ flex: 1, justifyContent: 'space-between' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {config.colorSystem.name ?? '- 空 -'}
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>选择…</span>
          </button>
        </div>
        <div className="transparent-color-row">
          透明色：
          <input
            type="color"
            value={config.colorSystem.transparentColor}
            onChange={(e) =>
              updateConfig((c) => ({
                ...c,
                colorSystem: { ...c.colorSystem, transparentColor: e.target.value },
              }))
            }
          />
          <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {config.colorSystem.transparentColor.toUpperCase()}
          </code>
        </div>
        {config.colorSystem.image && (
          <div className="system-preview">
            <img
              src={
                config.colorSystem.image instanceof HTMLImageElement
                  ? config.colorSystem.image.src
                  : ''
              }
              alt="System"
              style={{ width: 160, height: 80, imageRendering: 'pixelated' }}
            />
          </div>
        )}
      </div>

      {colors.length > 0 && (
        <div className="field-group">
          <label className="field-label">默认文字色</label>
          <div className="color-grid">
            {colors.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`color-swatch ${i === config.defaultColor ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => updateConfig((cfg) => ({ ...cfg, defaultColor: i }))}
                title={`\\c[${i}] = ${c}`}
              >
                {i}
              </button>
            ))}
          </div>
          <small className="field-hint">
            当前默认色：\c[{config.defaultColor}]
          </small>
        </div>
      )}

      <SystemPicker
        open={systemPickerOpen}
        currentName={config.colorSystem.name}
        currentTransparentColor={config.colorSystem.transparentColor}
        onClose={() => setSystemPickerOpen(false)}
        onApply={handleSystemApply}
        title="选择配色 System 图"
      />
    </div>
  );
}
