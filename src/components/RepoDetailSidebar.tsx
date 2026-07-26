import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Repo, Collection, SimilarRepo, ContributionData } from '../types';
import { Kbd } from './ui/Kbd';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Props {
  repo: Repo | null;
  isDescribing: boolean;
  currentPromptVersion: number;
  onOpenUrl: () => void;
  onClose: () => void;
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatStars(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function RepoDetailSidebar({
  repo,
  isDescribing,
  currentPromptVersion,
  onOpenUrl,
  onClose,
}: Props) {
  return (
    <aside className="flex flex-col h-full w-80 flex-shrink-0 border-l border-border bg-panel overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-9 border-b border-border">
        <span className="text-[10px] font-mono uppercase tracking-wider text-faint">Detail</span>
        <button
          onClick={onClose}
          className="text-faint hover:text-ink leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-elevated"
          title="Close (i)"
          aria-label="Close detail sidebar"
        >
          ✕
        </button>
      </div>

      {repo === null ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
          <span className="text-sm text-muted">No repo selected</span>
          <span className="text-xs text-faint">
            Click a repo or press <Kbd>i</Kbd> to toggle this panel.
          </span>
        </div>
      ) : (
        <RepoBody
          repo={repo}
          isDescribing={isDescribing}
          currentPromptVersion={currentPromptVersion}
          onOpenUrl={onOpenUrl}
        />
      )}
    </aside>
  );
}

function RepoBody({
  repo,
  isDescribing,
  currentPromptVersion,
  onOpenUrl,
}: {
  repo: Repo;
  isDescribing: boolean;
  currentPromptVersion: number;
  onOpenUrl: () => void;
}) {
  const [repoCollections, setRepoCollections] = useState<Collection[]>([]);
  const [similarRepos, setSimilarRepos] = useState<SimilarRepo[]>([]);
  const [contribution, setContribution] = useState<ContributionData | null>(null);

  useEffect(() => {
    invoke<Collection[]>('get_repo_collections', { repoId: repo.id })
      .then(setRepoCollections)
      .catch(() => {});
  }, [repo.id]);

  useEffect(() => {
    invoke<SimilarRepo[]>('get_similar_repos', { repoId: repo.id, limit: 5 })
      .then(setSimilarRepos)
      .catch(() => {});
  }, [repo.id]);

  useEffect(() => {
    invoke<ContributionData>('get_contribution_data', { repoId: repo.id })
      .then(setContribution)
      .catch(() => {});
  }, [repo.id]);

  const topics = parseJsonArray(repo.topics);
  const llmTags = parseJsonArray(repo.llm_tags);
  const isStale =
    repo.llm_summary !== null &&
    repo.prompt_version !== null &&
    repo.prompt_version < currentPromptVersion;
  const isDescribed = !!repo.llm_what;
  const effectiveCategory = repo.user_category ?? repo.llm_category;
  const stars = formatStars(repo.stars_count);
  const describedAt = relativeTime(repo.llm_generated_at);
  const addedAt = relativeTime(repo.added_at);
  const [owner] = repo.full_name.split('/');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-start gap-3">
          {repo.owner_avatar_url ? (
            <img
              src={repo.owner_avatar_url}
              alt={`${owner} avatar`}
              className="w-9 h-9 rounded-full flex-shrink-0 bg-elevated"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-elevated flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <button
              onClick={onOpenUrl}
              className="block text-left text-sm font-semibold text-ink hover:text-accent truncate w-full"
              title={`Open ${repo.url}`}
            >
              {repo.full_name}
            </button>
            <div className="flex items-center gap-2 mt-1 text-xs">
              {effectiveCategory ? (
                <span className="text-accent truncate">
                  {effectiveCategory}
                  {repo.user_category && (
                    <span className="text-muted ml-1">(custom)</span>
                  )}
                  {repo.category_locked && (
                    <span className="text-faint ml-1" title="Category locked">🔒</span>
                  )}
                </span>
              ) : (
                <span className="text-faint">uncategorized</span>
              )}
              {repo.watching && (
                <span className="text-success" title="Following releases">●</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {repo.language && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-accent inline-block" />
              {repo.language}
            </span>
          )}
          {stars && (
            <span className="flex items-center gap-1">
              <span>★</span>
              {stars}
            </span>
          )}
          {addedAt && (
            <span className="text-faint">added {addedAt}</span>
          )}
        </div>
      </div>

      {repo.description && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-1">GitHub</div>
          <p className="text-sm text-dim leading-snug whitespace-pre-wrap">{repo.description}</p>
        </div>
      )}

      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint">AI Summary</div>
          <div className="flex items-center gap-1.5">
            {isStale && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-warn-tint text-warn leading-none">stale</span>
            )}
            {describedAt && !isDescribing && (
              <span className="text-[10px] text-faint">{describedAt}</span>
            )}
          </div>
        </div>

        {isDescribing ? (
          <div className="flex items-center gap-2 text-muted text-sm py-2">
            <span className="animate-pulse">●</span>
            <span>Describing…</span>
          </div>
        ) : isDescribed ? (
          <div className="space-y-3">
            <Field label="What" value={repo.llm_what} />
            <Field label="Why" value={repo.llm_why} />
            <Field label="Use Case" value={repo.llm_use_case} />
            {llmTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {llmTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-surface text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted py-1">
            Press <Kbd>d</Kbd> to describe with AI
          </div>
        )}
      </div>

      {topics.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2">Topics</div>
          <div className="flex flex-wrap gap-1">
            {topics.map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-surface text-dim"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {repo.user_notes && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-1">Notes</div>
          <p className="text-sm text-dim leading-snug whitespace-pre-wrap">{repo.user_notes}</p>
        </div>
      )}

      {repoCollections.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-1.5">Collections</div>
          <div className="flex flex-wrap gap-1">
            {repoCollections.map((c) => (
              <span
                key={c.id}
                className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-surface text-dim flex items-center gap-1"
              >
                {c.icon && <span>{c.icon}</span>}
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {contribution && (
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2">Contribute</div>
          <div className="space-y-1.5">
            {contribution.good_first_issue_count > 0 && (
              <button
                onClick={() => openUrl(`${contribution.github_url}/issues?q=label%3A%22good+first+issue%22+is%3Aopen`)}
                className="block w-full text-left text-xs text-dim hover:text-accent transition-colors"
              >
                {contribution.good_first_issue_count} good first issue{contribution.good_first_issue_count > 1 ? 's' : ''}
              </button>
            )}
            {contribution.open_pr_count > 0 && (
              <button
                onClick={() => openUrl(`${contribution.github_url}/pulls`)}
                className="block w-full text-left text-xs text-dim hover:text-accent transition-colors"
              >
                {contribution.open_pr_count} open PR{contribution.open_pr_count > 1 ? 's' : ''}
              </button>
            )}
            {contribution.has_contributing_md && (
              <button
                onClick={() => openUrl(`${contribution.github_url}/blob/main/CONTRIBUTING.md`)}
                className="block w-full text-left text-xs text-dim hover:text-accent transition-colors"
              >
                View contributing guide
              </button>
            )}
            <button
              onClick={() => openUrl(`${contribution.github_url}/issues`)}
              className="block w-full text-left text-xs text-dim hover:text-accent transition-colors"
            >
              Open issues
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted">
        <span className="flex items-center gap-1"><Kbd>d</Kbd> describe</span>
        <span className="flex items-center gap-1"><Kbd>r</Kbd> readme</span>
        <span className="flex items-center gap-1"><Kbd>w</Kbd> {repo.watching ? 'unfollow' : 'follow'}</span>
        <span className="flex items-center gap-1"><Kbd>m</Kbd> read later</span>
        <span className="flex items-center gap-1"><Kbd>o</Kbd> open</span>
        <span className="flex items-center gap-1"><Kbd>i</Kbd> close</span>
      </div>

      {similarRepos.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2">Similar repos</div>
          <div className="space-y-2">
            {similarRepos.map((sr) => (
              <button
                key={sr.repo.id}
                onClick={() => openUrl(sr.repo.url)}
                className="block w-full text-left text-xs text-dim hover:text-accent truncate transition-colors"
                title={sr.repo.full_name}
              >
                <span className="font-medium">{sr.repo.full_name}</span>
                <span className="text-faint ml-1">· {sr.repo.llm_what}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">{label}</div>
      <div className="text-sm text-ink leading-snug">{value}</div>
    </div>
  );
}
