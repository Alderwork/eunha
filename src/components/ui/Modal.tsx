import { useEffect } from 'react';

interface Props {
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}

export function Modal({ onClose, width = 'w-[480px]', children }: Props) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-panel border border-border rounded-lg ${width} shadow-dialog`}>
        {children}
      </div>
    </div>
  );
}
