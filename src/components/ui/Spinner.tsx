interface Props {
  size?: number;
  className?: string;
  title?: string;
}

// Inline spinner — tiny rotating arc, matches Linear's compact aesthetic.
// Used to indicate per-row work (e.g., describe in flight).
export function Spinner({ size = 11, className = 'text-accent', title }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={title ?? 'Working'}
      className={`flex-shrink-0 animate-spin ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
