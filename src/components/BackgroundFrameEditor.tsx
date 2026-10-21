// 背景边框/底纹可视化框选
//
// 固定展示参照图左上角 16×16 图素（图片更大时出现滚动条），叠加三类选框：
//   1. 角框：四角各一个，固定在图片四角，只能拖对角手柄，必须是正方形，
//      四个角边长同步变化，上限 8
//   2. 边框：固定在图片四边，固定边的长度随角框边长变化（角框缩小 → 边伸长），
//      拖对边改变厚度，四条边同步变化
//   3. 底纹框：默认吸附在左上角角框的右下角（可跟随角框移动），也可自由平移/缩放
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import type { LoadedImage } from '../types';

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameEditorProps {
  open: boolean;
  image: LoadedImage | null;
  cornerThickness: number;
  edgeThickness: number;
  tileRect: TileRect | null;
  onClose: () => void;
  onApply: (cornerThickness: number, edgeThickness: number, tileRect: TileRect) => void;
}

/** 固定展示的图素范围（左上角起） */
const VIEW_PX = 16;
/** 与渲染层一致：角框边长上限 */
const MAX_CORNER = 8;
/** 与渲染层一致：边框厚度上限 */
const MAX_EDGE = 16;
/** 底纹默认宽高 */
const DEFAULT_TILE_SIZE = 2;
/** 角框手柄尺寸（屏幕像素） */
const HANDLE_SIZE = 14;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 四角框的定义（位置与拖动方向） */
const CORNERS = [
  { key: 'tl', sx: -1, sy: -1, handle: 'se' },
  { key: 'tr', sx: 1, sy: -1, handle: 'sw' },
  { key: 'bl', sx: -1, sy: 1, handle: 'ne' },
  { key: 'br', sx: 1, sy: 1, handle: 'nw' },
] as const;

