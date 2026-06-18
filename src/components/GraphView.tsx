import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import { FeedGroup, Repo } from '../types';

interface GraphControls {
  showLabels: boolean;
  labelThreshold: number;
  nodeSizeMultiplier: number;
  linkWidth: number;
  repelStrength: number;
  linkDistance: number;
  velocityDecay: number;
}

const DEFAULT_CONTROLS: GraphControls = {
  showLabels: true,
  labelThreshold: 0.65,
  nodeSizeMultiplier: 1,
  linkWidth: 1,
  repelStrength: -280,
  linkDistance: 120,
  velocityDecay: 0.35,
};

interface GraphNode extends NodeObject {
  id: string;
  nodeType: 'me' | 'person' | 'repo';
  label: string;
  url?: string;
  description?: string;
  starredBy?: string[];
  starCount?: number;
  inLibrary?: boolean;
}

interface GraphLink extends LinkObject {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface Props {
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  theme: 'dark' | 'light';
  // Reports a clicked repo node to App so the right detail sidebar can mirror it.
  // Repo is constructed from FeedGroup data (no LLM fields). fromClick is always
  // true here since hover doesn't carry intent strong enough to flip the sidebar.
  onSelectionChange?: (repo: Repo | null, fromClick: boolean) => void;
}

interface MyGithubInfo {
  login: string;
  avatar_url: string;
}

function getRepoRadius(starCount: number): number {
  return Math.min(24, 5 + Math.sqrt(Math.max(0, starCount - 1)) * 6);
}

function buildGraph(groups: FeedGroup[], myLogin: string): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  nodeMap.set('me', {
    id: 'me',
    nodeType: 'me',
    label: myLogin,
    url: `https://github.com/${myLogin}`,
    fx: 0,
    fy: 0,
  });

