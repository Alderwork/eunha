interface Props {
  message: string | null;
  type?: 'info' | 'error' | 'warn';
}

export function ToastBanner({ message, type = 'info' }: Props) {
  if (!message) return null;

  const colors = {
    info: 'bg-[#1a1a20] border-[var(--border)] text-[var(--muted)]',
    error: 'bg-red-950/30 border-red-900 text-red-400',
    warn: 'bg-[#2a2010] border-[#5a4020] text-[#a06830]',
  };

  return (
    <div className={`text-xs px-4 py-2 border-b ${colors[type]} flex-shrink-0`}>
      {message}
    </div>
  );
}
