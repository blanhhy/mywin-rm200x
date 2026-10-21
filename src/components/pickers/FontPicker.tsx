// 字体选择器（两级弹窗）
//
// 一级：已添加字体列表 + 预览；底部可以「添加本机字体」「导入字体文件」
// 二级：添加本机字体 —— 列出了本机已安装字体
//       左键预览、右键多选，底部「添加」把勾选的字体（未勾选时用当前预览的字体）
//       加入一级列表
//
// 之所以分成两级，是因为本机字体动辄几百上千个，不应该直接混进已添加字体列表。

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import { importUserFont, removeUserFont } from '../../engine/fontLoader';
import { useStore } from '../../store/useStore';
import type { CustomFontEntry } from '../../types';

interface LocalFontData {
  family: string;
  fullName: string;
  style: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

/** 选择结果：family 是可直接写进 CSS font-family 的名字 */
export type FontPickerValue = CustomFontEntry;

export interface FontPickerProps {
  open: boolean;
  onClose: () => void;
  onApply: (value: FontPickerValue) => void;
}

export default function FontPicker({ open, onClose, onApply }: FontPickerProps) {
  /** 已添加的字体保存在全局 store，切换标签页/重开弹窗都不会丢失 */
  const fonts = useStore((s) => s.customFonts);
  const addCustomFonts = useStore((s) => s.addCustomFonts);
  const removeCustomFont = useStore((s) => s.removeCustomFont);
  const [selected, setSelected] = useState<FontPickerValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  /** Escape 监听在两级弹窗上都会触发，用它让一级忽略"二级打开时"的关闭 */
  const localOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localOpenRef.current = localOpen;
  }, [localOpen]);

  // 关闭时清空选中，避免下次打开残留
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setLocalOpen(false);
      setError(null);
    }
  }, [open]);

  const localSupported =
    typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

  const handleAddLocal = (items: FontPickerValue[]) => {
    addCustomFonts(items);
    if (items.length > 0) setSelected(items[0]);
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    try {
      const item = await importUserFont(file);
      addCustomFonts([item]);
      setSelected(item);
    } catch (e) {
      setError(`字体文件加载失败：${e}`);
    }
  };

  /**
   * 从字体列表移除一项
   * 导入的字体同时清理持久化数据；本机字体只是移出可用列表，不动系统安装
   */
  const handleRemoveFont = async (f: FontPickerValue) => {
    if (!confirm(`确定要移除字体"${f.label}"吗？`)) return;
    if (f.source === 'file') await removeUserFont(f.family);
    removeCustomFont(f.family);
    if (selected?.family === f.family) setSelected(null);
  };

  const handleApply = () => {
    if (!selected) return;
    onApply(selected);
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        title="选择字体"
        onClose={() => {
          if (!localOpenRef.current) onClose();
        }}
        width={620}
        footer={
          <>
            <button className="modal-btn" onClick={onClose}>
              取消
            </button>
            <button className="modal-btn primary" onClick={handleApply} disabled={!selected}>
              应用
            </button>
          </>
        }
      >
        <div className="asset-list">
          <div className="asset-list-header">
            <span>字体</span>
            <span>{fonts.length}</span>
          </div>
          {fonts.map((f) => (
            <div
              key={`${f.source}:${f.family}`}
              className={`asset-item ${
                selected?.family === f.family && selected?.source === f.source ? 'selected' : ''
              }`}
              onClick={() => setSelected(f)}
              title={f.label}
            >
              <span className="asset-name">{f.label}</span>
              <span className={`asset-tag ${f.source === 'file' ? 'tag-workspace' : ''}`}>
                {f.source === 'local' ? '本机' : '文件'}
              </span>
              <button
                className="modal-close"
                style={{ width: 18, height: 18, fontSize: 13, marginLeft: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleRemoveFont(f);
                }}
                title="移除"
              >
                ×
              </button>
            </div>
          ))}
          {fonts.length === 0 && (
            <div className="font-list-empty">
              {localSupported
                ? '还没有字体。请导入字体文件或添加本机字体'
                : '还没有字体。请导入字体文件'}
            </div>
          )}
          <div className="font-add-row">
            <button className="asset-add-btn" onClick={() => fileInputRef.current?.click()}>
              + 导入字体文件…
            </button>
            {localSupported && (
            <button className="asset-add-btn" onClick={() => setLocalOpen(true)}>
              + 添加本机字体…
            </button>)}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="asset-detail">
          {error && <div className="warning-banner">{error}</div>}
          {selected ? (
            <>
              <div className="font-preview" style={{ fontFamily: `"${selected.family}"` }}>
                <div style={{ fontSize: 24 }}>你好，世界！</div>
                <div style={{ fontSize: 16 }}>Hello World! 0123456789</div>
              </div>
              <div className="asset-info">
                <span>来源：{selected.source === 'local' ? '本机已安装字体' : '字体文件'}</span>
                <span>名称：{selected.label}</span>
              </div>
            </>
          ) : (
            <div className="font-preview-empty">从左侧选择一个字体</div>
          )}
        </div>
      </Modal>

      <LocalFontPicker
        open={open && localOpen}
        onClose={() => setLocalOpen(false)}
        onAdd={handleAddLocal}
      />
    </>
  );
}

