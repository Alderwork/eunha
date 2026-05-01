import { Button } from '../../ui/Button';
import { Kbd } from '../../ui/Kbd';

export function Done({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold text-ink mb-2">You're in</h2>
      <p className="text-sm text-muted mb-6">
        Press <Kbd>d</Kbd> on any repo to describe it with AI.
      </p>
      <Button variant="primary" onClick={onContinue} className="w-full px-4 py-2 text-sm">
        Continue
      </Button>
    </div>
  );
}
