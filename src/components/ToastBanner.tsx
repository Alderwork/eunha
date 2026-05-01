interface Props {
  message: string | null;
  type?: 'info' | 'error' | 'warn';
}

export function ToastBanner({ message, type = 'info' }: Props) {
  if (!message) return null;

  const colors = {
    info:  'bg-panel border-border text-muted',
    error: 'bg-danger-tint border-danger/30 text-danger',
    warn:  'bg-warn-tint border-warn/30 text-warn',
  };

  return (
    <div className={`text-xs px-4 py-2 border-b ${colors[type]} flex-shrink-0`}>
      {message}
    </div>
  );
}
