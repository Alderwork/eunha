import { Button } from '../../ui/Button';

export function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-ink mb-3 tracking-tight">eunha</h1>
      <p className="text-base text-dim mb-8 leading-relaxed">
        Your starred repos, organized.
      </p>
      <Button variant="primary" onClick={onContinue} className="px-6 py-2 text-sm">
        Continue
      </Button>
    </div>
  );
}
