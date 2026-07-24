import { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
}

/**
 * Standard empty state: optional icon, one-line headline, one-line guidance.
 * Matches the detail sidebar's "No repo selected" pattern — composed block,
 * not a bare line of text floating in a void.
 */
export function EmptyState({ icon, title, hint }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      {icon && <div className="text-faint mb-1 opacity-70">{icon}</div>}
      <span className="text-sm text-muted">{title}</span>
      {hint && <span className="text-xs text-faint flex items-center gap-1">{hint}</span>}
    </div>
  );
}
