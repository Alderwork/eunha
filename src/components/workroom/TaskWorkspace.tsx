import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContributionTask, Project, TaskStatus, TaskWorkspace as TaskWorkspaceData } from '../../types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  candidate: 'Candidate', selected: 'Selected', preparing: 'Preparing', in_progress: 'In progress',
  ready_for_pr: 'Ready for PR', submitted: 'Submitted', blocked: 'Blocked', abandoned: 'Abandoned',
};

function branchSuggestion(task: ContributionTask) {
  const issue = task.issue_number ? `issue-${task.issue_number}` : 'task';
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'work';
  return `${issue}/${slug}`;
}

function DirectTaskForm({ projects, onCreated }: { projects: Project[]; onCreated: (task: ContributionTask) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id); }, [projectId, projects]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !title.trim()) return;
    setBusy(true); setError(null);
    try {
      const task = await invoke<ContributionTask>('create_contribution_task', { projectId, issueId: null, title: title.trim(), notes: null });
      setTitle(''); onCreated(task);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <form className="workroom-direct-task" onSubmit={submit}>
    <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Project">{projects.map((project) => <option key={project.id} value={project.id}>{project.display_name}</option>)}</select>
    <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Task outcome" placeholder="Describe the contribution outcome" maxLength={240} />
    <button disabled={busy || !projectId || !title.trim()}>{busy ? 'Adding…' : 'Create task'}</button>
    {error && <p className="workroom-error" role="alert">{error}</p>}
  </form>;
}

