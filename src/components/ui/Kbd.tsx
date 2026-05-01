interface Props {
  children: React.ReactNode;
}

export function Kbd({ children }: Props) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-[2px] border border-border bg-surface text-faint font-mono text-[11px] leading-none">
      {children}
    </kbd>
  );
}
