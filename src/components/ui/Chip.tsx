import { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'warn' | 'dim' | 'mono';

interface Props {
  tone?: Tone;
  prefix?: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<Tone, string> = {
  default: 'bg-surface text-muted',
  accent: 'bg-accent/15 text-accent',
  warn: 'bg-warn-tint text-warn',
  dim: 'text-faint',
  mono: 'bg-elevated text-ink font-mono',
};

export function Chip({ tone = 'default', prefix, title, children, className = '' }: Props) {
  return (
    <span
      title={title}
      className={`text-xs px-1.5 py-0.5 rounded-[2px] inline-flex items-center gap-1 flex-shrink-0 leading-none ${TONE_CLASSES[tone]} ${className}`}
    >
      {prefix}
      {children}
    </span>
  );
}