  for (const g of groups) {
    const repoId = `repo:${g.repo_full_name}`;
    if (!nodeMap.has(repoId)) {
      nodeMap.set(repoId, {
        id: repoId,
        nodeType: 'repo',
        label: g.repo_full_name,
        url: g.repo_url,
        description: g.repo_description ?? undefined,
        starredBy: g.starred_by,
        starCount: g.starred_by.length,
        inLibrary: g.in_library,
      });
    }

    for (const login of g.starred_by) {
      const personId = `person:${login}`;
      if (!nodeMap.has(personId)) {
        nodeMap.set(personId, {
          id: personId,
          nodeType: 'person',
          label: login,
          url: `https://github.com/${login}`,
        });
        links.push({ source: 'me', target: personId });
      }
      links.push({ source: personId, target: repoId });
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

function graphNodeToRepo(n: GraphNode): Repo | null {
  if (n.nodeType !== 'repo') return null;
  return {
    id: n.label,
    full_name: n.label,
    description: n.description ?? null,
    url: n.url ?? `https://github.com/${n.label}`,
    language: null,
    stars_count: null,
    topics: null,
    added_at: null,
    source: 'feed',
    llm_summary: null,
    llm_what: null,
    llm_why: null,
    llm_use_case: null,
    llm_category: null,
    llm_tags: null,
    llm_generated_at: null,
    prompt_version: null,
    user_notes: null,
    user_category: null,
    watching: false,
    category_locked: false,
    owner_avatar_url: null,
  };
}

export function GraphView({ showToast, theme, onSelectionChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [groupCount, setGroupCount] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [, forceRepaint] = useState(0);
  const [controls, setControls] = useState<GraphControls>(DEFAULT_CONTROLS);
  const [showControls, setShowControls] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({ display: true, forces: true });

  const C = useMemo(() => theme === 'light' ? {
    bg: '#f7f8f8',
    repoGlow: 'rgba(113,112,255,0.15)',
    repoDot: '#7170ff',
    repoGlowInLibrary: 'rgba(13,145,102,0.15)',
    repoDotInLibrary: '#0d9166',
    label: 'rgba(58,59,62,0.85)',
    meRing: '#5e6ad2',
    personRing: 'rgba(94,106,210,0.40)',
    meAvatarBg: '#5e6ad2',
    personAvatarBg: 'rgba(94,106,210,0.12)',
    initials: '#ffffff',
    meLabel: '#0f1011',
    link: 'rgba(60,65,80,0.20)',
  } : {
    bg: '#08090a',
    repoGlow: 'rgba(113,112,255,0.10)',
    repoDot: '#7170ff',
    repoGlowInLibrary: 'rgba(16,185,129,0.12)',
    repoDotInLibrary: '#10b981',
    label: 'rgba(208,214,224,0.85)',
    meRing: '#5e6ad2',
    personRing: 'rgba(94,106,210,0.55)',
    meAvatarBg: '#5e6ad2',
    personAvatarBg: '#2e3060',
    initials: '#f7f8f8',
    meLabel: '#f7f8f8',
    link: 'rgba(200,205,230,0.22)',
  }, [theme]);

  function loadAvatar(login: string, directUrl: string) {
    if (imageCache.current.has(login)) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = directUrl;
    img.onload = () => forceRepaint((n) => n + 1);
    img.onerror = () => console.warn(`[graph] avatar load failed for ${login}: ${directUrl}`);
    imageCache.current.set(login, img);
  }

  useEffect(() => {
    Promise.all([
      invoke<FeedGroup[]>('get_feed_items', { includeLibrary: true }),
      invoke<MyGithubInfo>('get_my_github_login'),
    ])
      .then(async ([groups, me]) => {
        setGroupCount(groups.length);
        const data = buildGraph(groups, me.login);
        setGraphData(data);

        // Load my avatar using the direct URL (no redirect)
        loadAvatar(me.login, me.avatar_url);

        // Collect person logins + repo-owner logins, dedupe, batch-fetch avatars
        const personLogins = data.nodes
          .filter(n => n.nodeType === 'person')
          .map(n => n.label);

        const repoOwnerLogins = data.nodes
          .filter(n => n.nodeType === 'repo')
          .map(n => n.label.split('/')[0]);

        const allLogins = Array.from(new Set([...personLogins, ...repoOwnerLogins]));

        if (allLogins.length > 0) {
          const avatarMap = await invoke<Record<string, string>>('get_avatar_urls', {
            logins: allLogins,
          });
          for (const login of allLogins) {
            const url = avatarMap[login];
            if (url) loadAvatar(login, url);
          }
        }
      })
      .catch((e) => showToast(`Failed to load graph: ${e}`, 'error'))
      .finally(() => setLoading(false));
  }, []);

  // Configure d3 forces + zoomToFit.
  // Depends on BOTH graphData and dimensions so it fires when either becomes
  // available — whichever is last to arrive (canvas mount vs data load).
  useEffect(() => {
    if (graphData.nodes.length === 0 || !dimensions) return;
    const fg = fgRef.current;
    if (fg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fg.d3Force('charge') as any)?.strength(controls.repelStrength);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fg.d3Force('link') as any)?.distance(controls.linkDistance);
    }
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(600, 80);
    }, 2500);
    return () => clearTimeout(timer);
  }, [graphData, dimensions]);

