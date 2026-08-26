import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

  return <form className="pivot-direct-task" onSubmit={submit}>
    <span className="pivot-index">NEW / LOCAL TASK</span>
    <div><select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Project">{projects.map((project) => <option key={project.id} value={project.id}>{project.display_name}</option>)}</select><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the contribution outcome" maxLength={240} /><button disabled={busy || !projectId || !title.trim()}>{busy ? 'Adding…' : 'Create task'}</button></div>
    {error && <p className="pivot-error">{error}</p>}
  </form>;
}

function BranchConfirmation({ data, onClose, onCreated }: { data: TaskWorkspaceData; onClose: () => void; onCreated: (data: TaskWorkspaceData) => void }) {
  const [name, setName] = useState(() => branchSuggestion(data.task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = data.git?.status.changed_files.length ?? 0;

  async function create() {
    setBusy(true); setError(null);
    try { onCreated(await invoke<TaskWorkspaceData>('create_task_branch', { taskId: data.task.id, branchName: name, confirmed: true })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="pivot-scrim" role="presentation"><section className="pivot-branch-confirm" role="dialog" aria-modal="true" aria-labelledby="branch-confirm-title">
    <header><div><span className="pivot-index">APPROVAL / GIT MUTATION</span><h2 id="branch-confirm-title">Create a local branch?</h2></div><button className="pivot-icon-button" onClick={onClose}>×</button></header>
    <p>This changes only the connected local repository. eunha will not commit, push, or open a pull request.</p>
    <dl><div><dt>Command</dt><dd><code>git switch -c {name || '…'}</code></dd></div><div><dt>Working directory</dt><dd><code>{data.workspace?.local_path}</code></dd></div><div><dt>Current state</dt><dd>{changed === 0 ? 'Clean working tree' : `${changed} changed file(s) will follow the new branch`}</dd></div></dl>
    <label>Branch name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} /></label>
    {error && <p className="pivot-error">{error}</p>}
    <footer><button className="pivot-secondary" onClick={onClose}>Cancel</button><button className="pivot-primary" onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Confirm & create branch'}</button></footer>
  </section></div>;
}

function EmptyTaskDetail() {
  return <main className="pivot-task-empty"><span className="pivot-index">TASK / 00</span><h1>Turn an intention into local work.</h1><p>Select an issue from a Project or create a local task. Notes, branch state, and repository evidence will survive the next launch.</p></main>;
}

function TaskDetail({ taskId, onTaskChange, onProjectChange }: { taskId: string; onTaskChange: (task: ContributionTask) => void; onProjectChange: (project: Project) => void }) {
  const [data, setData] = useState<TaskWorkspaceData | null>(null);
  const [notes, setNotes] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);

  async function load() {
    setBusy(true); setError(null);
    try { const next = await invoke<TaskWorkspaceData>('get_task_workspace', { taskId }); setData(next); setNotes(next.task.notes); onTaskChange(next.task); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [taskId]);

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

  if (!data) return <main className="pivot-task-detail pivot-task-loading">{error ?? 'Reading task workspace…'}</main>;
  const { task, workspace, git } = data;
  const canBranch = workspace && !task.branch_name && ['selected', 'preparing', 'blocked'].includes(task.status);

  return <main className="pivot-task-detail">
    <header className="pivot-task-hero"><div><span className="pivot-index">TASK / {task.issue_number ? `ISSUE ${task.issue_number}` : 'LOCAL'}</span><h1>{task.title}</h1><p>{task.github_full_name ?? task.project_name} · updated {new Date(task.updated_at).toLocaleString()}</p></div><div className={`pivot-task-status ${task.status}`}>{STATUS_LABEL[task.status]}</div></header>
    {error && <div className="pivot-inline-error">{error}</div>}
    <section className="pivot-task-actions"><div><span>STATE</span>{task.status === 'selected' && <button onClick={() => void move('preparing')}>Start preparing</button>}{task.status === 'preparing' && <button disabled={!workspace} onClick={() => setBranchOpen(true)}>Create branch…</button>}{task.status === 'in_progress' && <button onClick={() => void move('ready_for_pr')}>Mark ready for PR</button>}{task.status === 'blocked' && <button onClick={() => void move(task.branch_name ? 'in_progress' : 'preparing')}>Resume task</button>}{canBranch && task.status !== 'preparing' && <button onClick={() => setBranchOpen(true)}>Create branch…</button>}</div><div><span>EXCEPTIONS</span>{!['blocked', 'abandoned', 'submitted'].includes(task.status) && <><button onClick={() => void move('blocked')}>Block</button><button onClick={() => void move('abandoned')}>Abandon</button></>}</div><button className="pivot-refresh-task" onClick={() => void load()} disabled={busy}>{busy ? 'Reading…' : 'Refresh Git'}</button></section>

    <div className="pivot-task-grid">
      <section className="pivot-task-plan"><header><span className="pivot-index">01 / PLAN & EVIDENCE</span>{task.issue_url && <button onClick={() => void openUrl(task.issue_url!)}>Open issue ↗</button>}</header>{data.issue_body ? <p>{data.issue_body.slice(0, 1800)}</p> : <p className="muted">This task has no linked issue. Use notes to define scope, decisions, and evidence.</p>}<div className="pivot-task-notes"><label>Personal work log<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decisions, file candidates, questions, and next steps…" /></label><button onClick={() => void saveNotes()} disabled={busy || notes === task.notes}>Save notes</button></div></section>

      <section className="pivot-task-git"><header><span className="pivot-index">02 / GIT BRANCH & CHANGES</span>{task.branch_name && <code>{task.branch_name}</code>}</header>
        {!workspace ? <div className="pivot-workspace-connect"><strong>Connect the local clone.</strong><p>Expected remote: {task.github_full_name ?? 'local project'}<br />Clone candidate: ~/Developer/{task.github_full_name?.split('/').pop() ?? task.project_name}</p><div><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path/to/repository" /><button onClick={() => void connect()} disabled={busy || !path.trim()}>Connect path</button></div><small>Clone is never executed here. Choose or clone the repository yourself, then connect its path.</small></div> : <>
          <div className="pivot-live-git"><div><small>CURRENT BRANCH</small><strong>{git?.status.branch ?? 'Detached HEAD'}</strong><code>{git?.status.head_sha?.slice(0, 8) ?? '—'}</code></div><dl><div><dt>Staged</dt><dd>{git?.status.staged ?? 0}</dd></div><div><dt>Unstaged</dt><dd>{git?.status.unstaged ?? 0}</dd></div><div><dt>Untracked</dt><dd>{git?.status.untracked ?? 0}</dd></div></dl></div>
          {(git?.status.changed_files.length ?? 0) > 0 ? <div className="pivot-task-files">{git!.status.changed_files.map((file) => <code key={file}>{file}</code>)}</div> : <div className="pivot-clean-tree">WORKING TREE CLEAN</div>}
          {(git?.diff_stat || git?.staged_diff_stat) && <pre className="pivot-diff-stat">{[git.staged_diff_stat && 'STAGED\n' + git.staged_diff_stat, git.diff_stat && 'UNSTAGED\n' + git.diff_stat].filter(Boolean).join('\n\n')}</pre>}
        </>}
      </section>

      <section className="pivot-task-checks"><header><span className="pivot-index">03 / CHECK CANDIDATES</span><i>DETECTED ONLY</i></header>{data.verification_commands.length === 0 ? <p>No verification command was found in the latest project snapshot.</p> : data.verification_commands.map((command) => <code key={command}><span>$</span>{command}</code>)}<small>Execution and result history arrive in Phase 4. No command runs from this panel.</small></section>
      <section className="pivot-task-commits"><header><span className="pivot-index">04 / RECENT COMMITS</span></header>{git?.recent_commits.length ? git.recent_commits.map((commit) => <div key={commit.sha}><code>{commit.sha.slice(0, 7)}</code><strong>{commit.summary}</strong><small>{commit.author} · {new Date(commit.authored_at).toLocaleDateString()}</small></div>) : <p>No local commit history available.</p>}</section>
    </div>
    {branchOpen && <BranchConfirmation data={data} onClose={() => setBranchOpen(false)} onCreated={(next) => { setData(next); setNotes(next.task.notes); onTaskChange(next.task); setBranchOpen(false); }} />}
  </main>;
}

export function TasksScreen({ projects, initialTaskId, onProjectChange }: { projects: Project[]; initialTaskId: string | null; onProjectChange: (project: Project) => void }) {
  const [tasks, setTasks] = useState<ContributionTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void invoke<ContributionTask[]>('list_contribution_tasks').then((items) => { setTasks(items); setSelectedId((current) => current ?? items[0]?.id ?? null); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (initialTaskId) setSelectedId(initialTaskId); }, [initialTaskId]);
  const selected = useMemo(() => tasks.find((task) => task.id === selectedId), [tasks, selectedId]);
  function upsert(task: ContributionTask) { setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]); setSelectedId(task.id); }

  return <><aside className="pivot-task-list"><header><div><span className="pivot-index">CONTRIBUTION LEDGER</span><h1>Tasks</h1></div><span>{tasks.filter((task) => !['submitted', 'abandoned'].includes(task.status)).length} ACTIVE</span></header><DirectTaskForm projects={projects} onCreated={upsert} />{loading ? <p>Reading tasks…</p> : tasks.length === 0 ? <div className="pivot-empty-tasks"><span>00</span><strong>No contribution task yet.</strong><p>Choose an issue inside a Project or write a local outcome above.</p></div> : <div className="pivot-task-rows">{tasks.map((task, index) => <button className={selectedId === task.id ? 'active' : ''} key={task.id} onClick={() => setSelectedId(task.id)}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{task.title}</strong><small>{task.github_full_name ?? task.project_name}</small><i>{task.branch_name ?? (task.issue_number ? `issue #${task.issue_number}` : 'local task')}</i></div><b className={task.status}>{STATUS_LABEL[task.status]}</b></button>)}</div>}</aside>{selected ? <TaskDetail taskId={selected.id} onTaskChange={upsert} onProjectChange={onProjectChange} /> : <EmptyTaskDetail />}</>;
}
