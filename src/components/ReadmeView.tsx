import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align'],
  },
};

export interface ReadmeTab {
  repoId: string;
  repoFullName: string;
  repoUrl: string;
}

interface Props {
  tabs: ReadmeTab[];
  activeTabId: string | null;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'success'; content: string }
  | { status: 'error'; message: string };

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?.*)?$/i;

function rewriteUrl(repoId: string, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) {
    return url;
  }
  const path = url.replace(/^\.?\//, '');
  if (IMAGE_EXT_RE.test(path)) {
    return `https://raw.githubusercontent.com/${repoId}/HEAD/${path}`;
  }
  return `https://github.com/${repoId}/blob/HEAD/${path}`;
}

const PROSE_CLASSES = [
  'text-sm text-dim leading-relaxed',
  '[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-ink [&_h1]:mt-4 [&_h1]:mb-2',
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:mt-4 [&_h2]:mb-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ink [&_h3]:mt-3 [&_h3]:mb-1',
  '[&_p]:mb-3',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3',
  '[&_li]:mb-1',
  '[&_code]:bg-surface [&_code]:text-accent [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:bg-surface [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-3',
  '[&_a]:text-accent [&_a]:underline',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_blockquote]:mb-3',
  '[&_hr]:border-border [&_hr]:mb-3',
  '[&_img]:max-w-full [&_img]:rounded',
  '[&_table]:w-full [&_table]:mb-3',
  '[&_th]:text-left [&_th]:font-semibold [&_th]:text-ink [&_th]:border-b [&_th]:border-border [&_th]:pb-1',
  '[&_td]:py-1 [&_td]:border-b [&_td]:border-border',
].join(' ');

export function ReadmeView({ tabs, activeTabId, scrollContainerRef }: Props) {
  const [cache, setCache] = useState<Map<string, FetchState>>(new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const activeTab = tabs.find((t) => t.repoId === activeTabId) ?? null;
  const activeId = activeTab?.repoId ?? null;

  useEffect(() => {
    if (!activeId) return;
    if (cacheRef.current.has(activeId)) return;

    setCache((m) => {
      if (m.has(activeId)) return m;
      const next = new Map(m);
      next.set(activeId, { status: 'loading' });
      return next;
    });

    let cancelled = false;
    invoke<string>('fetch_readme', { repoId: activeId })
      .then((content) => {
        if (cancelled) return;
        setCache((m) => {
          const next = new Map(m);
          next.set(activeId, { status: 'success', content });
          return next;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message :
          typeof err === 'string' ? err :
          'Failed to load README.';
        setCache((m) => {
          const next = new Map(m);
          next.set(activeId, { status: 'error', message });
          return next;
        });
      });

    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    setCache((m) => {
      const openIds = new Set(tabs.map((t) => t.repoId));
      let changed = false;
      const next = new Map(m);
      for (const id of next.keys()) {
        if (!openIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [tabs]);

  const state = activeId ? cache.get(activeId) ?? { status: 'loading' as const } : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-bg">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-5">
        {!activeTab && (
          <p className="text-sm text-muted text-center py-12">
            No README open. Press <span className="font-mono text-accent">r</span> in the library to open one.
          </p>
        )}
        {activeTab && state?.status === 'loading' && (
          <p className="text-sm text-muted text-center py-12">Loading README…</p>
        )}
        {activeTab && state?.status === 'error' && (
          <p className="text-sm text-danger text-center py-12">{state.message}</p>
        )}
        {activeTab && state?.status === 'success' && (
          <div className={`max-w-3xl mx-auto ${PROSE_CLASSES}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              urlTransform={(url) => rewriteUrl(activeTab.repoId, url)}
            >
              {state.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