  // Re-apply forces when controls change (after initial load)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fg.d3Force('charge') as any)?.strength(controls.repelStrength);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fg.d3Force('link') as any)?.distance(controls.linkDistance);
    fg.d3ReheatSimulation();
  }, [controls.repelStrength, controls.linkDistance]);

  const handleEngineStop = useCallback(() => {}, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Read the real size immediately before first paint
    const { width, height } = el.getBoundingClientRect();
    if (width > 0 && height > 0) setDimensions({ width, height });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleNodeClick = useCallback((node: NodeObject) => {
    const n = node as GraphNode;
    const repo = graphNodeToRepo(n);
    if (repo) onSelectionChange?.(repo, true);
    if (n.url) openUrl(n.url);
  }, [onSelectionChange]);

  const handleNodeHover = useCallback((node: NodeObject | null) => {
    setHoveredNode(node ? (node as GraphNode) : null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const paintNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const m = controls.nodeSizeMultiplier;

      if (n.nodeType === 'repo') {
        const radius = getRepoRadius(n.starCount ?? 1) * m;
        const ringColor = n.inLibrary ? C.repoDotInLibrary : C.repoDot;
        const glowColor = n.inLibrary ? C.repoGlowInLibrary : C.repoGlow;

        ctx.beginPath();
        ctx.arc(x, y, radius + 4 * m, 0, 2 * Math.PI);
        ctx.fillStyle = glowColor;
        ctx.fill();

        const ownerLogin = n.label.split('/')[0];
        const img = imageCache.current.get(ownerLogin);
        const showAvatar = globalScale > controls.labelThreshold && img && img.complete && img.naturalWidth > 0;

        if (showAvatar) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = ringColor;
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.clip();
          ctx.drawImage(img!, x - radius, y - radius, radius * 2, radius * 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = ringColor;
          ctx.fill();
        }

        if (controls.showLabels && globalScale > controls.labelThreshold) {
          const short = n.label.split('/')[1] ?? n.label;
          const fontSize = Math.max(6, 9 / globalScale);
          ctx.font = `${fontSize}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = C.label;
          ctx.fillText(short, x, y + radius + 2);
        }
        return;
      }

      const radius = (n.nodeType === 'me' ? 20 : 13) * m;
      const login = n.label;
      const img = imageCache.current.get(login);

      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = n.nodeType === 'me' ? C.meRing : C.personRing;
      ctx.fill();

      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = n.nodeType === 'me' ? C.meAvatarBg : C.personAvatarBg;
        ctx.fill();
        const initial = login.charAt(0).toUpperCase();
        const fontSize = Math.max(8, radius * 0.9);
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.initials;
        ctx.fillText(initial, x, y);
      }

      if (controls.showLabels) {
        const labelSize = n.nodeType === 'me'
          ? Math.max(8, 12 / globalScale)
          : Math.max(6, 9 / globalScale);
        ctx.font = `${n.nodeType === 'me' ? '600' : '400'} ${labelSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = n.nodeType === 'me' ? C.meLabel : C.label;
        ctx.fillText(login, x, y + radius + 3);
      }
    },
    [C, controls]
  );

  const getNodePointerAreaPaint = useCallback(
    (node: NodeObject, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as GraphNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const radius = n.nodeType === 'me' ? 22 : n.nodeType === 'person' ? 15 : getRepoRadius(n.starCount ?? 1) + 4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const personCount = graphData.nodes.filter(n => n.nodeType === 'person').length;
  const repoCount = graphData.nodes.filter(n => n.nodeType === 'repo').length;

  // containerRef must always be on the outermost div so useLayoutEffect can
  // measure it on first mount regardless of loading/empty state.
  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full h-full overflow-hidden bg-bg"
      onMouseMove={handleMouseMove}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-sm text-muted">
          Loading graph…
        </div>
      ) : groupCount === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <p className="text-sm">No network stars yet.</p>
          <p className="text-xs text-faint">Go to the Feed view and fetch your network first.</p>
        </div>
      ) : (
        <>
          <div className="absolute top-3 left-3 z-10 flex items-center gap-4 px-3 py-2 rounded-lg bg-panel border border-border text-xs text-muted select-none">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand" />
              {personCount} people
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" />
              {repoCount} repos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-success" />
              in library
            </span>
            <span className="text-faint">scroll to zoom · drag to pan</span>
          </div>

          {dimensions && (
            <ForceGraph2D<GraphNode, GraphLink>
              ref={fgRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor={C.bg}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={getNodePointerAreaPaint}
              linkColor={() => C.link}
              linkWidth={controls.linkWidth}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onEngineStop={handleEngineStop}
              nodeLabel={() => ''}
              cooldownTime={6000}
              d3AlphaDecay={0.015}
              d3VelocityDecay={controls.velocityDecay}
            />
          )}

          {/* Controls toggle button */}
          <button
            onClick={() => setShowControls(v => !v)}
            className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
              showControls
                ? 'bg-surface border-border text-ink'
                : 'bg-panel border-border text-muted hover:text-dim'
            }`}
            title="Graph controls"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
            </svg>
            Controls
          </button>

          {/* Controls panel */}
          {showControls && (
            <div className="absolute top-11 right-3 z-10 w-56 rounded-lg bg-panel border border-border shadow-elevated overflow-hidden text-xs select-none">
              {/* Display section */}
              <button
                className="w-full flex items-center gap-1.5 px-3 py-2 text-muted hover:text-dim font-medium border-b border-border"
                onClick={() => setSectionsOpen(s => ({ ...s, display: !s.display }))}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${sectionsOpen.display ? 'rotate-90' : ''}`}>
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Display
              </button>
              {sectionsOpen.display && (
                <div className="px-3 py-2 space-y-3 border-b border-border">
                  {/* Show labels toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Labels</span>
                    <button
                      onClick={() => setControls(c => ({ ...c, showLabels: !c.showLabels }))}
                      className={`relative w-8 h-4 rounded-full transition-colors ${controls.showLabels ? 'bg-brand' : 'bg-elevated'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${controls.showLabels ? 'left-4.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {/* Text fade threshold */}
                  {controls.showLabels && (
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-muted">Text fade threshold</span>
                        <span className="text-faint tabular-nums">{controls.labelThreshold.toFixed(2)}</span>
                      </div>
                      <input type="range" min="0.2" max="2.0" step="0.05"
                        value={controls.labelThreshold}
                        onChange={e => setControls(c => ({ ...c, labelThreshold: parseFloat(e.target.value) }))}
                        className="w-full accent-brand h-1 cursor-pointer"
                      />
                    </div>
                  )}
                  {/* Node size */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">Node size</span>
                      <span className="text-faint tabular-nums">{controls.nodeSizeMultiplier.toFixed(1)}x</span>
                    </div>
                    <input type="range" min="0.5" max="2.5" step="0.1"
                      value={controls.nodeSizeMultiplier}
                      onChange={e => setControls(c => ({ ...c, nodeSizeMultiplier: parseFloat(e.target.value) }))}
                      className="w-full accent-brand h-1 cursor-pointer"
                    />
                  </div>
                  {/* Link thickness */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">Link thickness</span>
                      <span className="text-faint tabular-nums">{controls.linkWidth.toFixed(1)}</span>
                    </div>
                    <input type="range" min="0.5" max="4" step="0.5"
                      value={controls.linkWidth}
                      onChange={e => setControls(c => ({ ...c, linkWidth: parseFloat(e.target.value) }))}
                      className="w-full accent-brand h-1 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Forces section */}
              <button
                className="w-full flex items-center gap-1.5 px-3 py-2 text-muted hover:text-dim font-medium border-b border-border"
                onClick={() => setSectionsOpen(s => ({ ...s, forces: !s.forces }))}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${sectionsOpen.forces ? 'rotate-90' : ''}`}>
                  <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Forces
              </button>
              {sectionsOpen.forces && (
                <div className="px-3 py-2 space-y-3">
                  {/* Repel force */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">Repel force</span>
                      <span className="text-faint tabular-nums">{controls.repelStrength}</span>
                    </div>
                    <input type="range" min="-600" max="-30" step="10"
                      value={controls.repelStrength}
                      onChange={e => setControls(c => ({ ...c, repelStrength: parseInt(e.target.value) }))}
                      className="w-full accent-brand h-1 cursor-pointer"
                    />
                  </div>
                  {/* Link distance */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">Link distance</span>
                      <span className="text-faint tabular-nums">{controls.linkDistance}</span>
                    </div>
                    <input type="range" min="30" max="300" step="10"
                      value={controls.linkDistance}
                      onChange={e => setControls(c => ({ ...c, linkDistance: parseInt(e.target.value) }))}
                      className="w-full accent-brand h-1 cursor-pointer"
                    />
                  </div>
                  {/* Friction (velocity decay) */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">Friction</span>
                      <span className="text-faint tabular-nums">{controls.velocityDecay.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.05" max="0.9" step="0.05"
                      value={controls.velocityDecay}
                      onChange={e => setControls(c => ({ ...c, velocityDecay: parseFloat(e.target.value) }))}
                      className="w-full accent-brand h-1 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Reset */}
              <div className="px-3 py-2 border-t border-border">
                <button
                  onClick={() => setControls(DEFAULT_CONTROLS)}
                  className="text-faint hover:text-muted transition-colors"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          )}

          {hoveredNode && (
            <div
              className="pointer-events-none fixed z-20 px-3 py-2 rounded-lg bg-panel border border-border shadow-xl text-xs max-w-64"
              style={{ left: tooltipPos.x + 14, top: tooltipPos.y + 14 }}
            >
              <p className="font-medium text-ink">{hoveredNode.label}</p>
              {hoveredNode.nodeType === 'repo' && hoveredNode.description && (
                <p className="mt-0.5 text-muted leading-snug">{hoveredNode.description}</p>
              )}
              {hoveredNode.nodeType === 'repo' && hoveredNode.starredBy && hoveredNode.starredBy.length > 0 && (
                <p className="mt-1 text-faint">starred by {hoveredNode.starredBy.join(', ')}</p>
              )}
              {hoveredNode.nodeType === 'repo' && hoveredNode.inLibrary && (
                <p className="mt-1 text-success">✓ in your library</p>
              )}
              <p className="mt-1 text-faint">click to open ↗</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
