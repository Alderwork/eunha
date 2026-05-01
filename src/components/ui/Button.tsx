import { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover rounded font-medium',
  ghost:   'text-muted hover:text-ink border border-border hover:border-dim rounded',
  subtle:  'bg-white/[0.04] text-muted hover:text-ink rounded',
  icon:    'text-muted hover:text-ink rounded',
};

export function Button({ variant = 'ghost', className = '', children, ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center transition-colors disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
