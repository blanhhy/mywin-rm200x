import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { type SystemImageRef } from '../../types';
import SystemPicker, { type SystemPickerValue } from '../pickers/SystemPicker';
import FontPicker, { type FontPickerValue } from '../pickers/FontPicker';

export default function TextTab() {
  const { config, updateConfig } = useStore();
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);

  const font = config.customFont;
  const fontSelected = font.family !== null;

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

  const handleFontApply = (value: FontPickerValue) => {
    updateConfig((c) => ({
      ...c,
      customFont: {
        ...c.customFont,
        source: value.source,
        label: value.label,
        family: value.family,
      },
    }));
  };

  const handleFontClear = () => {
    updateConfig((c) => ({
      ...c,
      customFont: { ...c.customFont, source: 'local', label: '', family: null },
    }));
  };

  const handleFontNumber =
    (key: 'size' | 'letterSpacing' | 'lineSpacing', min: number, max: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (e.target.value === '' || Number.isNaN(v)) return;
      updateConfig((c) => ({
        ...c,
        customFont: {
          ...c.customFont,
          [key]: Math.min(max, Math.max(min, Math.round(v))),
        },
      }));
    };

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

      <div className="field-group">
        <label className="field-label">字体</label>
        <div className="picker-row">
          <button
            type="button"
            className="upload-btn"
            onClick={() => setFontPickerOpen(true)}
            style={{ flex: 1, justifyContent: 'space-between' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {fontSelected ? font.label : '内置字体'}
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>选择…</span>
          </button>
          {fontSelected && (
            <button type="button" className="upload-btn" onClick={handleFontClear}>清除</button>
          )}
        </div>
      </div>

      <div className={`field-group ${fontSelected ? '' : 'disabled'}`}>
        <div className="size-row">
          <span className="field-label">字号</span>
          <input
            type="number"
            className="number-input"
            value={font.size}
            min={1}
            max={256}
            disabled={!fontSelected}
            onChange={handleFontNumber('size', 1, 256)}
          />
          <span className="field-label">px</span>
        </div>
        <div className="size-row">
          <span className="field-label">间距</span>
          <input
            type="number"
            className="number-input"
            value={font.letterSpacing}
            min={-64}
            max={64}
            disabled={!fontSelected}
            onChange={handleFontNumber('letterSpacing', -64, 64)}
          />
          <span className="field-label">px</span>
        </div>
        <div className="size-row">
          <span className="field-label">行距</span>
          <input
            type="number"
            className="number-input"
            value={font.lineSpacing}
            min={-64}
            max={64}
            disabled={!fontSelected}
            onChange={handleFontNumber('lineSpacing', -64, 64)}
          />
          <span className="field-label">px</span>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={font.shadow}
            disabled={!fontSelected}
            onChange={(e) =>
              updateConfig((c) => ({
                ...c,
                customFont: { ...c.customFont, shadow: e.target.checked },
              }))
            }
          />
          <span>绘制阴影</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={font.pixelPerfect}
            disabled={!fontSelected}
            onChange={(e) =>
              updateConfig((c) => ({
                ...c,
                customFont: { ...c.customFont, pixelPerfect: e.target.checked },
              }))
            }
          />
          <span>像素完美（像素字体专用）</span>
        </label>
      </div>

      <SystemPicker
        open={systemPickerOpen}
        currentName={config.colorSystem.name}
        currentTransparentColor={config.colorSystem.transparentColor}
        onClose={() => setSystemPickerOpen(false)}
        onApply={handleSystemApply}
        title="选择配色 System 图"
      />

      <FontPicker
        open={fontPickerOpen}
        onClose={() => setFontPickerOpen(false)}
        onApply={handleFontApply}
      />
    </div>
  );
}
