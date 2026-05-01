import { useState } from 'react';

interface Props {
  src: string | null | undefined;
  login: string;
  size: number;
}

export function Avatar({ src, login, size }: Props) {
  const [failed, setFailed] = useState(false);
  const initial = login.charAt(0).toUpperCase();

  if (!src || failed) {
    return (
      <span
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        className="rounded-full border border-border bg-elevated flex items-center justify-center text-muted font-medium flex-shrink-0 select-none"
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={login}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="rounded-full border border-border flex-shrink-0 object-cover"
    />
  );
}
