// System 图选择器模态框
//
// 功能：
//   - 左侧：素材列表（built-in + user）
//     · 用户素材可删除（hover 时显示删除按钮）
//     · 列表底部"新增素材"按钮（导入文件后自动持久化）
//   - 右侧：详情面板
//     · System 图预览（160×80，棋盘格底）
//     · 透明色选择器（颜色 input + 自动推断按钮）
//   - 底部：取消 / 应用
//
// 透明色默认采用推断策略（System 布局取最后一格，回退到角落/最大连通区域）。

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import {
  addUserAsset,
  findAsset,
  listAssets,
  removeUserAsset,
} from '../../engine/assetLoader';
import { useAssets } from '../../hooks/useAssets';
import { loadImage } from '../../engine/messageWindow';
import { inferTransparentColorFromBuffer, inferTransparentColor } from '../../engine/transparentColorInference';
import { RPG_CONSTANTS, type LoadedImage } from '../../types';
import { useStore } from '../../store/useStore';

export interface SystemPickerValue {
  name: string;
  image: LoadedImage;
  transparentColor: string;
}

export interface SystemPickerProps {
  open: boolean;
  /** 当前选中的素材名（null 表示未选择） */
  currentName: string | null;
  /** 当前透明色（用于初始化） */
  currentTransparentColor: string;
  onClose: () => void;
  onApply: (value: SystemPickerValue) => void;
  /** 模态框标题 */
  title?: string;
}

