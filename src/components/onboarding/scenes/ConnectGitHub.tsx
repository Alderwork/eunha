import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../ui/Button';

type ValidatePatResult = {
  ok: boolean;
  login: string | null;
  error: string | null;
};

export function ConnectGitHub({
  onValidated,
  onSkipToManual,
  onSpawn,
}: {
  onValidated: () => void;
  onSkipToManual: () => void;
  onSpawn: (n: number) => void;
}) {
  const [pat, setPat] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate() {
    if (!pat.trim() || validating) return;
    setValidating(true);
    setError(null);
    const result = await invoke<ValidatePatResult>('validate_pat', { pat });
    if (result.ok) {
      try {
        await invoke('save_pat', { pat });
        onSpawn(4);
        onValidated();
      } catch (e) {
        setError(`Could not save token — ${e}`);
      }
    } else {
      setError(result.error ?? 'Token rejected');
    }
    setValidating(false);
  }

  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold text-ink mb-2">Connect GitHub</h2>
      <p className="text-sm text-muted mb-6">
        Paste a Personal Access Token to import your starred repos.
      </p>

      <input
        type="password"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleValidate(); }}
        placeholder="ghp_..."
        autoFocus
        className="w-full px-3 py-2 mb-3 rounded bg-surface border border-border text-sm text-ink placeholder:text-faint focus:outline-none focus:border-accent font-mono"
      />

      {error && (
        <p className="text-xs text-danger mb-3 text-left bg-danger-tint px-3 py-2 rounded">
          {error}
        </p>
      )}

      <Button
        variant="primary"
        onClick={handleValidate}
        disabled={validating || !pat.trim()}
        className="w-full px-4 py-2 text-sm mb-4"
      >
        {validating ? 'Validating…' : 'Continue'}
      </Button>

      <button
        type="button"
        onClick={onSkipToManual}
        className="text-xs text-muted hover:text-dim underline-offset-2 hover:underline"
      >
        Skip — add repos manually instead
      </button>
    </div>
  );
}
