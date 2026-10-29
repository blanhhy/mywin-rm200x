// 通用模态框组件
import { useEffect, useRef, type ReactNode } from 'react';

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
  /** 本次按下是否发生在遮罩上（用于区分“内部按下、外部松开”） */
  const pressOnOverlay = useRef(false);

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
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        pressOnOverlay.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        // 只在“按下与松开都在遮罩上”时关闭；
        // 在弹窗内按下（如长按选文字）后移到外部松开不会触发
        if (pressOnOverlay.current && e.target === e.currentTarget) onClose();
        pressOnOverlay.current = false;
      }}
    >
      <div className="modal" style={{ width, height }}>
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
