import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContributionBrief, ContributionTask, Project, ProjectContribution, ProjectDraft } from './types';
import { TasksScreen } from './components/pivot/TaskWorkspace';

type Screen = 'projects' | 'tasks' | 'maintain' | 'settings';
type Role = Project['role_mode'];

const NAV: { id: Screen; label: string; mark: string }[] = [
  { id: 'projects', label: 'Projects', mark: 'P' },
  { id: 'tasks', label: 'Tasks', mark: 'T' },
  { id: 'maintain', label: 'Maintain', mark: 'M' },
  { id: 'settings', label: 'Settings', mark: 'S' },
];

const ROLE_COPY: Record<Role, string> = {
  contributor: 'Find an entry point and finish a contribution.',
  maintainer: 'Make the project easier for contributors to enter.',
  owner: 'Read maintenance signals and choose what matters next.',
};

function shortSha(value: string | null | undefined) {
  return value?.slice(0, 8) ?? '—';
}

function AddProjectPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (project: Project) => void }) {
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [role, setRole] = useState<Role>('contributor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onSaved(await invoke<Project>('save_project', { draft, roleMode: role }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="pivot-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pivot-add-panel" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
      <header><div><span className="pivot-index">NEW / PROJECT</span><h2 id="add-project-title">Connect the work.</h2></div><button className="pivot-icon-button" onClick={onClose} aria-label="Close">×</button></header>
      <form onSubmit={inspect}>
        <label htmlFor="project-input">GitHub repository or local path</label>
        <div className="pivot-command-input"><span aria-hidden="true">›</span><input id="project-input" autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder="owner/repo  ·  https://github.com/…  ·  /local/path" /><button disabled={busy || !input.trim()}>{busy ? 'Inspecting' : 'Inspect'}</button></div>
      </form>
      {error && <p className="pivot-error">{error}</p>}
      {!draft && !error && <div className="pivot-intake-guide"><p>eunha reads repository facts before anything is saved.</p><ul><li>GitHub identity and public metadata</li><li>Local Git root, remote, branch, and status</li><li>No clone, branch, commit, or push runs here</li></ul></div>}
      {draft && <div className="pivot-draft">
        <div className="pivot-draft-head"><span className="pivot-repo-glyph">{draft.display_name.slice(0, 2).toUpperCase()}</span><div><h3>{draft.github_full_name ?? draft.display_name}</h3><p>{draft.description ?? 'Local Git repository'}</p></div><span className={draft.local_path ? 'pivot-state connected' : 'pivot-state'}>{draft.local_path ? 'LOCAL CONNECTED' : 'REMOTE ONLY'}</span></div>
        <dl>
          <div><dt>Workspace</dt><dd>{draft.local_path ?? 'Not connected'}</dd></div>
          <div><dt>Default branch</dt><dd>{draft.default_branch ?? 'Unknown'}</dd></div>
          {!draft.local_path && <div><dt>Clone candidate</dt><dd>{draft.clone_suggestion}</dd></div>}
        </dl>
        {draft.warnings.map((warning) => <p className="pivot-warning" key={warning}>{warning}</p>)}
        <fieldset><legend>Start in this perspective</legend><div className="pivot-role-options">{(['contributor', 'maintainer', 'owner'] as Role[]).map((item) => <button type="button" key={item} className={role === item ? 'active' : ''} onClick={() => setRole(item)}><strong>{item}</strong><span>{ROLE_COPY[item]}</span></button>)}</div></fieldset>
        <footer><button className="pivot-secondary" onClick={() => setDraft(null)}>Change input</button><button className="pivot-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Add project'}</button></footer>
      </div>}
    </section>
  </div>;
}

function ProjectList({ projects, selectedId, onSelect, onAdd }: { projects: Project[]; selectedId: string | null; onSelect: (id: string) => void; onAdd: () => void }) {
  return <aside className="pivot-project-list">
    <header><div><span className="pivot-index">LOCAL WORKBENCH</span><h1>Projects</h1></div><button className="pivot-add-button" onClick={onAdd}><span>+</span> Add</button></header>
    {projects.length === 0 ? <div className="pivot-empty-list"><span>00</span><h2>No active projects.</h2><p>Add a public GitHub repository or connect an existing local clone.</p><button onClick={onAdd}>Add the first project</button></div> : <div className="pivot-project-rows">{projects.map((project, index) => {
      const status = project.workspace?.git_status;
      return <button key={project.id} className={selectedId === project.id ? 'active' : ''} onClick={() => onSelect(project.id)}>
        <span className="pivot-row-number">{String(index + 1).padStart(2, '0')}</span><span className="pivot-row-main"><strong>{project.github_full_name ?? project.display_name}</strong><small>{project.description ?? 'Local repository'}</small><span>{project.workspace ? project.workspace.current_branch ?? 'detached HEAD' : 'workspace not connected'}</span></span><i className={status?.clean ? 'clean' : project.workspace ? 'changed' : ''}>{status?.clean ? 'CLEAN' : project.workspace ? `${status?.changed_files.length ?? 0} Δ` : 'REMOTE'}</i>
      </button>;
    })}</div>}
  </aside>;
}

function BriefList({ title, items, tone }: { title: string; items: string[]; tone?: 'warning' | 'unknown' }) {
  if (items.length === 0) return null;
  return <section className={`pivot-brief-list ${tone ?? ''}`}><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function ContributionDocument({ brief }: { brief: ContributionBrief }) {
  return <article className="pivot-brief-document">
    <header><span className="pivot-index">VERIFIED BRIEF</span><p>{brief.project_definition}</p></header>
    <div className="pivot-brief-columns">
      <BriefList title="Contributor entry points" items={brief.contributor_entry_points} />
      <BriefList title="Setup requirements" items={brief.setup_requirements} />
      <BriefList title="Contribution rules" items={brief.contribution_rules} />
      <BriefList title="Maturity signals" items={brief.maturity_signals} />
      <BriefList title="Cautions" items={brief.cautions} tone="warning" />
      <BriefList title="Unknowns" items={brief.unknowns} tone="unknown" />
    </div>
    {brief.verification_commands.length > 0 && <section className="pivot-command-ledger"><h4>Detected verification commands</h4><div>{brief.verification_commands.map((command) => <code key={command}><span>$</span>{command}</code>)}</div><small>Detected only. Nothing runs without a separate confirmation.</small></section>}
    <section className="pivot-evidence-ledger"><div><h4>Evidence ledger</h4><span>{brief.evidence.length} verified excerpts</span></div>{brief.evidence.length === 0 ? <p>No verifiable excerpt was available.</p> : brief.evidence.map((item, index) => <blockquote key={`${item.source}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><p>“{item.excerpt}”</p><cite>{item.source}</cite></div></blockquote>)}</section>
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
    setLoading(true); setError(null); setData(null);
    void invoke<ProjectContribution | null>('get_project_contribution', { projectId: project.id })
      .then(setData)
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
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

  if (loading) return <section className="pivot-contribution-loading"><span /><p>Reading the latest saved evidence…</p></section>;
  if (!data) return <section className="pivot-contribution-empty">
    <div><span className="pivot-index">02 / CONTRIBUTION BRIEF</span><h3>Turn repository facts into an entry point.</h3><p>Collect README, contribution policy, templates, manifests, and the latest public GitHub issues. Selected excerpts are sent to your configured AI provider only when you start this analysis.</p></div>
    {error && <p className="pivot-error">{error}</p>}
    <button className="pivot-primary" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? 'Collecting evidence…' : 'Collect evidence & build brief'}</button>
  </section>;

  const snapshot = data.snapshot;
  const brief = snapshot.contribution_brief;
  const issues = data.issues.filter((issue) => {
    if (issueFilter === 'prs') return issue.is_pull_request;
    if (issueFilter === 'issues') return !issue.is_pull_request;
    return !issue.is_pull_request && issue.labels.some((label) => ['good first issue', 'help wanted'].includes(label.toLowerCase()));
  });
  const sources = [
    { label: 'README', ready: snapshot.readme != null },
    { label: 'CONTRIBUTING', ready: snapshot.contributing != null },
    { label: 'CODE OF CONDUCT', ready: snapshot.code_of_conduct != null },
    { label: 'TEMPLATES', ready: snapshot.templates.length > 0, count: snapshot.templates.length },
    { label: 'TOOLING', ready: snapshot.detected_tools.length > 0, count: snapshot.detected_tools.length },
  ];

  return <section className="pivot-contribution-workspace">
    <header className="pivot-contribution-head"><div><span className="pivot-index">02 / CONTRIBUTION BRIEF</span><h3>Evidence before advice.</h3><p>Snapshot {shortSha(snapshot.commit_sha)} · captured {new Date(snapshot.captured_at).toLocaleString()}</p></div><button onClick={() => void analyze()} disabled={analyzing}>{analyzing ? 'Collecting…' : 'Refresh evidence'}</button></header>
    {error && <div className="pivot-inline-error">{error}</div>}
    {snapshot.collection_errors.length > 0 && <details className="pivot-partial"><summary><span>PARTIAL RESULT</span>{snapshot.collection_errors.length} source or analysis warning(s)</summary><ul>{snapshot.collection_errors.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <div className="pivot-source-strip">{sources.map((source) => <div key={source.label} className={source.ready ? 'ready' : ''}><i /> <span>{source.label}</span><b>{source.ready ? source.count ?? 'FOUND' : 'MISSING'}</b></div>)}</div>
    {brief ? <ContributionDocument brief={brief} /> : <div className="pivot-inline-error">The snapshot was saved without a valid Contribution Brief.</div>}
    <section className="pivot-issues">
      <header><div><span className="pivot-index">03 / PUBLIC ACTIVITY</span><h3>Choose a tractable entry point.</h3></div><div className="pivot-issue-filters">{([['entry', 'Entry issues'], ['issues', 'All issues'], ['prs', 'Pull requests']] as const).map(([value, label]) => <button key={value} className={issueFilter === value ? 'active' : ''} onClick={() => setIssueFilter(value)}>{label}</button>)}</div></header>
      {issues.length === 0 ? <div className="pivot-issues-empty">No matching item was found in the latest cached GitHub sample.</div> : <div className="pivot-issue-list">{issues.map((issue) => <div className="pivot-issue-row" key={issue.github_issue_id}><span className="pivot-issue-number">{issue.is_pull_request ? 'PR' : 'ISSUE'} #{issue.number}</span><div><strong>{issue.title}</strong><span>{issue.labels.map((label) => <i key={label}>{label}</i>)}</span></div><small>{issue.comments_count} comments<br />{issue.author_login ? `@${issue.author_login}` : ''}</small><div className="pivot-issue-actions">{!issue.is_pull_request && <button onClick={() => void createTask(issue)} disabled={creatingIssueId === issue.github_issue_id}>{creatingIssueId === issue.github_issue_id ? 'Adding…' : 'Start task'}</button>}<button onClick={() => void openUrl(issue.html_url)} aria-label="Open on GitHub">↗</button></div></div>)}</div>}
    </section>
  </section>;
}

function ProjectOverview({ project, onProjectChange, onTaskCreated }: { project: Project; onProjectChange: (project: Project) => void; onTaskCreated: (task: ContributionTask) => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = project.workspace;
  const status = workspace?.git_status;
  const githubUrl = project.github_full_name ? project.remote_url : null;

  async function refresh() {
    setRefreshing(true); setError(null);
    try { onProjectChange(await invoke<Project>('refresh_project_workspace', { projectId: project.id })); }
    catch (reason) { setError(String(reason)); }
    finally { setRefreshing(false); }
  }

  async function changeRole(roleMode: Role) {
    try { onProjectChange(await invoke<Project>('set_project_role', { projectId: project.id, roleMode })); }
    catch (reason) { setError(String(reason)); }
  }

  return <main className="pivot-overview">
    <header className="pivot-project-hero">
      <div className="pivot-hero-copy"><span className="pivot-index">PROJECT / {project.role_mode.toUpperCase()}</span><h2>{project.display_name}</h2><p>{project.description ?? 'A local open-source workspace.'}</p><div className="pivot-project-links">{project.github_full_name && <span>{project.github_full_name}</span>}{githubUrl && <button onClick={() => void openUrl(githubUrl)}>Open GitHub ↗</button>}</div></div>
      <div className="pivot-role-switch" aria-label="Project perspective">{(['contributor', 'maintainer', 'owner'] as Role[]).map((role) => <button key={role} className={project.role_mode === role ? 'active' : ''} onClick={() => void changeRole(role)}>{role}</button>)}</div>
    </header>
    {error && <div className="pivot-inline-error">{error}</div>}
    <section className="pivot-workspace-section">
      <div className="pivot-section-title"><div><span className="pivot-index">01 / LOCAL WORKSPACE</span><h3>{workspace ? 'Repository connected' : 'Connect a local clone'}</h3></div>{workspace && <button onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Scanning…' : 'Refresh status'}</button>}</div>
      {workspace ? <div className="pivot-status-board">
        <div className="pivot-status-primary"><span className={status?.clean ? 'pivot-signal clean' : 'pivot-signal changed'} /><div><small>CURRENT BRANCH</small><strong>{workspace.current_branch ?? 'Detached HEAD'}</strong><code>{shortSha(workspace.head_sha)}</code></div></div>
        <dl><div><dt>Working tree</dt><dd>{status?.clean ? 'Clean' : `${status?.changed_files.length ?? 0} changed files`}</dd></div><div><dt>Staged</dt><dd>{status?.staged ?? 0}</dd></div><div><dt>Unstaged</dt><dd>{status?.unstaged ?? 0}</dd></div><div><dt>Untracked</dt><dd>{status?.untracked ?? 0}</dd></div></dl>
        <div className="pivot-path"><span>ROOT</span><code>{workspace.local_path}</code></div>
        {!status?.clean && <div className="pivot-change-list">{status?.changed_files.slice(0, 6).map((file) => <code key={file}>{file}</code>)}{(status?.changed_files.length ?? 0) > 6 && <span>+{(status?.changed_files.length ?? 0) - 6} more</span>}</div>}
      </div> : <div className="pivot-connect-callout"><div><strong>No filesystem access granted.</strong><p>Connect an existing clone by adding its local path. Clone execution will arrive with a separate confirmation step.</p></div><span>READ-ONLY</span></div>}
    </section>
    <ContributionWorkspace project={project} onTaskCreated={onTaskCreated} />
  </main>;
}

function FutureScreen({ screen }: { screen: 'tasks' | 'maintain' }) {
  const maintain = screen === 'maintain';
  return <main className="pivot-future"><span className="pivot-index">{maintain ? 'MAINTAINER / OWNER' : 'CONTRIBUTION TASKS'}</span><h1>{maintain ? 'Make the entry point obvious.' : 'Carry the work to a PR.'}</h1><p>{maintain ? 'Contributor readiness, issue health, and onboarding gaps will use the same Project evidence.' : 'Plans, branches, checks, notes, and PR readiness will live here after the Project foundation is stable.'}</p><div className="pivot-phase-stamp">PHASE {maintain ? '05' : '03–04'}</div></main>;
}

function SettingsScreen() {
  return <main className="pivot-settings"><span className="pivot-index">SETTINGS / TRANSITION</span><h1>Keep the old galaxy intact.</h1><p>The Star library source and data remain untouched while the Project domain is built independently. Credentials continue to stay in the Rust-owned configuration.</p><section><div><strong>Legacy Star workspace</strong><span>Preserved in source and archive/pre-pivot-20260824</span></div><i>ISOLATED</i></section><section><div><strong>External mutations</strong><span>Clone, branch, command, commit, push, and PR actions</span></div><i>CONFIRMATION REQUIRED</i></section></main>;
}

export default function PivotApp() {
  const [screen, setScreen] = useState<Screen>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openedTaskId, setOpenedTaskId] = useState<string | null>(null);
  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? null, [projects, selectedId]);

  useEffect(() => {
    void invoke<Project[]>('list_projects').then((items) => { setProjects(items); setSelectedId(items[0]?.id ?? null); }).finally(() => setLoading(false));
  }, []);

  function updateProject(next: Project) {
    setProjects((items) => items.map((project) => project.id === next.id ? next : project));
  }

  function openTask(task: ContributionTask) {
    setOpenedTaskId(task.id);
    setScreen('tasks');
  }

  return <div className="pivot-shell">
    <aside className="pivot-nav"><button className="pivot-brand" onClick={() => setScreen('projects')} aria-label="eunha projects"><span>e</span><strong>eunha</strong></button><nav>{NAV.map((item) => <button key={item.id} className={screen === item.id ? 'active' : ''} onClick={() => setScreen(item.id)}><i>{item.mark}</i><span>{item.label}</span></button>)}</nav><footer><span>LOCAL</span><i>v0.1 pivot</i></footer></aside>
    <div className="pivot-workbench">
      {screen === 'projects' ? <>{loading ? <div className="pivot-loading">Reading local workspace…</div> : <ProjectList projects={projects} selectedId={selectedId} onSelect={setSelectedId} onAdd={() => setAddOpen(true)} />}{selected ? <ProjectOverview project={selected} onProjectChange={updateProject} onTaskCreated={openTask} /> : !loading && <main className="pivot-no-selection"><span>PROJECT / 00</span><h1>Begin with a repository.</h1><p>The Star catalogue is no longer the starting point. Add only the work you intend to understand, contribute to, or maintain.</p><button onClick={() => setAddOpen(true)}>Add project</button></main>}</> : screen === 'tasks' ? <TasksScreen projects={projects} initialTaskId={openedTaskId} onProjectChange={updateProject} /> : screen === 'maintain' ? <FutureScreen screen="maintain" /> : <SettingsScreen />}
    </div>
    {addOpen && <AddProjectPanel onClose={() => setAddOpen(false)} onSaved={(project) => { setProjects((items) => [project, ...items]); setSelectedId(project.id); setAddOpen(false); setScreen('projects'); }} />}
  </div>;
}
