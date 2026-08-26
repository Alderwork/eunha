import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContributionBrief, ContributionTask, Project, ProjectContribution, ProjectDraft } from './types';
import { SettingsWorkspace } from './components/workroom/SettingsWorkspace';
import { TasksScreen } from './components/workroom/TaskWorkspace';

type Screen = 'projects' | 'tasks' | 'settings';

const NAV: { id: Screen; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'settings', label: 'Settings' },
];

function shortSha(value: string | null | undefined) {
  return value?.slice(0, 8) ?? '—';
}

function AddProjectPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (project: Project) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      setDraft(await invoke<ProjectDraft>('inspect_project_input', { input: input.trim() }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await invoke<Project>('save_project', { draft, roleMode: 'contributor' }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialogRef} className="workroom-dialog" aria-labelledby="add-project-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="workroom-add-panel">
      <header><div><span className="workroom-index">ADD PROJECT</span><h2 id="add-project-title">Bring in a repository.</h2></div><button className="workroom-icon-button" onClick={onClose} aria-label="Close add project panel">×</button></header>
      <form onSubmit={inspect}>
        <label htmlFor="project-input">GitHub repository or local path</label>
        <div className="workroom-command-input"><span aria-hidden="true">›</span><input id="project-input" autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder="owner/repo  ·  https://github.com/…  ·  /local/path" /><button disabled={busy || !input.trim()}>{busy ? 'Inspecting' : 'Inspect'}</button></div>
      </form>
      {error && <p className="workroom-error" role="alert">{error}</p>}
      {!draft && !error && <div className="workroom-intake-guide"><p>eunha verifies repository facts before saving.</p><ul><li>GitHub identity and public metadata</li><li>Local Git root, remote, branch, and working tree</li><li>No clone, branch, commit, or push runs at this step</li></ul></div>}
      {draft && <div className="workroom-draft">
        <div className="workroom-draft-head"><span className="workroom-repo-glyph">{draft.display_name.slice(0, 2).toUpperCase()}</span><div><h3>{draft.github_full_name ?? draft.display_name}</h3><p>{draft.description ?? 'Local Git repository'}</p></div><span className={draft.local_path ? 'workroom-state connected' : 'workroom-state'}>{draft.local_path ? 'LOCAL CONNECTED' : 'REMOTE ONLY'}</span></div>
        <dl>
          <div><dt>Workspace</dt><dd>{draft.local_path ?? 'Not connected'}</dd></div>
          <div><dt>Default branch</dt><dd>{draft.default_branch ?? 'Unknown'}</dd></div>
          {!draft.local_path && <div><dt>Clone candidate</dt><dd>{draft.clone_suggestion}</dd></div>}
        </dl>
        {draft.warnings.map((warning) => <p className="workroom-warning" key={warning}>{warning}</p>)}
        <footer><button className="workroom-secondary" onClick={() => setDraft(null)}>Change input</button><button className="workroom-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Add project'}</button></footer>
      </div>}
    </section>
  </dialog>;
}

function ProjectList({ projects, selectedId, onSelect, onAdd }: { projects: Project[]; selectedId: string | null; onSelect: (id: string) => void; onAdd: () => void }) {
  return <aside className="workroom-project-list">
    <header><div><span className="workroom-index">REPOSITORY INDEX</span><h1>Projects</h1></div><button className="workroom-add-button" onClick={onAdd}><span>+</span> Add</button></header>
    {projects.length === 0 ? <div className="workroom-empty-list"><h2>No projects yet.</h2><p>Add a public GitHub repository or connect an existing local clone.</p><button onClick={onAdd}>Add project</button></div> : <div className="workroom-project-rows">{projects.map((project) => {
      const status = project.workspace?.git_status;
      return <button key={project.id} className={selectedId === project.id ? 'active' : ''} aria-current={selectedId === project.id ? 'true' : undefined} onClick={() => onSelect(project.id)}>
        <span className="workroom-row-main"><strong>{project.github_full_name ?? project.display_name}</strong><span>{project.workspace ? project.workspace.current_branch ?? 'detached HEAD' : 'workspace not connected'}</span></span><i className={status?.clean ? 'clean' : project.workspace ? 'changed' : ''}>{status?.clean ? 'CLEAN' : project.workspace ? `${status?.changed_files.length ?? 0} CHANGED` : 'REMOTE'}</i>
      </button>;
    })}</div>}
  </aside>;
}

function BriefList({ title, items, tone }: { title: string; items: string[]; tone?: 'warning' | 'unknown' }) {
  if (items.length === 0) return null;
  return <section className={`workroom-brief-list ${tone ?? ''}`}><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function ContributionDocument({ brief }: { brief: ContributionBrief }) {
  return <article className="workroom-brief-document">
    <header><span className="workroom-index">CONTRIBUTION BRIEF</span><p>{brief.project_definition}</p></header>
    <section className="workroom-brief-entry"><h4>Start here</h4><ol>{brief.contributor_entry_points.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ol></section>
    <details className="workroom-brief-details">
      <summary><span>Repository guidance and evidence</span><small>{brief.evidence.length} verified excerpt{brief.evidence.length === 1 ? '' : 's'}</small></summary>
      <div className="workroom-brief-columns">
        <BriefList title="Setup requirements" items={brief.setup_requirements} />
        <BriefList title="Contribution rules" items={brief.contribution_rules} />
        <BriefList title="Maturity signals" items={brief.maturity_signals} />
        <BriefList title="Cautions" items={brief.cautions} tone="warning" />
        <BriefList title="Unknowns" items={brief.unknowns} tone="unknown" />
      </div>
      {brief.verification_commands.length > 0 && <section className="workroom-command-ledger"><h4>Verification commands</h4><div>{brief.verification_commands.map((command) => <code key={command}><span>$</span>{command}</code>)}</div><small>Repository evidence only. Commands require a separate approval before execution.</small></section>}
      <section className="workroom-evidence-ledger"><div><h4>Evidence</h4><span>{brief.evidence.length} excerpts</span></div>{brief.evidence.length === 0 ? <p>No verifiable excerpt was available.</p> : brief.evidence.map((item, index) => <blockquote key={`${item.source}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><p>“{item.excerpt}”</p><cite>{item.source}</cite></div></blockquote>)}</section>
    </details>
  </article>;
}

function ContributionWorkspace({ project, onTaskCreated }: { project: Project; onTaskCreated: (task: ContributionTask) => void }) {
  const [data, setData] = useState<ProjectContribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<'entry' | 'issues' | 'prs'>('entry');
  const [creatingIssueId, setCreatingIssueId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setData(null);
    void invoke<ProjectContribution | null>('get_project_contribution', { projectId: project.id })
      .then((next) => { if (active) setData(next); })
      .catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  async function analyze() {
    setAnalyzing(true); setError(null);
    try { setData(await invoke<ProjectContribution>('analyze_project_contribution', { projectId: project.id })); }
    catch (reason) { setError(String(reason)); }
    finally { setAnalyzing(false); }
  }

  async function createTask(issue: ProjectContribution['issues'][number]) {
    setCreatingIssueId(issue.github_issue_id); setError(null);
    try { onTaskCreated(await invoke<ContributionTask>('create_contribution_task', { projectId: project.id, issueId: issue.github_issue_id, title: issue.title, notes: null })); }
    catch (reason) { setError(String(reason)); }
    finally { setCreatingIssueId(null); }
  }

  if (loading) return <section className="workroom-contribution-loading"><span /><p>Reading saved repository evidence…</p></section>;
  if (!data) return <section className="workroom-contribution-empty">
    <div><span className="workroom-index">CONTRIBUTION BRIEF</span><h3>Map the repository before starting work.</h3><p>Read the project guides, templates, manifests, and latest public issues. AI analysis runs only when you ask for it.</p></div>
    {error && <p className="workroom-error" role="alert">{error}</p>}
    <button className="workroom-primary" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? 'Collecting evidence…' : 'Build contribution brief'}</button>
  </section>;

  const snapshot = data.snapshot;
  const brief = snapshot.contribution_brief;
  const issues = data.issues.filter((issue) => {
    if (issueFilter === 'prs') return issue.is_pull_request;
    if (issueFilter === 'issues') return !issue.is_pull_request;
    return !issue.is_pull_request && issue.labels.some((label) => ['good first issue', 'help wanted'].includes(label.toLowerCase()));
  });
  const partial = snapshot.collection_errors.length > 0;
  const sources = [
    { label: 'README', ready: snapshot.readme != null },
    { label: 'CONTRIBUTING', ready: snapshot.contributing != null },
    { label: 'CODE OF CONDUCT', ready: snapshot.code_of_conduct != null },
    { label: 'TEMPLATES', ready: snapshot.templates.length > 0, count: snapshot.templates.length },
    { label: 'TOOLING', ready: snapshot.detected_tools.length > 0, count: snapshot.detected_tools.length },
  ];

  return <section className="workroom-contribution-workspace">
    <header className="workroom-contribution-head"><div><span className="workroom-index">CONTRIBUTION BRIEF</span><h3>Repository context</h3><p>Snapshot {shortSha(snapshot.commit_sha)} · {new Date(snapshot.captured_at).toLocaleString()}</p></div><button onClick={() => void analyze()} disabled={analyzing}>{analyzing ? 'Collecting…' : 'Refresh evidence'}</button></header>
    {error && <div className="workroom-inline-error" role="alert">{error}</div>}
    {snapshot.collection_errors.length > 0 && <details className="workroom-partial"><summary><span>PARTIAL RESULT</span>{snapshot.collection_errors.length} collection warning(s)</summary><ul>{snapshot.collection_errors.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <div className="workroom-source-strip">{sources.map((source) => <div key={source.label} className={source.ready ? 'ready' : partial ? 'unknown' : ''}><i /> <span>{source.label}</span><b>{source.ready ? source.count ?? 'FOUND' : partial ? 'UNKNOWN' : 'MISSING'}</b></div>)}</div>
    {brief ? <ContributionDocument brief={brief} /> : <div className="workroom-inline-error" role="alert">The snapshot has no valid Contribution Brief.</div>}
    <section className="workroom-issues">
      <header><div><span className="workroom-index">PUBLIC ACTIVITY</span><h3>Choose an entry point</h3></div><div className="workroom-issue-filters">{([['entry', 'Recommended'], ['issues', 'All issues'], ['prs', 'Open PRs']] as const).map(([value, label]) => <button key={value} className={issueFilter === value ? 'active' : ''} aria-pressed={issueFilter === value} onClick={() => setIssueFilter(value)}>{label}</button>)}</div></header>
      {issues.length === 0 ? <div className="workroom-issues-empty">No matching item was found in the latest cached GitHub sample.</div> : <div className="workroom-issue-list">{issues.map((issue) => <div className="workroom-issue-row" key={issue.github_issue_id}><span className="workroom-issue-number">{issue.is_pull_request ? 'PR' : 'ISSUE'} #{issue.number}</span><div><strong>{issue.title}</strong><span>{issue.labels.map((label) => <i key={label}>{label}</i>)}</span></div><small>{issue.comments_count} comments<br />{issue.author_login ? `@${issue.author_login}` : ''}</small><div className="workroom-issue-actions">{!issue.is_pull_request && <button onClick={() => void createTask(issue)} disabled={creatingIssueId === issue.github_issue_id}>{creatingIssueId === issue.github_issue_id ? 'Adding…' : 'Start task'}</button>}<button onClick={() => void openUrl(issue.html_url)} aria-label={`Open ${issue.is_pull_request ? 'pull request' : 'issue'} ${issue.number} on GitHub`}>↗</button></div></div>)}</div>}
    </section>
  </section>;
}

function ProjectOverview({ project, onProjectChange, onTaskCreated }: { project: Project; onProjectChange: (project: Project) => void; onTaskCreated: (task: ContributionTask) => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = project.workspace;
  const status = workspace?.git_status;
  const githubUrl = project.github_full_name ? `https://github.com/${project.github_full_name}` : null;

  async function refresh() {
    setRefreshing(true); setError(null);
    try { onProjectChange(await invoke<Project>('refresh_project_workspace', { projectId: project.id })); }
    catch (reason) { setError(String(reason)); }
    finally { setRefreshing(false); }
  }

  return <main className="workroom-overview">
    <header className="workroom-project-hero">
      <div className="workroom-hero-copy"><span className="workroom-index">PROJECT</span><h2>{project.display_name}</h2><p>{project.description ?? 'A local open-source workspace.'}</p></div>
      <div className="workroom-project-links">{project.github_full_name && <span>{project.github_full_name}</span>}{githubUrl && <button onClick={() => void openUrl(githubUrl)}>Open GitHub ↗</button>}</div>
    </header>
    {error && <div className="workroom-inline-error" role="alert">{error}</div>}
    <section className="workroom-workspace-section">
      <div className="workroom-section-title"><div><span className="workroom-index">LOCAL WORKSPACE</span><h3>{workspace ? 'Repository connected' : 'Connect a local clone'}</h3></div>{workspace && <button onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Scanning…' : 'Refresh status'}</button>}</div>
      {workspace ? <div className="workroom-status-board">
        <div className="workroom-status-primary"><span className={status?.clean ? 'workroom-signal clean' : 'workroom-signal changed'} /><div><small>CURRENT BRANCH</small><strong>{workspace.current_branch ?? 'Detached HEAD'}</strong><code>{shortSha(workspace.head_sha)}</code></div></div>
        <dl><div><dt>Working tree</dt><dd>{status?.clean ? 'Clean' : `${status?.changed_files.length ?? 0} changed`}</dd></div><div><dt>Staged</dt><dd>{status?.staged ?? 0}</dd></div><div><dt>Unstaged</dt><dd>{status?.unstaged ?? 0}</dd></div><div><dt>Untracked</dt><dd>{status?.untracked ?? 0}</dd></div></dl>
        <div className="workroom-path"><span>ROOT</span><code>{workspace.local_path}</code></div>
        {!status?.clean && <div className="workroom-change-list">{status?.changed_files.slice(0, 6).map((file) => <code key={file}>{file}</code>)}{(status?.changed_files.length ?? 0) > 6 && <span>+{(status?.changed_files.length ?? 0) - 6} more</span>}</div>}
      </div> : <div className="workroom-connect-callout"><div><strong>No local workspace connected.</strong><p>Connect an existing clone from a Task workspace. Filesystem access stays inside the selected repository root.</p></div><span>READ-ONLY</span></div>}
    </section>
    <ContributionWorkspace project={project} onTaskCreated={onTaskCreated} />
  </main>;
}

export default function EunhaApp() {
  const [screen, setScreen] = useState<Screen>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openedTaskId, setOpenedTaskId] = useState<string | null>(null);
  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? null, [projects, selectedId]);

  useEffect(() => {
    void invoke<Project[]>('list_projects')
      .then((items) => { setProjects(items); setSelectedId(items[0]?.id ?? null); })
      .catch((reason) => setLoadError(String(reason)))
      .finally(() => setLoading(false));
  }, []);

  function updateProject(next: Project) {
    setProjects((items) => items.map((project) => project.id === next.id ? next : project));
  }

  function openTask(task: ContributionTask) {
    setOpenedTaskId(task.id);
    setScreen('tasks');
  }

  return <div className="workroom-shell">
    <header className="workroom-topbar" data-tauri-drag-region>
      <button className="workroom-brand" onClick={() => setScreen('projects')} aria-label="Open eunha projects"><strong>eunha</strong><span>/ open-source workroom</span></button>
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={screen === item.id ? 'active' : ''} aria-current={screen === item.id ? 'page' : undefined} onClick={() => setScreen(item.id)}>{item.label}</button>)}</nav>
      <p>From repository context to PR-ready work.</p>
      <span className="workroom-local-status"><i />LOCAL</span>
    </header>
    <div className="workroom-workbench">
      {screen === 'projects' ? <>{loading ? <div className="workroom-loading">Reading local workspace…</div> : <ProjectList projects={projects} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => setAddOpen(true)} />}{selected ? <ProjectOverview project={selected} onProjectChange={updateProject} onTaskCreated={openTask} /> : !loading && <main className="workroom-no-selection"><span>OPEN-SOURCE WORKROOM</span><h1>Begin with a repository.</h1><p>Add the project you intend to understand, contribute to, or maintain.</p>{loadError && <div className="workroom-inline-error" role="alert">{loadError}</div>}<button onClick={() => setAddOpen(true)}>Add project</button></main>}</> : screen === 'tasks' ? <TasksScreen projects={projects} initialTaskId={openedTaskId} onProjectChange={updateProject} /> : <SettingsWorkspace />}
    </div>
    {addOpen && <AddProjectPanel onClose={() => setAddOpen(false)} onSaved={(project) => { setProjects((items) => [project, ...items]); setSelectedId(project.id); setAddOpen(false); setScreen('projects'); }} />}
  </div>;
}
