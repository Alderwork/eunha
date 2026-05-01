import { useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Kbd } from './ui/Kbd';

interface Props {
  onClose: () => void;
}

const UNIVERSAL = [
  ['j / k', 'Navigate'],
  ['gg / G', 'Top / bottom'],
  ['Ctrl+d / u', 'Half-page'],
  ['h', 'Previous section'],
  ['l', 'Next section'],
];

const LIBRARY = [
  ['d', 'Describe repo'],
  ['D', 'Describe again'],
  ['A', 'Batch describe'],
  ['o', 'Open in browser'],
  ['/', 'Focus search'],
  ['e', 'Edit notes'],
  ['r', 'Open README tab'],
  ['w', 'Toggle watching'],
  ['W', 'Watching list'],
  ['f', 'Stars feed'],
  [',', 'Settings'],
  ['?', 'Help'],
  ['Esc', 'Close / discard'],
];

const WATCHING = [
  ['r', 'Open releases'],
  ['o', 'Open in browser'],
  ['w', 'Unwatch'],
];

const FEED = [
  ['a', 'Add to library'],
  ['d', 'Add + describe'],
  ['x', 'Dismiss'],
  ['o', 'Open in browser'],
  ['r', 'Refresh feed'],
];

const README = [
  ['j / k', 'Scroll content'],
  ['gg / G', 'Top / bottom'],
  ['Ctrl+d / u', 'Half-page'],
  ['[ / ]', 'Prev / next tab'],
  ['1–9', 'Jump to tab N'],
  ['x', 'Close current tab'],
  ['o', 'Open repo in browser'],
  ['Esc', 'Back to library'],
];

const SPLIT = [
  ['\\', 'Toggle split pane'],
  ['h / l', 'Focus left / right pane'],
  ['Drag gutter', 'Resize panes'],
];

function BindingRow({ binding: [key, desc] }: { binding: string[] }) {
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <Kbd>{key}</Kbd>
      <span className="text-xs text-muted leading-none">{desc}</span>
    </div>
  );
}

function Section({ title, bindings }: { title: string; bindings: string[][] }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-medium text-faint uppercase tracking-wider mb-2">{title}</p>
      <div>
        {bindings.map((b) => (
          <BindingRow key={b[0] + b[1]} binding={b} />
        ))}
      </div>
    </div>
  );
}

export function KeybindingHelp({ onClose }: Props) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '?') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <Modal onClose={onClose} width="w-[560px]">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Keybindings</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-base leading-none">✕</button>
        </div>

        {/* Universal navigation strip */}
        <div className="flex items-center gap-4 px-3 py-2 rounded-md bg-surface border border-border mb-4">
          {UNIVERSAL.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-1.5">
              <Kbd>{key}</Kbd>
              <span className="text-[11px] text-faint">{desc}</span>
            </div>
          ))}
        </div>

        {/* 3-column view-specific bindings */}
        <div className="flex gap-5">
          <Section title="Library" bindings={LIBRARY} />
          <div className="w-px bg-border shrink-0" />
          <Section title="Watching" bindings={WATCHING} />
          <div className="w-px bg-border shrink-0" />
          <Section title="Feed" bindings={FEED} />
        </div>

        <div className="mt-4 pt-3 border-t border-border flex gap-5">
          <Section title="README tabs" bindings={README} />
          <div className="w-px bg-border shrink-0" />
          <Section title="Split view" bindings={SPLIT} />
        </div>
      </div>
    </Modal>
  );
}
