import { useState, useEffect, useCallback } from 'react';
import { DigestBatch, DigestItem, Repo } from '../types';

interface Props {
  batch: DigestBatch;
  describing: Set<string>;
  onClose: () => void;
  onOpen: (repo: Repo) => void;
  onDescribe: (repo: Repo) => Promise<Repo | null>;
  onEdit: (repo: Repo) => void;
  onAction: (repoId: string, action: string) => void;
}

const REASON_META: Record<DigestItem['reason'], { icon: string; cls: string }> = {
  release: { icon: '⬆', cls: 'text-accent' },
  undescribed: { icon: '✦', cls: 'text-muted' },
  forgotten: { icon: '🕸', cls: 'text-faint' },
  serendipity: { icon: '✦', cls: 'text-faint' },
};

function reasonLabel(item: DigestItem): string {
  switch (item.reason) {
    case 'release':
      return item.reason_detail || '새 릴리스';
    case 'undescribed':
      return '아직 설명 안 함';
    case 'forgotten': {
      const m = parseInt(item.reason_detail, 10);
      if (!Number.isFinite(m) || m <= 0) return '오랫동안 안 봄';
      if (m >= 12) {
        const y = Math.floor(m / 12);
        const r = m % 12;
        return r ? `${y}년 ${r}개월째 안 봄` : `${y}년째 안 봄`;
      }
      return `${m}개월째 안 봄`;
    }
    case 'serendipity':
      return '오랜만에';
  }
}

export function DigestCard({ batch, describing, onClose, onOpen, onDescribe, onEdit, onAction }: Props) {
  const [items, setItems] = useState<DigestItem[]>(batch.items);
  const [actions, setActions] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of batch.items) if (it.action) init[it.repo.id] = it.action;
    return init;
  });
  const [sel, setSel] = useState(0);

  const setAction = useCallback(
    (repoId: string, action: string) => {
      setActions((a) => ({ ...a, [repoId]: action }));
      onAction(repoId, action);
    },
    [onAction],
  );

  const handle = useCallback(
    async (idx: number, key: 'o' | 'd' | 'e' | 'x') => {
      const item = items[idx];
      if (!item) return;
      const repo = item.repo;
      if (key === 'o') {
        onOpen(repo);
        setAction(repo.id, 'opened');
      } else if (key === 'd') {
        const updated = await onDescribe(repo);
        if (updated) {
          setItems((its) =>
            its.map((it, i) =>
              i === idx
                ? { ...it, repo: updated, reason: it.reason === 'undescribed' ? 'forgotten' : it.reason }
                : it,
            ),
          );
          setAction(repo.id, 'described');
        }
      } else if (key === 'e') {
        onEdit(repo);
      } else if (key === 'x') {
        setAction(repo.id, 'archived');
      }
    },
    [items, onOpen, onDescribe, onEdit, setAction],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'o' || e.key === 'd' || e.key === 'e' || e.key === 'x') {
        e.preventDefault();
        void handle(sel, e.key);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, sel, handle, onClose]);

  const d = new Date(batch.batch_date);
  const dateStr = Number.isNaN(d.getTime()) ? batch.batch_date : `${d.getMonth() + 1}/${d.getDate()}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-panel border border-border rounded-lg w-[560px] shadow-dialog flex flex-col max-h-[80vh]">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">✦ 잊고 있던 별 {items.length}개</h2>
            <span className="text-xs text-faint">이번 주 · {dateStr}</span>
          </div>
          <p className="text-xs text-muted mt-1">별만 찍고 잊은 repo들이에요. 오늘 다시 들여다볼까요?</p>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {items.map((item, i) => {
            const archived = actions[item.repo.id] === 'archived';
            const opened = actions[item.repo.id] === 'opened';
            const meta = REASON_META[item.reason];
            const body = item.repo.llm_what ?? item.repo.description ?? '(설명 없음)';
            return (
              <div
                key={item.repo.id}
                onClick={() => setSel(i)}
                className={`relative px-5 py-2.5 cursor-pointer ${i === sel ? 'bg-elevated' : ''} ${archived ? 'opacity-40' : ''}`}
              >
                {i === sel && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />}
                <div className="flex items-center gap-2">
                  {item.repo.owner_avatar_url && (
                    <img src={item.repo.owner_avatar_url} className="w-4 h-4 rounded-sm" alt="" />
                  )}
                  <span className={`text-sm font-medium text-accent truncate ${archived ? 'line-through' : ''}`}>
                    {item.repo.full_name}
                  </span>
                  {item.repo.language && <span className="text-[11px] text-faint">{item.repo.language}</span>}
                  <span className={`ml-auto text-[11px] ${meta.cls} flex items-center gap-1 flex-shrink-0`}>
                    {describing.has(item.repo.id) ? (
                      '설명 중…'
                    ) : (
                      <>
                        <span>{meta.icon}</span>
                        <span>{reasonLabel(item)}</span>
                      </>
                    )}
                  </span>
                </div>
                <p className={`text-xs text-dim mt-0.5 truncate ${archived ? 'line-through' : ''}`}>
                  {opened ? '✓ ' : ''}
                  {body}
                </p>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border flex items-center justify-between text-[11px] text-faint">
          <span>j/k 이동 · o 열기 · d 설명 · e 노트 · x 안보기</span>
          <button onClick={onClose} className="px-3 py-1 rounded bg-brand text-ink text-xs font-medium">
            계속 →
          </button>
        </div>
      </div>
    </div>
  );
}