export default function BackgroundFrameEditor({
  open,
  image,
  cornerThickness,
  edgeThickness,
  tileRect,
  onClose,
  onApply,
}: FrameEditorProps) {
  const imgW = image
    ? image instanceof HTMLImageElement
      ? image.naturalWidth
      : image.width
    : 0;
  const imgH = image
    ? image instanceof HTMLImageElement
      ? image.naturalHeight
      : image.height
    : 0;

  const [corner, setCorner] = useState(cornerThickness);
  const [edge, setEdge] = useState(edgeThickness);
  const [tile, setTile] = useState<TileRect>(
    () => tileRect ?? { x: cornerThickness, y: cornerThickness, w: DEFAULT_TILE_SIZE, h: DEFAULT_TILE_SIZE },
  );
  const [scale, setScale] = useState(8);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  /** 角框边长上限（与渲染层 clamp 规则一致） */
  const maxCorner = useMemo(
    () => Math.max(0, Math.min(MAX_CORNER, Math.floor(Math.min(imgW, imgH) / 2))),
    [imgW, imgH],
  );
  /** 边框厚度上限 */
  const maxEdge = useMemo(
    () => Math.max(0, Math.min(MAX_EDGE, imgW, imgH)),
    [imgW, imgH],
  );

  // 每次打开时同步外部值
  useEffect(() => {
    if (!open) return;
    setCorner(cornerThickness);
    setEdge(edgeThickness);
    setTile(
      tileRect ?? {
        x: cornerThickness,
        y: cornerThickness,
        w: DEFAULT_TILE_SIZE,
        h: DEFAULT_TILE_SIZE,
      },
    );
  }, [open, cornerThickness, edgeThickness, tileRect]);

  // 计算缩放并滚回左上角
  useEffect(() => {
    if (!open || imgW <= 0 || imgH <= 0) return;
    const compute = () => {
      const maxW = Math.min(640, window.innerWidth - 120);
      const maxH = Math.max(180, window.innerHeight - 320);
      setScale(clamp(Math.floor(Math.min(maxW, maxH) / VIEW_PX), 4, 28));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, imgW, imgH]);

  useEffect(() => {
    if (!open) return;
    const vp = viewportRef.current;
    if (vp) {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }
  }, [open]);

  // 绘制参照图（最近邻放大）
  useEffect(() => {
    if (!open || !image || imgW <= 0 || imgH <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, imgW, imgH);
    ctx.drawImage(image as CanvasImageSource, 0, 0);
  }, [open, image, imgW, imgH]);

  /** 通用拖拽：把屏幕位移换算成图素位移 */
  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    onMove: (dx: number, dy: number) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    el.setPointerCapture(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
      onMove((ev.clientX - startX) / scale, (ev.clientY - startY) / scale);
    };
    const handleUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', handleUp);
      el.removeEventListener('pointercancel', handleUp);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    };

    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', handleUp);
    el.addEventListener('pointercancel', handleUp);
  };

  /** 修改角框边长；如果底纹框吸附在左上角角框上，则跟着一起走 */
  const applyCorner = (next: number, snappedAtStart: boolean) => {
    const value = clamp(Math.round(next), 0, maxCorner);
    setCorner(value);
    if (snappedAtStart) {
      setTile((t) => ({ ...t, x: value, y: value }));
    }
  };

  /** 角框右上/左下等对角手柄：向外拖（远离固定角）放大，边长四角同步 */
  const handleCornerResize = (
    e: React.PointerEvent<HTMLElement>,
    sx: number,
    sy: number,
  ) => {
    const startCorner = corner;
    const snapped = tile.x === startCorner && tile.y === startCorner;
    // (sx, sy) 指向固定角，位移在"远离固定角"方向上的分量决定边长变化
    beginDrag(e, (dx, dy) => {
      applyCorner(startCorner - (dx * sx + dy * sy) / 2, snapped);
    });
  };

  /** 边框厚度：四边同步 */
  const applyEdge = (next: number) => setEdge(clamp(Math.round(next), 0, maxEdge));

  const stageW = imgW * scale;
  const stageH = imgH * scale;
  // 需要滚动时预留滚动条宽度，保证 16×16 图素完整可见
  const viewW = Math.min(VIEW_PX, imgW) * scale + (imgW > VIEW_PX ? 15 : 0);
  const viewH = Math.min(VIEW_PX, imgH) * scale + (imgH > VIEW_PX ? 15 : 0);

  /** 四角框的屏幕位置 */
  const cornerBoxes = CORNERS.map((c) => ({
    ...c,
    left: c.sx < 0 ? 0 : imgW - corner,
    top: c.sy < 0 ? 0 : imgH - corner,
  }));

  /** 四条边条（长度随角框变化，从角到角） */
  const edgeLengthH = Math.max(0, imgW - corner * 2);
  const edgeLengthV = Math.max(0, imgH - corner * 2);

  return (
    <Modal
      open={open}
      title="边框与底纹框选"
      onClose={onClose}
      width={viewW + 250}
      footer={
        <div className="frame-editor-actions">
          <button className="upload-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="export-btn"
            onClick={() => {
              onApply(corner, edge, tile);
              onClose();
            }}
          >
            应用
          </button>
        </div>
      }
    >
      {imgW > 0 && imgH > 0 ? (
        <div className="frame-editor-body">
          <div
            className="frame-editor-viewport"
            ref={viewportRef}
            style={{ width: viewW, height: viewH }}
          >
            <div
              className="frame-editor-stage"
              style={{ width: stageW, height: stageH }}
            >
              <canvas
                ref={canvasRef}
                className="frame-editor-image"
                style={{ width: stageW, height: stageH }}
              />

              {/* 四边框：先画，接缝由角覆盖 */}
              {edgeLengthH > 0 && (
                <>
                  <div
                    className="frame-box frame-box-edge"
                    style={{ left: corner * scale, top: 0, width: edgeLengthH * scale, height: edge * scale }}
                  >
                    <span
                      className="frame-edge-handle frame-edge-handle-s"
                      onPointerDown={(e) => {
                        const startEdge = edge;
                        beginDrag(e, (_dx, dy) => applyEdge(startEdge + dy));
                      }}
                      title="上下拖动改变上下边框厚度"
                    />
                  </div>
                  <div
                    className="frame-box frame-box-edge"
                    style={{
                      left: corner * scale,
                      top: (imgH - edge) * scale,
                      width: edgeLengthH * scale,
                      height: edge * scale,
                    }}
                  >
                    <span
                      className="frame-edge-handle frame-edge-handle-n"
                      onPointerDown={(e) => {
                        const startEdge = edge;
                        beginDrag(e, (_dx, dy) => applyEdge(startEdge - dy));
                      }}
                      title="上下拖动改变上下边框厚度"
                    />
                  </div>
                </>
              )}
              {edgeLengthV > 0 && (
                <>
                  <div
                    className="frame-box frame-box-edge"
                    style={{ left: 0, top: corner * scale, width: edge * scale, height: edgeLengthV * scale }}
                  >
                    <span
                      className="frame-edge-handle frame-edge-handle-e"
                      onPointerDown={(e) => {
                        const startEdge = edge;
                        beginDrag(e, (dx, _dy) => applyEdge(startEdge + dx));
                      }}
                      title="左右拖动改变左右边框厚度"
                    />
                  </div>
                  <div
                    className="frame-box frame-box-edge"
                    style={{
                      left: (imgW - edge) * scale,
                      top: corner * scale,
                      width: edge * scale,
                      height: edgeLengthV * scale,
                    }}
                  >
                    <span
                      className="frame-edge-handle frame-edge-handle-w"
                      onPointerDown={(e) => {
                        const startEdge = edge;
                        beginDrag(e, (dx, _dy) => applyEdge(startEdge - dx));
                      }}
                      title="左右拖动改变左右边框厚度"
                    />
                  </div>
                </>
              )}

              {/* 底纹框（可吸附左上角框、可整体平移） */}
              <div
                className="frame-box frame-box-tile"
                style={{
                  left: tile.x * scale,
                  top: tile.y * scale,
                  width: tile.w * scale,
                  height: tile.h * scale,
                }}
                onPointerDown={(e) => {
                  const start = { ...tile };
                  beginDrag(e, (dx, dy) => {
                    setTile({
                      ...start,
                      x: clamp(Math.round(start.x + dx), 0, Math.max(0, imgW - start.w)),
                      y: clamp(Math.round(start.y + dy), 0, Math.max(0, imgH - start.h)),
                    });
                  });
                }}
                title="按住拖动可整体移动（与左上角框重合时会跟随角框伸缩）"
              >
                <span className="frame-box-tag">
                  {tile.w}×{tile.h}
                </span>
                <span
                  className="frame-handle frame-handle-se"
                  style={{ width: HANDLE_SIZE, height: HANDLE_SIZE }}
                  onPointerDown={(e) => {
                    const start = { ...tile };
                    beginDrag(e, (dx, dy) => {
                      setTile({
                        ...start,
                        w: clamp(Math.round(start.w + dx), 1, Math.max(1, imgW - start.x)),
                        h: clamp(Math.round(start.h + dy), 1, Math.max(1, imgH - start.y)),
                      });
                    });
                  }}
                  title="拖动调整底纹区域大小"
                />
              </div>

              {/* 四角框（后画，覆盖接缝） */}
              {cornerBoxes.map((c) => (
                <div
                  key={c.key}
                  className="frame-box frame-box-corner"
                  style={{
                    left: c.left * scale,
                    top: c.top * scale,
                    width: corner * scale,
                    height: corner * scale,
                  }}
                >
                  <span
                    className={`frame-handle frame-handle-${c.handle}`}
                    style={{ width: HANDLE_SIZE, height: HANDLE_SIZE }}
                    onPointerDown={(e) => handleCornerResize(e, c.sx, c.sy)}
                    title="拖动改变角框边长（四角同步）"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="frame-editor-side">
            <div className="frame-editor-info">
              <div>
                角框：<b>{corner}px</b>
              </div>
              <div>
                边框：<b>{edge}px</b>
              </div>
              <div>
                底纹：<b>{tile.w}×{tile.h}</b> @ ({tile.x}, {tile.y})
              </div>
            </div>
            <div className="frame-editor-legend">
              <span className="legend-item">
                <i className="legend-swatch legend-corner" />
                角框：拖动顶角的方格
              </span>
              <span className="legend-item">
                <i className="legend-swatch legend-edge" />
                边框：拖动绿色的直线
              </span>
              <span className="legend-item">
                <i className="legend-swatch legend-tile" />
                底纹：拖动内部或右下角的方格
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="picture-empty">请先选择参考图片</div>
      )}
    </Modal>
  );
}
