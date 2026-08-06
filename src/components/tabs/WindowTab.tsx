import { useStore } from '../../store/useStore';
import { RPG_CONSTANTS, type Padding } from '../../types';
import { computeWindowSize } from '../../engine/messageWindow';

export default function WindowTab() {
  const { config, updateConfig, restoreStandardWindow } = useStore();

  const handleStandardToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    updateConfig((c) => ({
      ...c,
      standardWindow: checked,
      // 进入标准模式时锁定尺寸和内边距
      ...(checked
        ? {
            width: RPG_CONSTANTS.MESSAGE_BOX_WIDTH,
            height: RPG_CONSTANTS.MESSAGE_BOX_HEIGHT,
            padding: {
              top: RPG_CONSTANTS.BORDER_THICKNESS,
              right: RPG_CONSTANTS.BORDER_THICKNESS,
              bottom: RPG_CONSTANTS.BORDER_THICKNESS,
              left: RPG_CONSTANTS.BORDER_THICKNESS,
            } as Padding,
          }
        : {}),
    }));
  };

  const handleWidthMode = (mode: 'auto' | 'number') => {
    if (mode === 'number' && config.width === 'auto') {
      const { width } = computeWindowSize(config);
      updateConfig((c) => ({ ...c, width }));
    } else {
      updateConfig((c) => ({ ...c, width: mode === 'auto' ? 'auto' : c.width }));
    }
  };

  const handleHeightMode = (mode: 'auto' | 'number') => {
    if (mode === 'number' && config.height === 'auto') {
      const { height } = computeWindowSize(config);
      updateConfig((c) => ({ ...c, height }));
    } else {
      updateConfig((c) => ({ ...c, height: mode === 'auto' ? 'auto' : c.height }));
    }
  };

  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v) && v > 0) {
      updateConfig((c) => ({ ...c, width: Math.floor(v) }));
    }
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v) && v > 0) {
      updateConfig((c) => ({ ...c, height: Math.floor(v) }));
    }
  };

  const handlePaddingChange = (key: keyof Padding, value: number) => {
    updateConfig((c) => ({ ...c, padding: { ...c.padding, [key]: value } }));
  };

  const disabled = config.standardWindow;

  return (
    <div className="tab-content">
      <div className="field-group">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.standardWindow}
            onChange={handleStandardToggle}
          />
          <span>使用标准窗口</span>
          <small className="field-hint">
            （关闭后可自定义）
          </small>
        </label>
      </div>

      <div className={`field-group ${disabled ? 'disabled' : ''}`}>
        <label className="field-label">宽度</label>
        <div className="size-row">
          <label className="radio-row">
            <input
              type="radio"
              name="width-mode"
              checked={config.width === 'auto'}
              onChange={() => handleWidthMode('auto')}
              disabled={disabled}
            />
            自适应
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="width-mode"
              checked={typeof config.width === 'number'}
              onChange={() => handleWidthMode('number')}
              disabled={disabled}
            />
            数值
          </label>
          {typeof config.width === 'number' && (
            <input
              type="number"
              className="number-input"
              value={config.width}
              onChange={handleWidthChange}
              min={16}
              max={1024}
              disabled={disabled}
            />
          )}
        </div>
      </div>

      <div className={`field-group ${disabled ? 'disabled' : ''}`}>
        <label className="field-label">高度</label>
        <div className="size-row">
          <label className="radio-row">
            <input
              type="radio"
              name="height-mode"
              checked={config.height === 'auto'}
              onChange={() => handleHeightMode('auto')}
              disabled={disabled}
            />
            自适应
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="height-mode"
              checked={typeof config.height === 'number'}
              onChange={() => handleHeightMode('number')}
              disabled={disabled}
            />
            数值
          </label>
          {typeof config.height === 'number' && (
            <input
              type="number"
              className="number-input"
              value={config.height}
              onChange={handleHeightChange}
              min={16}
              max={1024}
              disabled={disabled}
            />
          )}
        </div>
      </div>

      <div className={`field-group ${disabled ? 'disabled' : ''}`}>
        <label className="field-label">内边距</label>
        <div className="padding-cross">
          <div className="padding-cell padding-top">
            <span className="padding-label">上</span>
            <input
              type="number"
              className="number-input"
              value={config.padding.top}
              onChange={(e) => handlePaddingChange('top', Number(e.target.value))}
              disabled={disabled}
            />
          </div>
          <div className="padding-row">
            <div className="padding-cell padding-left">
              <span className="padding-label">左</span>
              <input
                type="number"
                className="number-input"
                value={config.padding.left}
                onChange={(e) => handlePaddingChange('left', Number(e.target.value))}
                disabled={disabled}
              />
            </div>
            <div className="padding-center" />
            <div className="padding-cell padding-right">
              <span className="padding-label">右</span>
              <input
                type="number"
                className="number-input"
                value={config.padding.right}
                onChange={(e) => handlePaddingChange('right', Number(e.target.value))}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="padding-cell padding-bottom">
            <span className="padding-label">下</span>
            <input
              type="number"
              className="number-input"
              value={config.padding.bottom}
              onChange={(e) => handlePaddingChange('bottom', Number(e.target.value))}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <div className="field-group">
        <button className="action-btn" onClick={restoreStandardWindow} disabled={disabled}>
          还原设置
        </button>
        <small className="field-hint">
          取消自适应并还原成标准窗口的尺寸和内边距。
        </small>
      </div>
    </div>
  );
}
