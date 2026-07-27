// FaceSet 图选择器模态框
//
// 功能：
//   - 左侧：素材列表（built-in + user），用户素材可删除
//   - 右侧：4×4 脸图网格，点击一格选中 faceIndex
//   - 列表底部"新增素材"按钮（导入 192×192 或 48 的倍数的图片）
//
// 注意：FaceSet 不处理透明色。因为实际使用的脸图总是一个完整的 48×48 子图，
// 即使 FaceSet 中有空白位置也不会被选中；未选择脸图时位置留空（由父级 faceMode='face' + 未选择素材表达）。

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
import { RPG_CONSTANTS, type LoadedImage } from '../../types';
import { useStore } from '../../store/useStore';

export interface FaceSetPickerValue {
  name: string;
  image: LoadedImage;
  faceIndex: number;
}

export interface FaceSetPickerProps {
  open: boolean;
  currentName: string | null;
  currentFaceIndex: number;
  onClose: () => void;
  onApply: (value: FaceSetPickerValue) => void;
  title?: string;
}

const FACESET_SIZE = 192; // 4 × 48
const CELL = RPG_CONSTANTS.FACE_SIZE; // 48

export default function FaceSetPicker({
  open,
  currentName,
  currentFaceIndex,
  onClose,
  onApply,
  title = '选择 FaceSet',
}: FaceSetPickerProps) {
  const assets = useAssets('FaceSet');
  const workspace = useStore((s) => s.workspace);
  const saveAssetToWorkspace = useStore((s) => s.saveAssetToWorkspace);
  const removeAssetFromWorkspace = useStore((s) => s.removeAssetFromWorkspace);
  const [selectedName, setSelectedName] = useState<string | null>(currentName);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [faceIndex, setFaceIndex] = useState(currentFaceIndex);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedName(currentName);
      setFaceIndex(currentFaceIndex);
    }
  }, [open, currentName, currentFaceIndex]);

  useEffect(() => {
    if (!open || !selectedName) {
      setLoadedImage(null);
      setLoadingError(null);
      return;
    }
    const asset = findAsset('FaceSet', selectedName);
    if (!asset) {
      setLoadedImage(null);
      return;
    }
    let cancelled = false;
    setLoadingError(null);
    loadImage(asset.url)
      .then((img) => {
        if (cancelled) return;
        setLoadedImage(img);
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
        const entry = await saveAssetToWorkspace('FaceSet', file);
        if (entry) {
          setSelectedName(entry.name);
        } else {
          setLoadingError('保存到工作区失败');
        }
      } else {
        const entry = await addUserAsset('FaceSet', file);
        setSelectedName(entry.name);
      }
    } catch (e) {
      setLoadingError(`导入失败：${e}`);
    }
  };

  const handleRemoveAsset = async (name: string, source: string) => {
    if (!confirm(`确定要删除素材"${name}"吗？`)) return;
    if (source === 'workspace') {
      await removeAssetFromWorkspace('FaceSet', name);
    } else {
      removeUserAsset('FaceSet', name);
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
      faceIndex,
    });
    onClose();
  };

  const sortedAssets = useMemo(() => {
    const list = listAssets('FaceSet');
    return [...list].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [assets]);

  // 计算 FaceSet 图片尺寸是否符合 4×4 网格
  const imageSize = loadedImage
    ? loadedImage instanceof HTMLImageElement
      ? { w: loadedImage.naturalWidth, h: loadedImage.naturalHeight }
      : { w: loadedImage.width, h: loadedImage.height }
    : null;
  const isStandard = imageSize?.w === FACESET_SIZE && imageSize?.h === FACESET_SIZE;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={520}
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
          <span>FaceSet 素材</span>
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
        {loadingError && <div className="warning-banner">{loadingError}</div>}
        {loadedImage && imageSize ? (
          <>
            <div className="asset-preview-wrapper">
              <div
                className="face-grid"
                style={{
                  width: FACESET_SIZE,
                  height: FACESET_SIZE,
                  backgroundImage: `url(${
                    loadedImage instanceof HTMLImageElement ? loadedImage.src : ''
                  })`,
                  backgroundSize: `${FACESET_SIZE}px ${FACESET_SIZE}px`,
                  imageRendering: 'pixelated',
                }}
              >
                {Array.from({ length: 16 }, (_, i) => {
                  const col = i % 4;
                  const row = Math.floor(i / 4);
                  return (
                    <button
                      key={i}
                      className={`face-cell ${i === faceIndex ? 'selected' : ''}`}
                      style={{
                        left: col * CELL,
                        top: row * CELL,
                        width: CELL,
                        height: CELL,
                      }}
                      onClick={() => setFaceIndex(i)}
                      title={`脸图 ${i}（行 ${row}，列 ${col}）`}
                    />
                  );
                })}
              </div>
            </div>
            <div className="asset-info">
              <span>
                尺寸：{imageSize.w} × {imageSize.h}
                {isStandard ? (
                  <span style={{ color: 'var(--color-success)' }}> ✓ 标准 4×4</span>
                ) : (
                  <span style={{ color: 'var(--color-warning)' }}>
                    {' '}
                    ⚠ 非 {FACESET_SIZE}×{FACESET_SIZE}
                  </span>
                )}
              </span>
              <span>
                当前选中：第 {faceIndex + 1} 张（行 {Math.floor(faceIndex / 4) + 1}，列{' '}
                {faceIndex % 4 + 1}）
              </span>
            </div>
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