export default function SystemPicker({
  open,
  currentName,
  currentTransparentColor,
  onClose,
  onApply,
  title = '选择 System 图',
}: SystemPickerProps) {
  const assets = useAssets('System');
  const workspace = useStore((s) => s.workspace);
  const saveAssetToWorkspace = useStore((s) => s.saveAssetToWorkspace);
  const removeAssetFromWorkspace = useStore((s) => s.removeAssetFromWorkspace);
  const [selectedName, setSelectedName] = useState<string | null>(currentName);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [transparentColor, setTransparentColor] = useState(currentTransparentColor);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当模态框打开或 currentName 变化时同步
  useEffect(() => {
    if (open) {
      setSelectedName(currentName);
      setTransparentColor(currentTransparentColor);
    }
  }, [open, currentName, currentTransparentColor]);

  // 选中素材时加载图像
  useEffect(() => {
    if (!open || !selectedName) {
      setLoadedImage(null);
      setLoadingError(null);
      return;
    }
    const asset = findAsset('System', selectedName);
    if (!asset) {
      setLoadedImage(null);
      return;
    }
    let cancelled = false;
    setLoadingError(null);
    loadImage(asset.url)
      .then(async (img) => {
        if (cancelled) return;
        setLoadedImage(img);
        // 自动推断透明色：优先解析 PNG 调色板 index 0（RTP 标准约定）
        const inferred = await inferTransparentColorFromBuffer(
          asset.url,
          img,
          { systemLayout: true },
        );
        if (cancelled) return;
        if (inferred) setTransparentColor(inferred);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadingError(String(e) || '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedName]);

  const handleAddAsset = async (file: File) => {
    try {
      if (workspace) {
        const entry = await saveAssetToWorkspace('System', file);
        if (entry) {
          setSelectedName(entry.name);
        } else {
          setLoadingError('保存到工作区失败');
        }
      } else {
        const entry = await addUserAsset('System', file);
        setSelectedName(entry.name);
      }
    } catch (e) {
      setLoadingError(`导入失败：${e}`);
    }
  };

  const handleRemoveAsset = async (name: string, source: string) => {
    if (!confirm(`确定要删除素材"${name}"吗？`)) return;
    if (source === 'workspace') {
      await removeAssetFromWorkspace('System', name);
    } else {
      removeUserAsset('System', name);
    }
    if (selectedName === name) {
      setSelectedName(null);
      setLoadedImage(null);
    }
  };

  const handleApply = () => {
    if (!selectedName || !loadedImage) {
      onClose();
      return;
    }
    onApply({
      name: selectedName,
      image: loadedImage,
      transparentColor,
    });
    onClose();
  };

  const handleAutoInfer = async () => {
    if (!loadedImage || !selectedName) return;
    const asset = findAsset('System', selectedName);
    const url = asset?.url;
    const inferred = url
      ? await inferTransparentColorFromBuffer(url, loadedImage, { systemLayout: true })
      : inferTransparentColor(loadedImage, { systemLayout: true });
    if (inferred) setTransparentColor(inferred);
  };

  // 点击 System 图上的像素来选取透明色
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!loadedImage) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    // 缩放后的像素坐标 → 原始像素坐标
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const px = Math.floor((e.clientX - rect.left) * scaleX);
    const py = Math.floor((e.clientY - rect.top) * scaleY);
    // 取该像素颜色
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    try {
      const data = ctx.getImageData(px, py, 1, 1).data;
      if (data[3] !== 0) {
        const hex = `#${data[0].toString(16).padStart(2, '0')}${data[1]
          .toString(16)
          .padStart(2, '0')}${data[2].toString(16).padStart(2, '0')}`;
        setTransparentColor(hex);
      }
    } catch {
      // CORS 或其他错误，忽略
    }
  };

  const sortedAssets = useMemo(() => {
    const list = listAssets('System');
    // built-in 优先，user 在后
    return [...list].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [assets]);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="modal-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="modal-btn primary"
            onClick={handleApply}
            disabled={!loadedImage}
          >
            应用
          </button>
        </>
      }
    >
      <div className="asset-list">
        <div className="asset-list-header">
          <span>System 素材</span>
          <span>{sortedAssets.length}</span>
        </div>
        {sortedAssets.map((a) => (
          <div
            key={`${a.source}:${a.name}`}
            className={`asset-item ${selectedName === a.name ? 'selected' : ''}`}
            onClick={() => setSelectedName(a.name)}
            title={
              a.source === 'builtin'
                ? '内置 RTP'
                : a.source === 'workspace'
                  ? '工作区素材'
                  : '用户导入'
            }
          >
            <span className="asset-name">{a.name}</span>
            <span
              className={`asset-tag ${a.source === 'workspace' ? 'tag-workspace' : ''}`}
            >
              {a.source === 'builtin' ? 'RTP' : a.source === 'workspace' ? 'WORK' : 'USER'}
            </span>
            {a.source !== 'builtin' && (
              <button
                className="modal-close"
                style={{ width: 18, height: 18, fontSize: 13, marginLeft: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveAsset(a.name, a.source);
                }}
                title="删除"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="asset-add-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          + 新增素材…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/bmp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleAddAsset(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="asset-detail">
        {loadingError && (
          <div className="warning-banner">{loadingError}</div>
        )}
        {loadedImage ? (
          <>
            <div className="asset-preview-wrapper">
              <img
                src={
                  loadedImage instanceof HTMLImageElement ? loadedImage.src : ''
                }
                alt="System"
                style={{
                  width: RPG_CONSTANTS.SYSTEM_WIDTH * 2,
                  height: RPG_CONSTANTS.SYSTEM_HEIGHT * 2,
                  imageRendering: 'pixelated',
                  cursor: 'crosshair',
                }}
                onClick={handleImageClick}
                title="单击取色"
              />
            </div>
            <div className="asset-info">
              <span>
                尺寸：
                {loadedImage instanceof HTMLImageElement
                  ? `${loadedImage.naturalWidth} × ${loadedImage.naturalHeight}`
                  : `${loadedImage.width} × ${loadedImage.height}`}
                {loadedImage instanceof HTMLImageElement &&
                  loadedImage.naturalWidth === RPG_CONSTANTS.SYSTEM_WIDTH &&
                  loadedImage.naturalHeight === RPG_CONSTANTS.SYSTEM_HEIGHT && (
                    <span style={{ color: 'var(--color-success)' }}> ✓ 标准</span>
                  )}
              </span>
              <span>素材名：{selectedName}</span>
            </div>
            <div className="transparent-color-picker">
              <span>透明色：</span>
              <input
                type="color"
                value={transparentColor}
                onChange={(e) => setTransparentColor(e.target.value)}
              />
              <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {transparentColor.toUpperCase()}
              </code>
              <button
                className="auto-detect-btn"
                onClick={handleAutoInfer}
              >
                自动
              </button>
            </div>
            <small className="field-hint">
              点击图片任意像素可更改透明色
            </small>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-dim)',
              fontSize: 12,
              padding: 24,
            }}
          >
            从左侧列表选择一个素材，或者【新增素材】
          </div>
        )}
      </div>
    </Modal>
  );
}
