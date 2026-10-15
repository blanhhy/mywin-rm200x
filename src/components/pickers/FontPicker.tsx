// 字体选择器模态框
//
// 两种来源：
//   - 本机已安装字体：通过 Local Font Access API（queryLocalFonts）读取，
//     需要用户授权；浏览器不支持时只能改用字体文件
//   - 字体文件：导入 ttf / otf / woff / woff2，注册为 FontFace 后即可使用

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal';
import { registerFontFile } from '../../engine/fontLoader';

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
export interface FontPickerValue {
  source: 'local' | 'file';
  label: string;
  family: string;
}

export interface FontPickerProps {
  open: boolean;
  onClose: () => void;
  onApply: (value: FontPickerValue) => void;
}

export default function FontPicker({ open, onClose, onApply }: FontPickerProps) {
  const [fonts, setFonts] = useState<FontPickerValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<FontPickerValue | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 关闭时清空搜索与选中，避免下次打开残留
  useEffect(() => {
    if (!open) {
      setKeyword('');
      setSelected(null);
    }
  }, [open]);

  const localSupported =
    typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

  const handleLoadLocalFonts = async () => {
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
      const items = [...byFamily.values()].sort((a, b) => a.label.localeCompare(b.label));
      // 保留已导入的字体文件项
      setFonts((prev) => [...items, ...prev.filter((p) => p.source === 'file')]);
    } catch (e) {
      setError(`读取本机字体失败：${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    try {
      const family = await registerFontFile(file);
      const item: FontPickerValue = { source: 'file', label: file.name, family };
      setFonts((prev) => [item, ...prev]);
      setSelected(item);
    } catch (e) {
      setError(`字体文件加载失败：${e}`);
    }
  };

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return fonts;
    return fonts.filter((f) => f.label.toLowerCase().includes(k));
  }, [fonts, keyword]);

  const handleApply = () => {
    if (!selected) return;
    onApply(selected);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="选择字体"
      onClose={onClose}
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
        <div className="font-source-bar">
          <button
            className="upload-btn"
            onClick={handleLoadLocalFonts}
            disabled={!localSupported || loading}
          >
            {loading ? '读取中…' : '读取本机字体…'}
          </button>
        </div>
        <input
          className="font-search"
          placeholder="搜索字体…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="asset-list-header">
          <span>字体</span>
          <span>{filtered.length}</span>
        </div>
        {filtered.map((f) => (
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
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="font-list-empty">
            {fonts.length === 0
              ? localSupported
                ? '点击【读取本机字体…】列出已安装字体，或导入字体文件'
                : '当前浏览器不支持读取本机字体，请导入字体文件'
              : '没有匹配的字体'}
          </div>
        )}
        <button className="asset-add-btn" onClick={() => fileInputRef.current?.click()}>
          + 导入字体文件…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
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
          <div className="font-preview-empty">从左侧选择一个字体，或导入字体文件</div>
        )}
      </div>
    </Modal>
  );
}