interface LocalFontPickerProps {
  open: boolean;
  onClose: () => void;
  onAdd: (items: FontPickerValue[]) => void;
}

/** 二级弹窗：从本机已安装字体里挑选，可多选 */
function LocalFontPicker({ open, onClose, onAdd }: LocalFontPickerProps) {
  const [fonts, setFonts] = useState<FontPickerValue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  /** 左键预览的字体 */
  const [preview, setPreview] = useState<FontPickerValue | null>(null);
  /** 右键多选的字体族集合 */
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!window.queryLocalFonts) return;
    setLoading(true);
    setError(null);
    try {
      const list = await window.queryLocalFonts();
      // 同一个族可能包含常规/粗体/斜体等多个字形，只保留一族一项
      const byFamily = new Map<string, FontPickerValue>();
      for (const f of list) {
        if (!byFamily.has(f.family)) {
          byFamily.set(f.family, { source: 'local', label: f.family, family: f.family });
        }
      }
      setFonts([...byFamily.values()].sort((a, b) => a.label.localeCompare(b.label)));
    } catch (e) {
      setError(`读取本机字体失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  // 每次打开重置临时选中状态；字体清单只读取一次
  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setPreview(null);
    setChecked(new Set());
    setError(null);
    if (fonts === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const list = fonts ?? [];
    if (!k) return list;
    return list.filter((f) => f.label.toLowerCase().includes(k));
  }, [fonts, keyword]);

  const toggleChecked = (family: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  };

  const handleAdd = () => {
    const list = fonts ?? [];
    const items = checked.size > 0
      ? list.filter((f) => checked.has(f.family))
      : preview
        ? [preview]
        : [];
    if (items.length === 0) return;
    onAdd(items);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="本机字体"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="modal-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="modal-btn primary"
            onClick={handleAdd}
            disabled={checked.size === 0 && !preview}
          >
            添加
          </button>
        </>
      }
    >
      <div className="asset-list">
        <input
          className="font-search"
          placeholder="搜索本机字体…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          autoFocus
        />
        <div className="asset-list-header">
          <span>字体</span>
          <span>{loading ? '…' : filtered.length}</span>
        </div>
        {filtered.map((f) => {
          const isChecked = checked.has(f.family);
          return (
            <div
              key={`local:${f.family}`}
              className={`asset-item ${preview?.family === f.family ? 'selected' : ''} ${
                isChecked ? 'multi-selected' : ''
              }`}
              onClick={() => setPreview(f)}
              onContextMenu={(e) => {
                e.preventDefault();
                toggleChecked(f.family);
              }}
              title="左键预览，右键多选"
            >
              <button
                type="button"
                className={`asset-check ${isChecked ? 'on' : ''}`}
                aria-pressed={isChecked}
                title={isChecked ? '取消多选' : '加入多选'}
                onClick={(e) => {
                  // 只切换勾选，不触发整行的预览
                  e.stopPropagation();
                  toggleChecked(f.family);
                }}
              >
                {isChecked ? '✓' : ''}
              </button>
              <span className="asset-name">{f.label}</span>
            </div>
          );
        })}
        {loading && <div className="font-list-empty">读取中…</div>}
        {!loading && error && <div className="warning-banner">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="font-list-empty">
            {fonts === null ? '正在读取本机字体…' : '没有匹配的字体'}
          </div>
        )}
      </div>

      <div className="asset-detail">
        {preview ? (
          <>
            <div className="font-preview" style={{ fontFamily: `"${preview.family}"` }}>
              <div style={{ fontSize: 24 }}>你好，世界！</div>
              <div style={{ fontSize: 16 }}>Hello World! 0123456789</div>
            </div>
            <div className="asset-info">
              <span>名称：{preview.label}</span>
              {checked.size > 0 && <span>已多选 {checked.size} 个字体，点「添加」批量加入</span>}
            </div>
          </>
        ) : (
          <div className="font-preview-empty">左键预览字体，右键可以多选</div>
        )}
      </div>
    </Modal>
  );
}
