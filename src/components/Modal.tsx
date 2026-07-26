// 通用模态框组件
import { useEffect, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  height?: number | string;
}

export default function Modal({
  open, title, onClose, children, footer, width = 560, height = 'auto',
}: ModalProps) {
  // 按 Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width, height }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