function BranchConfirmation({ data, onClose, onCreated }: { data: TaskWorkspaceData; onClose: () => void; onCreated: (data: TaskWorkspaceData) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(() => branchSuggestion(data.task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = data.git?.status.changed_files.length ?? 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  async function create() {
    setBusy(true); setError(null);
    try { onCreated(await invoke<TaskWorkspaceData>('create_task_branch', { taskId: data.task.id, branchName: name, confirmed: true })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialogRef} className="workroom-dialog" aria-labelledby="branch-confirm-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="workroom-branch-confirm">
    <header><div><span className="workroom-index">APPROVAL / GIT MUTATION</span><h2 id="branch-confirm-title">Create a local branch?</h2></div><button className="workroom-icon-button" onClick={onClose} aria-label="Close branch confirmation">×</button></header>
    <p>This changes only the connected local repository. eunha will not commit, push, or open a pull request.</p>
    <dl><div><dt>Command</dt><dd><code>git switch -c {name || '…'}</code></dd></div><div><dt>Working directory</dt><dd><code>{data.workspace?.local_path}</code></dd></div><div><dt>Current state</dt><dd>{changed === 0 ? 'Clean working tree' : `${changed} changed file(s) will follow the new branch`}</dd></div></dl>
    <label>Branch name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} /></label>
    {error && <p className="workroom-error" role="alert">{error}</p>}
    <footer><button className="workroom-secondary" onClick={onClose}>Cancel</button><button className="workroom-primary" onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Confirm & create branch'}</button></footer>
  </section></dialog>;
}

function EmptyTaskDetail() {
  return <main className="workroom-task-empty"><span className="workroom-index">CONTRIBUTION TASK</span><h1>Carry one piece of work forward.</h1><p>Select an issue from a Project or create a local task. Scope, notes, branch state, and repository evidence persist between sessions.</p></main>;
}

function TaskDetail({ taskId, onTaskChange, onProjectChange }: { taskId: string; onTaskChange: (task: ContributionTask) => void; onProjectChange: (project: Project) => void }) {
  const [data, setData] = useState<TaskWorkspaceData | null>(null);
  const [notes, setNotes] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const requestId = useRef(0);

  async function load() {
    const request = ++requestId.current;
    setBusy(true); setError(null);
    try { const next = await invoke<TaskWorkspaceData>('get_task_workspace', { taskId }); if (request !== requestId.current) return; setData(next); setNotes(next.task.notes); onTaskChange(next.task); }
    catch (reason) { if (request === requestId.current) setError(String(reason)); }
    finally { if (request === requestId.current) setBusy(false); }
  }
  useEffect(() => { setData(null); void load(); return () => { requestId.current += 1; }; }, [taskId]);

  async function saveNotes() {
    if (!data) return;
    setBusy(true); setError(null);
    try { const task = await invoke<ContributionTask>('update_task_notes', { taskId, notes }); setData({ ...data, task }); onTaskChange(task); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function move(status: TaskStatus) {
    if (!data) return;
    setBusy(true); setError(null);
    try { const task = await invoke<ContributionTask>('update_task_status', { taskId, status }); setData({ ...data, task }); onTaskChange(task); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function connect() {
    if (!data || !path.trim()) return;
    setBusy(true); setError(null);
    try { const project = await invoke<Project>('connect_project_workspace', { projectId: data.task.project_id, localPath: path.trim() }); onProjectChange(project); await load(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  if (!data) return <main className="workroom-task-detail workroom-task-loading">{error ? <div className="workroom-task-retry"><p role="alert">{error}</p><button className="workroom-secondary" onClick={() => void load()} disabled={busy}>{busy ? 'Retrying…' : 'Retry'}</button></div> : 'Reading task workspace…'}</main>;
  const { task, workspace, git } = data;
  const nextAction = task.status === 'candidate'
    ? { label: 'Select task', run: () => void move('selected'), disabled: false }
    : task.status === 'selected'
      ? { label: 'Start preparing', run: () => void move('preparing'), disabled: false }
      : task.status === 'preparing'
        ? { label: workspace ? 'Create branch…' : 'Connect workspace first', run: () => setBranchOpen(true), disabled: !workspace }
        : task.status === 'blocked'
          ? { label: 'Resume task', run: () => void move(task.branch_name ? 'in_progress' : 'preparing'), disabled: false }
          : null;
  const canClose = !['submitted', 'abandoned'].includes(task.status);

  return <main className="workroom-task-detail">
    <header className="workroom-task-hero"><div><span className="workroom-index">{task.issue_number ? `ISSUE ${task.issue_number}` : 'LOCAL TASK'}</span><h1>{task.title}</h1><p>{task.github_full_name ?? task.project_name} · updated {new Date(task.updated_at).toLocaleString()}</p></div><div className={`workroom-task-status ${task.status}`}>{STATUS_LABEL[task.status]}</div></header>
    {error && <div className="workroom-inline-error" role="alert">{error}</div>}
    <section className="workroom-task-actions">
      {nextAction && <button className="workroom-task-next" onClick={nextAction.run} disabled={busy || nextAction.disabled}>{nextAction.label}</button>}
      <button className="workroom-refresh-task" onClick={() => void load()} disabled={busy}>{busy ? 'Reading…' : 'Refresh Git'}</button>
      {canClose && <details><summary>More</summary><div>{task.status !== 'blocked' && <button onClick={() => void move('blocked')}>Mark blocked</button>}<button onClick={() => void move('abandoned')}>Abandon task</button></div></details>}
    </section>

    <div className="workroom-task-grid">
      <section className="workroom-task-plan"><header><span className="workroom-index">SCOPE & NOTES</span>{task.issue_url && <button onClick={() => void openUrl(task.issue_url!)}>Open issue ↗</button>}</header>{data.issue_body ? <p>{data.issue_body.slice(0, 1800)}</p> : <p className="muted">This task has no linked issue. Use notes to define scope, decisions, and evidence.</p>}<div className="workroom-task-notes"><label>Personal work log<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decisions, file candidates, questions, and next steps…" /></label><button onClick={() => void saveNotes()} disabled={busy || notes === task.notes}>Save notes</button></div></section>

      <section className="workroom-task-git"><header><span className="workroom-index">BRANCH & CHANGES</span>{task.branch_name && <code>{task.branch_name}</code>}</header>
        {!workspace ? <div className="workroom-workspace-connect"><strong>Connect the local clone.</strong><p>Expected remote: {task.github_full_name ?? 'local project'}<br />Suggested location: ~/Developer/{task.github_full_name?.split('/').pop() ?? task.project_name}</p><label htmlFor="workspace-path">Repository path</label><div><input id="workspace-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path or ~/Developer/repo" /><button onClick={() => void connect()} disabled={busy || !path.trim()}>Connect path</button></div><small>eunha validates the Git repository and its GitHub remote before connecting it.</small></div> : <>
          <div className="workroom-live-git"><div><small>CURRENT BRANCH</small><strong>{git?.status.branch ?? 'Detached HEAD'}</strong><code>{git?.status.head_sha?.slice(0, 8) ?? '—'}</code></div><dl><div><dt>Staged</dt><dd>{git?.status.staged ?? 0}</dd></div><div><dt>Unstaged</dt><dd>{git?.status.unstaged ?? 0}</dd></div><div><dt>Untracked</dt><dd>{git?.status.untracked ?? 0}</dd></div></dl></div>
          {(git?.status.changed_files.length ?? 0) > 0 ? <div className="workroom-task-files">{git!.status.changed_files.map((file) => <code key={file}>{file}</code>)}</div> : <div className="workroom-clean-tree">WORKING TREE CLEAN</div>}
          {(git?.diff_stat || git?.staged_diff_stat) && <pre className="workroom-diff-stat">{[git.staged_diff_stat && 'STAGED\n' + git.staged_diff_stat, git.diff_stat && 'UNSTAGED\n' + git.diff_stat].filter(Boolean).join('\n\n')}</pre>}
          <section className="workroom-task-commits"><header><span>RECENT COMMITS</span></header>{git?.recent_commits.length ? git.recent_commits.slice(0, 3).map((commit) => <div key={commit.sha}><code>{commit.sha.slice(0, 7)}</code><strong>{commit.summary}</strong><small>{commit.author} · {new Date(commit.authored_at).toLocaleDateString()}</small></div>) : <p>No local commit history available.</p>}</section>
        </>}
      </section>

      <section className="workroom-task-checks"><header><span className="workroom-index">VERIFICATION</span><i>REPOSITORY EVIDENCE</i></header>{data.verification_commands.length === 0 ? <p>No verification command was found in the latest project snapshot.</p> : data.verification_commands.map((command) => <code key={command}><span>$</span>{command}</code>)}<small>Commands shown here are not executed without a separate approval.</small></section>
    </div>
    {branchOpen && <BranchConfirmation data={data} onClose={() => setBranchOpen(false)} onCreated={(next) => {
      setData(next);
      setNotes(next.task.notes);
      onTaskChange(next.task);
      setBranchOpen(false);
      void invoke<Project>('get_project', { projectId: next.task.project_id })
        .then(onProjectChange)
        .catch((reason) => setError(`Branch created, but project state could not be refreshed: ${String(reason)}`));
    }} />}
  </main>;
}

export function TasksScreen({ projects, initialTaskId, onProjectChange }: { projects: Project[]; initialTaskId: string | null; onProjectChange: (project: Project) => void }) {
  const [tasks, setTasks] = useState<ContributionTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void invoke<ContributionTask[]>('list_contribution_tasks').then((items) => { setTasks(items); setSelectedId((current) => current ?? items[0]?.id ?? null); }).catch((reason) => setError(String(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (initialTaskId) setSelectedId(initialTaskId); }, [initialTaskId]);
  const selected = useMemo(() => tasks.find((task) => task.id === selectedId), [tasks, selectedId]);
  function upsert(task: ContributionTask) { setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]); setSelectedId(task.id); }

  return <><aside className="workroom-task-list"><header><div><span className="workroom-index">CONTRIBUTION LEDGER</span><h1>Tasks</h1></div><span>{tasks.filter((task) => !['submitted', 'abandoned'].includes(task.status)).length} ACTIVE</span></header><details className="workroom-new-task" open={tasks.length === 0}><summary>+ New task</summary><DirectTaskForm projects={projects} onCreated={upsert} /></details>{error ? <p className="workroom-error" role="alert">{error}</p> : loading ? <p className="workroom-list-loading">Reading tasks…</p> : tasks.length === 0 ? <div className="workroom-empty-tasks"><strong>No contribution task yet.</strong><p>Choose an issue inside a Project or write a local outcome above.</p></div> : <div className="workroom-task-rows">{tasks.map((task) => <button className={selectedId === task.id ? 'active' : ''} aria-current={selectedId === task.id ? 'true' : undefined} key={task.id} onClick={() => setSelectedId(task.id)}><div><strong>{task.title}</strong><small>{task.github_full_name ?? task.project_name}</small><i>{task.branch_name ?? (task.issue_number ? `issue #${task.issue_number}` : 'local task')}</i></div><b className={task.status}>{STATUS_LABEL[task.status]}</b></button>)}</div>}</aside>{selected ? <TaskDetail taskId={selected.id} onTaskChange={upsert} onProjectChange={onProjectChange} /> : <EmptyTaskDetail />}</>;
}
