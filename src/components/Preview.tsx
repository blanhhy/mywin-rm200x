import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { renderMessageWindow, computeWindowSize } from '../engine/messageWindow';
import { SystemImageRenderer } from '../engine/systemImage';
import { exportCanvasAsPNG, recommendTransparentColor } from '../engine/pngExporter';

export default function Preview() {
  const config = useStore((s) => s.config);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transparentColor, setTransparentColor] = useState(recommendTransparentColor());
  const [zoom, setZoom] = useState(2);

  // 实时渲染
  useEffect(() => {
    if (!canvasRef.current) return;
    const { canvas } = renderMessageWindow(config);
    const ctx = canvasRef.current.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(canvas, 0, 0);
  }, [config]);

  const { width, height } = useMemo(() => computeWindowSize(config), [config]);

  // 配色列表（用于展示）
  const colors = useMemo(() => {
    const ref = config.colorSystem;
    if (!ref.image) return [];
    try {
      const r = new SystemImageRenderer(ref.image, ref.transparentColor);
      return r.getAllColors();
    } catch {
      return [];
    }
  }, [config.colorSystem]);

  const handleExport = async () => {
    if (!canvasRef.current) return;
    const filename = `mywin-${Date.now()}.png`;
    await exportCanvasAsPNG(canvasRef.current, filename, { transparentColor });
  };

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <label className="zoom-label">
          缩放：
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
            <option value={4}>4×</option>
          </select>
        </label>
        <span className="size-info">
          尺寸：{width} × {height}
        </span>
      </div>

      <div
        className="canvas-wrapper"
        style={{
          backgroundImage:
            'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        }}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{
            width: width * zoom,
            height: height * zoom,
            imageRendering: 'pixelated',
          }}
        />
      </div>

      {colors.length > 0 && (
        <div className="color-palette">
          <span className="palette-label">配色列表：</span>
          <div className="palette-grid">
            {colors.map((c, i) => (
              <div
                key={i}
                className={`palette-swatch ${i === config.defaultColor ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                title={`\\c[${i}] = ${c}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="export-bar">
        <label className="transparent-color-label">
          透明色：
          <input
            type="color"
            value={transparentColor}
            onChange={(e) => setTransparentColor(e.target.value)}
          />
          <button
            className="recommend-btn"
            onClick={() => setTransparentColor(recommendTransparentColor())}
          >
            自动
          </button>
        </label>
        <button className="export-btn" onClick={handleExport}>
          保存为 PNG
        </button>
      </div>
    </div>
  );
}
