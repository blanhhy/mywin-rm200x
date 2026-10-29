import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { renderMessageWindow, computeWindowSize, loadImage } from '../engine/messageWindow';
import { readPictureDataUrl, listWorkspacePictures } from '../engine/workspace';
import { getSystemImageRenderer } from '../engine/systemImage';
import Modal from './Modal';
import {
  canvasTo8bitPNG,
  canvasTo8bitBMP,
  canvasToRGBAPNG,
  countUniqueColors,
  downloadPNG,
  recommendTransparentColor,
  recommendTransparentColorFromPicture,
} from '../engine/pngExporter';
import { buildPictureMeta, savePictureMeta } from '../engine/pictureMeta';

/** 读取图片尺寸（用于覆盖时的尺寸校验） */
function loadImageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export default function Preview() {
  const config = useStore((s) => s.config);
  const workspace = useStore((s) => s.workspace);
  const exportPNGToWorkspace = useStore((s) => s.exportPNGToWorkspace);
  const selectedPicture = useStore((s) => s.selectedPicture);
  const overwritePictureToWorkspace = useStore((s) => s.overwritePictureToWorkspace);
  const refreshPictures = useStore((s) => s.refreshPictures);
  const backgroundImageFileName = useStore((s) => s.backgroundImageFileName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transparentColor, setTransparentColor] = useState(recommendTransparentColor());
  /** 勾选后，预览把透明区域显示为透明色，而不是棋盘格下的真透明 */
  const [showTransparentColor, setShowTransparentColor] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState(false);
  const [colorOverflow, setColorOverflow] = useState<{ count: number } | null>(null);
  const [compareDims, setCompareDims] = useState<{ w: number; h: number } | null>(null);
  /** 目标图片（覆盖写模式的参考图），用于 \r / \p 填充 */
  const [referenceImage, setReferenceImage] = useState<HTMLImageElement | null>(null);
  /** 选中图片的 dataURL（按需从工作区读取，避免打开工作区时读取上万张图） */
  const [pictureDataUrl, setPictureDataUrl] = useState<string | null>(null);
  const [sizeMismatch, setSizeMismatch] = useState<{
    target: { w: number; h: number };
    mode: 'indexed' | 'rgba';
  } | null>(null);
  /** 等待用户确认文件名的保存/下载请求 */
  const [pendingSave, setPendingSave] = useState<{
    mode: 'indexed' | 'rgba';
    force: boolean;
    partialTarget?: { w: number; h: number };
  } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [nameExt, setNameExt] = useState<'png' | 'bmp'>('png');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameChecking, setNameChecking] = useState(false);

  // 切换对照图片时重置尺寸缓存
  useEffect(() => {
    setCompareDims(null);
  }, [selectedPicture?.fileName]);

  // 选中图片后才读取它的数据（大目录下不能预先全量读取）
  useEffect(() => {
    if (!selectedPicture || !workspace) {
      setPictureDataUrl(null);
      return;
    }
    let cancelled = false;
    setPictureDataUrl(null);
    readPictureDataUrl(workspace, selectedPicture)
      .then((url) => {
        if (!cancelled) setPictureDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPictureDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPicture, workspace]);

  // 覆盖写模式：加载目标图片作为参考图（供 \r / \p 取像素）
  useEffect(() => {
    if (!selectedPicture || !pictureDataUrl) {
      setReferenceImage(null);
      return;
    }
    let cancelled = false;
    loadImage(pictureDataUrl)
      .then((img) => {
        if (!cancelled) setReferenceImage(img);
      })
      .catch(() => {
        if (!cancelled) setReferenceImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPicture, pictureDataUrl]);

  // 实时渲染
  useEffect(() => {
    const out = canvasRef.current;
    if (!out) return;
    const { canvas, fillRegions } = renderMessageWindow(config);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, out.width, out.height);
    // 勾选"预览"时，透明区域改用透明色填充（与导出的透明色效果一致）
    if (showTransparentColor) {
      ctx.fillStyle = transparentColor;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(canvas, 0, 0);
    // \r / \p：从参考图相同位置取像素填充（仅覆盖写模式生效）
    if (referenceImage) {
      for (const r of fillRegions) {
        ctx.drawImage(referenceImage, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      }
    }
  }, [config, showTransparentColor, transparentColor, referenceImage]);

  // 选中对照图片时，自动采用该图片上的适合颜色作为透明色
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!selectedPicture || !pictureDataUrl || !canvas) return;
    let cancelled = false;
    recommendTransparentColorFromPicture(pictureDataUrl, canvas).then((c) => {
      if (!cancelled && c) setTransparentColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPicture, pictureDataUrl]);

  const { width, height } = useMemo(() => computeWindowSize(config), [config]);

  // 配色列表（用于展示）
  const colors = useMemo(() => {
    const ref = config.colorSystem;
    if (!ref.image) return [];
    try {
      const r = getSystemImageRenderer(ref.image, ref.transparentColor);
      return r.getAllColors();
    } catch {
      return [];
    }
  }, [config.colorSystem]);

  // 覆盖目标为 BMP 时，写入 8 位索引色 BMP（而不是 PNG）
  const targetIsBmp = !!selectedPicture && /\.bmp$/i.test(selectedPicture.fileName);

  // 实际执行保存（8 位索引色或 RGBA）
  const doSave = async (
    mode: 'indexed' | 'rgba',
    force = false,
    partialTarget?: { w: number; h: number },
    target?: { stem: string; ext: 'png' | 'bmp' },
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 保存/下载（非覆盖）先让用户确认文件名与格式
    if (!selectedPicture && !target) {
      setPendingSave({ mode, force, partialTarget });
      setNameInput(`mywin-${Date.now()}`);
      setNameExt('png');
      setNameError(null);
      return;
    }

    // 替换模式下校验目标图片尺寸是否与当前画面完全一致
    if (selectedPicture && workspace && !force && !partialTarget) {
      const targetSize =
        compareDims ?? (pictureDataUrl ? await loadImageSize(pictureDataUrl) : null);
      if (targetSize && (targetSize.w !== canvas.width || targetSize.h !== canvas.height)) {
        setSizeMismatch({ target: targetSize, mode });
        return;
      }
    }

    try {
      let saveCanvas = canvas;
      if (partialTarget) {
        const targetImage = pictureDataUrl ? await loadImage(pictureDataUrl) : null;
        if (!targetImage) throw new Error('无法读取目标图片');

        const composite = document.createElement('canvas');
        composite.width = partialTarget.w;
        composite.height = partialTarget.h;
        const ctx = composite.getContext('2d');
        if (!ctx) throw new Error('无法创建部分覆盖画布');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(targetImage, 0, 0);
        // 左上角对齐、按原始像素尺寸叠加；目标画布边界会裁掉超出的部分。
        ctx.drawImage(canvas, 0, 0);
        saveCanvas = composite;
      }

      // 覆盖时按目标文件的扩展名写入；另存时按用户在命名窗口中选的格式
      const ext: 'png' | 'bmp' = selectedPicture
        ? targetIsBmp
          ? 'bmp'
          : 'png'
        : target!.ext;
      let fileData: Uint8Array;
      if (ext === 'bmp') {
        // BMP 无 alpha 通道，只能用调色板 idx-0 表达透明，故固定写入索引色 BMP
        fileData = canvasTo8bitBMP(saveCanvas, { transparentColor });
      } else if (mode === 'rgba') {
        fileData = await canvasToRGBAPNG(saveCanvas);
      } else {
        fileData = await canvasTo8bitPNG(saveCanvas, { transparentColor });
      }
      const filename = selectedPicture ? selectedPicture.fileName : `${target!.stem}.${ext}`;
      if (workspace) {
        // 替换模式下覆盖选中的图片，否则另存为新文件
        const savedName = selectedPicture
          ? await overwritePictureToWorkspace(selectedPicture.fileName, fileData)
          : await exportPNGToWorkspace(filename, fileData);
        if (savedName) {
          // 参数与图片一起保存，供下次二次编辑时读回
          try {
            await savePictureMeta(
              workspace,
              savedName,
              buildPictureMeta(config, backgroundImageFileName),
            );
          } catch {
            // 参数写入失败不影响图片本身
          }
          setExportError(false);
          setExportMsg(
            selectedPicture
              ? `已覆盖 Picture/${savedName}`
              : `已保存到工作区 Picture/${savedName}`,
          );
          await refreshPictures();
        } else {
          setExportError(true);
          setExportMsg(selectedPicture ? '覆盖图片失败' : '导出到工作区失败');
        }
      } else {
        downloadPNG(fileData, filename, ext === 'bmp' ? 'image/bmp' : 'image/png');
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

  // 命名窗口确认：校验文件名，工作区已有同名文件时拒绝保存
  const confirmSaveName = async () => {
    if (!pendingSave) return;
    const stem = nameInput.trim();
    if (!stem) {
      setNameError('请输入文件名');
      return;
    }
    if (/[\\/:*?"<>|]/.test(stem)) {
      setNameError('文件名不能包含 \\ / : * ? " < > |');
      return;
    }
    const fileName = `${stem}.${nameExt}`;

    if (workspace) {
      setNameChecking(true);
      try {
        const existing = await listWorkspacePictures(workspace);
        if (existing.some((p) => p.fileName.toLowerCase() === fileName.toLowerCase())) {
          setNameError(`工作区 Picture 中已存在 ${fileName}`);
          return;
        }
      } catch (e) {
        setNameError(`检查同名文件失败：${e}`);
        return;
      } finally {
        setNameChecking(false);
      }
    }

    const request = pendingSave;
    setPendingSave(null);
    setNameError(null);
    await doSave(request.mode, request.force, request.partialTarget, {
      stem,
      ext: nameExt,
    });
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
            <option value={5}>5×</option>
            <option value={6}>6×</option>
            <option value={7}>7×</option>
            <option value={8}>8×</option>
          </select>
        </label>
        <span className="size-info">
          尺寸：{width} × {height}
        </span>
      </div>

      <div className="canvas-wrapper">
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
                className="palette-swatch"
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
            onClick={async () => {
              const canvas = canvasRef.current;
              if (selectedPicture && pictureDataUrl && canvas) {
                const c = await recommendTransparentColorFromPicture(
                  pictureDataUrl,
                  canvas,
                );
                if (c) {
                  setTransparentColor(c);
                  return;
                }
              }
              setTransparentColor(recommendTransparentColor());
            }}
          >
            自动
          </button>
        </label>
        <label
          className="checkbox-row"
          title="透明区域显示为透明色（与导出效果一致）"
        >
          <input
            type="checkbox"
            checked={showTransparentColor}
            onChange={(e) => setShowTransparentColor(e.target.checked)}
          />
          预览
        </label>
        <button className="export-btn" onClick={handleExport}>
          {selectedPicture ? '覆盖' : workspace ? '保存' : '下载'}
        </button>
      </div>
      {exportMsg && <div className={`export-msg ${exportError ? 'error' : ''}`}>{exportMsg}</div>}

      {selectedPicture && (
        <div className="compare-section">
          <div className="compare-label">
            目标图片：<span className='copyable'>{selectedPicture.fileName}</span><br />
            目标尺寸：{compareDims ? `${compareDims.w} × ${compareDims.h}` : '…'}
          </div>
          <div className="canvas-wrapper">
            {pictureDataUrl ? (
              <img
                className="compare-img"
                src={pictureDataUrl}
                alt={selectedPicture.fileName}
                style={
                  compareDims
                    ? {
                        width: compareDims.w * zoom,
                        height: compareDims.h * zoom,
                        imageRendering: 'pixelated',
                      }
                    : { imageRendering: 'pixelated' }
                }
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setCompareDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            ) : (
              <span className="compare-loading">读取中…</span>
            )}
          </div>
        </div>
      )}

      <Modal
        open={colorOverflow !== null}
        title="色彩溢出"
        onClose={() => setColorOverflow(null)}
        width={440}
        footer={
          <>
            <button
              className="modal-btn"
              onClick={() => {
                setColorOverflow(null);
                doSave('indexed');
              }}
            >
              压缩色彩并保存
            </button>
            {!targetIsBmp && (
              <button
                className="modal-btn"
                onClick={() => {
                  setColorOverflow(null);
                  doSave('rgba');
                }}
              >
                扩展色彩并保存
              </button>
            )}
            <button
              className="modal-btn primary"
              onClick={() => setColorOverflow(null)}
            >
              返回调整
            </button>
          </>
        }
      >
        <div className="color-overflow-body">
          <p>
            当前画面包含 <strong>{colorOverflow?.count}</strong> 种颜色，
            超过了 RM 素材的 256 色限制。<br/>
            建议把各个要素 <strong>拆分到不同的图片</strong>。如果一定要保存，请选择：
          </p>
          <ul className="color-overflow-options">
            <li>
              <strong>压缩色彩</strong>：合并相近的颜色，直到只剩下 256 色
            </li>
            <li>
              <strong>扩展色彩</strong>：直接以 RGBA 真彩色导出
              {targetIsBmp && '（BMP 无 alpha 通道，不支持）'}
            </li>
          </ul>
        </div>
      </Modal>

      <Modal
        open={sizeMismatch !== null}
        title="尺寸不一致"
        onClose={() => setSizeMismatch(null)}
        width={440}
        footer={
          <>
            <button
              className="modal-btn danger"
              onClick={() => {
                const mode = sizeMismatch?.mode ?? 'indexed';
                setSizeMismatch(null);
                doSave(mode, true);
              }}
            >
              仍然覆盖
            </button>
            <button
              className="modal-btn danger"
              onClick={() => {
                const mismatch = sizeMismatch;
                if (!mismatch) return;
                setSizeMismatch(null);
                doSave(mismatch.mode, false, mismatch.target);
              }}
            >
              部分覆盖
            </button>
            <button className="modal-btn primary" onClick={() => setSizeMismatch(null)}>
              返回调整
            </button>
          </>
        }
      >
        <div className="color-overflow-body">
          <p>
            目标图片尺寸为{' '}
            <strong>
              {sizeMismatch?.target.w} × {sizeMismatch?.target.h}
            </strong>
            ，当前画面为{' '}
            <strong>
              {width} × {height}
            </strong>
            ，两者不一致。<br />
          </p>
          <p><strong>仍然覆盖</strong>：直接替换为当前图片，导致尺寸变化</p>
          <p><strong>部分覆盖</strong>：保留原图尺寸，但会将两张图片叠加</p>
        </div>
      </Modal>

      <Modal
        open={pendingSave !== null}
        title={workspace ? '保存图片' : '下载图片'}
        onClose={() => {
          setPendingSave(null);
          setNameError(null);
        }}
        width={420}
        footer={
          <>
            <button
              className="modal-btn"
              onClick={() => {
                setPendingSave(null);
                setNameError(null);
              }}
            >
              取消
            </button>
            <button
              className="modal-btn primary"
              onClick={confirmSaveName}
              disabled={nameChecking}
            >
              {nameChecking ? '检查中…' : workspace ? '保存' : '下载'}
            </button>
          </>
        }
      >
        <div className="field-group">
          <label className="field-label">文件名</label>
          <div className="filename-row">
            <input
              className="filename-input"
              value={nameInput}
              autoFocus
              onChange={(e) => {
                setNameInput(e.target.value);
                setNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmSaveName();
              }}
            />
            <span className="filename-dot">.</span>
            <select
              value={nameExt}
              onChange={(e) => {
                setNameExt(e.target.value as 'png' | 'bmp');
                setNameError(null);
              }}
              disabled={nameChecking}
            >
              <option value="png">png</option>
              <option value="bmp">bmp</option>
            </select>
          </div>
          {nameError && <small className="filename-error">{nameError}</small>}
        </div>
      </Modal>
    </div>
  );
}
