import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { renderMessageWindow, computeWindowSize } from '../engine/messageWindow';
import { SystemImageRenderer } from '../engine/systemImage';
import Modal from './Modal';
import {
  canvasTo8bitPNG,
  canvasToRGBAPNG,
  countUniqueColors,
  downloadPNG,
  recommendTransparentColor,
} from '../engine/pngExporter';

/** 移动端基础缩放系数：让标准 320px 窗口在 1x 下适配约 360px CSS 宽屏幕 */
const MOBILE_BASE_SCALE = 0.94;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 899px)').matches
      : false,
  );

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 899px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default function Preview() {
  const config = useStore((s) => s.config);
  const workspace = useStore((s) => s.workspace);
  const exportPNGToWorkspace = useStore((s) => s.exportPNGToWorkspace);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transparentColor, setTransparentColor] = useState(recommendTransparentColor());
  const [zoom, setZoom] = useState(2);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState(false);
  const [colorOverflow, setColorOverflow] = useState<{ count: number } | null>(null);
  const isMobile = useIsMobile();

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

  // 移动端额外应用基础缩放，让标准窗口在 1x 下能完整显示
  const effectiveZoom = isMobile ? zoom * MOBILE_BASE_SCALE : zoom;

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

  // 实际执行保存（8 位索引色或 RGBA）
  const doSave = async (mode: 'indexed' | 'rgba') => {
    if (!canvasRef.current) return;
    try {
      let pngData: Uint8Array;
      if (mode === 'rgba') {
        pngData = await canvasToRGBAPNG(canvasRef.current);
      } else {
        pngData = await canvasTo8bitPNG(canvasRef.current, { transparentColor });
      }
      const filename = `mywin-${Date.now()}.png`;
      if (workspace) {
        const savedName = await exportPNGToWorkspace(filename, pngData);
        if (savedName) {
          setExportError(false);
          setExportMsg(`已保存到工作区 Picture/${savedName}`);
        } else {
          setExportError(true);
          setExportMsg('导出到工作区失败');
        }
      } else {
        downloadPNG(pngData, filename);
        setExportError(false);
        setExportMsg(mode === 'rgba' ? '已开始下载（真彩色）' : '已开始下载');
      }
      setTimeout(() => setExportMsg(null), 3000);
    } catch (e) {
      setExportError(true);
      setExportMsg(`导出失败：${e}`);
    }
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    const colorCount = countUniqueColors(canvasRef.current);
    if (colorCount > 256) {
      setColorOverflow({ count: colorCount });
      return;
    }
    doSave('indexed');
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
            width: width * effectiveZoom,
            height: height * effectiveZoom,
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
          {workspace ? '保存到工作区' : '保存为 PNG'}
        </button>
      </div>
      {exportMsg && <div className={`export-msg ${exportError ? 'error' : ''}`}>{exportMsg}</div>}

      <Modal
        open={colorOverflow !== null}
        title="色彩溢出"
        onClose={() => setColorOverflow(null)}
        width={440}
        footer={
          <>
            <button
              className="modal-btn"
              onClick={() => setColorOverflow(null)}
            >
              返回调整
            </button>
            <button
              className="modal-btn"
              onClick={() => {
                setColorOverflow(null);
                doSave('rgba');
              }}
            >
              扩展色彩并保存
            </button>
            <button
              className="modal-btn primary"
              onClick={() => {
                setColorOverflow(null);
                doSave('indexed');
              }}
            >
              压缩色彩并保存
            </button>
          </>
        }
      >
        <div className="color-overflow-body">
          <p>
            当前画面包含 <strong>{colorOverflow?.count}</strong> 种颜色，
            超过了 RM 素材的 256 色限制。
          </p>
          <ul className="color-overflow-options">
            <li>
              <strong>压缩色彩</strong>：合并相近的颜色，使之成为 256 色
            </li>
            <li>
              <strong>扩展色彩</strong>：直接以真彩色导出
            </li>
          </ul>
        </div>
      </Modal>
    </div>
  );
}
