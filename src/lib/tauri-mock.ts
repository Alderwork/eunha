import type {
  ContributionTask,
  Project,
  ProjectContribution,
  ProjectDraft,
  ProjectIssue,
  TaskStatus,
  TaskWorkspace,
  Workspace,
} from '../types';

const now = new Date().toISOString();

const workspace: Workspace = {
  id: 'workspace:/Users/jgo/Developer/codex',
  project_id: 'github:openai/codex',
  local_path: '/Users/jgo/Developer/codex',
  default_branch: 'main',
  current_branch: 'docs/contribution-brief',
  head_sha: '5d91a7430a18dc21',
  git_status: {
    branch: 'docs/contribution-brief',
    head_sha: '5d91a7430a18dc21',
    changed_files: ['docs/contributing.md', 'README.md'],
    staged: 1,
    unstaged: 1,
    untracked: 0,
    clean: false,
  },
  last_scanned_at: now,
};

const projects: Project[] = [{
  id: 'github:openai/codex',
  github_full_name: 'openai/codex',
  remote_url: 'https://github.com/openai/codex',
  display_name: 'codex',
  description: 'A lightweight coding agent that runs in your terminal.',
  default_branch: 'main',
  role_mode: 'contributor',
  created_at: now,
  updated_at: now,
  workspace,
}];

const issues: ProjectIssue[] = [
  {
    github_issue_id: 101,
    project_id: projects[0].id,
    number: 8421,
    title: 'Improve first-run setup diagnostics',
    body: 'Make setup failures actionable.',
    html_url: 'https://github.com/openai/codex/issues/8421',
    labels: ['good first issue', 'help wanted'],
    state: 'open',
    author_login: 'maintainer',
    is_pull_request: false,
    comments_count: 4,
    updated_at: now,
  },
  {
    github_issue_id: 102,
    project_id: projects[0].id,
    number: 8390,
    title: 'Document local model configuration',
    body: null,
    html_url: 'https://github.com/openai/codex/issues/8390',
    labels: ['documentation'],
    state: 'open',
    author_login: 'contributor',
    is_pull_request: false,
    comments_count: 2,
    updated_at: now,
  },
  {
    github_issue_id: 103,
    project_id: projects[0].id,
    number: 8401,
    title: 'Refine command approval messaging',
    body: null,
    html_url: 'https://github.com/openai/codex/pull/8401',
    labels: ['ui'],
    state: 'open',
    author_login: 'contributor',
    is_pull_request: true,
    comments_count: 6,
    updated_at: now,
  },
];

const contribution: ProjectContribution = {
  snapshot: {
    project_id: projects[0].id,
    commit_sha: workspace.head_sha,
    readme: '# Codex\nA lightweight coding agent.',
    contributing: 'Run cargo test before opening a pull request.',
    code_of_conduct: null,
    templates: [{ source: '.github/ISSUE_TEMPLATE/bug.yml', content: 'name: Bug report' }],
    detected_tools: [{
      source: 'Cargo.toml',
      name: 'Rust / Cargo',
      commands: ['cargo test', 'cargo fmt --check', 'cargo clippy --all-targets'],
    }],
    evidence: [{
      source: 'CONTRIBUTING.md',
      excerpt: 'Run cargo test before opening a pull request.',
    }],
    contribution_brief: {
      project_definition: 'A coding agent that helps developers work with repositories from the terminal.',
      contributor_entry_points: [
        'Start with CONTRIBUTING.md.',
        'Review issues labeled good first issue or help wanted.',
      ],
      setup_requirements: ['Rust / Cargo configuration is declared in Cargo.toml.'],
      verification_commands: ['cargo test', 'cargo fmt --check', 'cargo clippy --all-targets'],
      contribution_rules: ['Run the documented checks before opening a pull request.'],
      maturity_signals: ['The current GitHub sample contains two open issues and one open pull request.'],
      cautions: ['The code of conduct was not found in the collected sources.'],
      evidence: [
        {
          source: 'CONTRIBUTING.md',
          excerpt: 'Run cargo test before opening a pull request.',
        },
        { source: 'README.md', excerpt: 'A lightweight coding agent.' },
      ],
      unknowns: ['Required Rust toolchain version was not stated in the collected excerpts.'],
    },
    collection_errors: ['CODE_OF_CONDUCT was not found.'],
    captured_at: now,
    generated_at: now,
  },
  issues,
};

const tasks: ContributionTask[] = [{
  id: 'task:preview',
  project_id: projects[0].id,
  project_name: projects[0].display_name,
  github_full_name: projects[0].github_full_name,
  issue_id: issues[0].github_issue_id,
  issue_number: issues[0].number,
  issue_url: issues[0].html_url,
  workspace_id: workspace.id,
  title: issues[0].title,
  status: 'in_progress',
  branch_name: 'fix/setup-diagnostics',
  notes: 'Trace the first-run error path and keep the message actionable.',
  created_at: now,
  updated_at: now,
}];

function findProject(id: unknown): Project {
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error('Project not found.');
  return project;
}

function findTask(id: unknown): ContributionTask {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw new Error('Task not found.');
  return task;
}

function taskWorkspace(task: ContributionTask): TaskWorkspace {
  const project = findProject(task.project_id);
  const connected = project.workspace;
  return {
    task,
    workspace: connected,
    issue_body: issues.find((issue) => issue.github_issue_id === task.issue_id)?.body ?? null,
    verification_commands: contribution.snapshot.contribution_brief?.verification_commands ?? [],
    git: connected ? {
      status: connected.git_status,
      diff_stat: 'README.md | 3 ++-',
      staged_diff_stat: 'docs/contributing.md | 6 ++++++',
      recent_commits: [
        {
          sha: connected.head_sha ?? '5d91a743',
          summary: 'Clarify contribution setup',
          author: 'Preview User',
          authored_at: now,
        },
      ],
    } : null,
  };
}

let githubPat = 'github_pat_••••••••••••demo';
let conduitActive: string | null = null;
let conduitConnections: Record<string, unknown>[] = [];

function patSettings() {
  return {
    pat_set: Boolean(githubPat),
    pat_masked: githubPat ? '•'.repeat(Math.min(24, Math.max(0, githubPat.length - 4))) + githubPat.slice(-4) : '',
  };
}

function isPreviewLocalPath(input: string) {
  return input === '~'
    || input.startsWith('/')
    || input.startsWith('~/')
    || input.startsWith('./')
    || input.startsWith('../')
    || /^[a-zA-Z]:[\\/]/.test(input);
}

function previewPathName(input: string) {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && !['~', '.', '..'].includes(part))
    .pop() ?? 'local-project';
}

export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  switch (command) {
    case 'list_projects':
      return projects as T;
    case 'get_project':
    case 'refresh_project_workspace':
      return findProject(args.projectId) as T;
    case 'inspect_project_input': {
      const input = String(args.input ?? '').trim();
      if (!input) throw new Error('Enter a GitHub repository or local path.');
      if (isPreviewLocalPath(input)) {
        const name = previewPathName(input);
        return {
          github_full_name: null,
          remote_url: null,
          display_name: name,
          description: null,
          local_path: input,
          clone_suggestion: null,
          workspace_status: workspace.git_status,
          default_branch: 'main',
          warnings: ['Browser preview does not inspect the local filesystem.'],
        } as ProjectDraft as T;
      }
      const fullName = input
        .replace(/^https?:\/\/(www\.)?github\.com\//, '')
        .replace(/\.git\/?$/, '')
        .replace(/\/$/, '');
      if (!/^[-\w.]+\/[-\w.]+$/.test(fullName)) {
        throw new Error('Enter owner/repo, a GitHub URL, or an absolute local path.');
      }
      const name = fullName.split('/')[1];
      return {
        github_full_name: fullName,
        remote_url: 'https://github.com/' + fullName,
        display_name: name,
        description: 'Public GitHub repository ready to become an eunha project.',
        local_path: null,
        clone_suggestion: '/Users/jgo/Developer/' + name,
        workspace_status: null,
        default_branch: 'main',
        warnings: ['No local workspace is connected yet. Clone remains user-approved.'],
      } as ProjectDraft as T;
    }
    case 'save_project': {
      const draft = args.draft as ProjectDraft;
      const project: Project = {
        id: draft.github_full_name
          ? 'github:' + draft.github_full_name
          : 'local:' + draft.local_path,
        github_full_name: draft.github_full_name,
        remote_url: draft.remote_url,
        display_name: draft.display_name,
        description: draft.description,
        default_branch: draft.default_branch,
        role_mode: 'contributor',
        created_at: now,
        updated_at: now,
        workspace: draft.local_path ? {
          ...workspace,
          id: 'workspace:' + draft.local_path,
          project_id: draft.github_full_name
            ? 'github:' + draft.github_full_name
            : 'local:' + draft.local_path,
          local_path: draft.local_path,
          git_status: draft.workspace_status ?? workspace.git_status,
        } : null,
      };
      projects.unshift(project);
      return project as T;
    }
    case 'get_project_contribution':
      return args.projectId === contribution.snapshot.project_id ? contribution as T : null as T;
    case 'analyze_project_contribution':
      contribution.snapshot.project_id = String(args.projectId);
      return contribution as T;
    case 'create_contribution_task': {
      const project = findProject(args.projectId);
      const issue = issues.find((item) => item.github_issue_id === args.issueId);
      const task: ContributionTask = {
        id: 'task:' + Date.now(),
        project_id: project.id,
        project_name: project.display_name,
        github_full_name: project.github_full_name,
        issue_id: issue?.github_issue_id ?? null,
        issue_number: issue?.number ?? null,
        issue_url: issue?.html_url ?? null,
        workspace_id: project.workspace?.id ?? null,
        title: String(args.title ?? '').trim(),
        status: 'selected',
        branch_name: null,
        notes: String(args.notes ?? ''),
        created_at: now,
        updated_at: now,
      };
      if (!task.title) throw new Error('Task title is required.');
      tasks.unshift(task);
      return task as T;
    }
    case 'list_contribution_tasks':
      return tasks as T;
    case 'get_task_workspace':
      return taskWorkspace(findTask(args.taskId)) as T;
    case 'update_task_notes': {
      const task = findTask(args.taskId);
      task.notes = String(args.notes ?? '');
      task.updated_at = new Date().toISOString();
      return task as T;
    }
    case 'update_task_status': {
      const task = findTask(args.taskId);
      const status = args.status as TaskStatus;
      if (status === 'ready_for_pr') throw new Error('PR readiness must be confirmed through the readiness flow.');
      if (status === 'submitted') throw new Error('PR submission must be confirmed through the PR readiness flow.');
      task.status = status;
      task.updated_at = new Date().toISOString();
      return task as T;
    }
    case 'connect_project_workspace': {
      const project = findProject(args.projectId);
      const localPath = String(args.localPath ?? '').trim();
      if (!isPreviewLocalPath(localPath)) throw new Error('Enter an existing local repository path.');
      project.workspace = {
        ...workspace,
        id: 'workspace:' + localPath,
        project_id: project.id,
        local_path: localPath,
      };
      tasks
        .filter((task) => task.project_id === project.id)
        .forEach((task) => { task.workspace_id = project.workspace?.id ?? null; });
      return project as T;
    }
    case 'create_task_branch': {
      if (args.confirmed !== true) throw new Error('Branch creation requires explicit confirmation.');
      const task = findTask(args.taskId);
      const project = findProject(task.project_id);
      if (!project.workspace) throw new Error('Connect a local workspace first.');
      const branchName = String(args.branchName ?? '').trim();
      if (!branchName || /\s/.test(branchName)) throw new Error('Enter a valid branch name.');
      task.branch_name = branchName;
      task.status = 'in_progress';
      task.updated_at = new Date().toISOString();
      project.workspace.current_branch = branchName;
      project.workspace.git_status.branch = branchName;
      return taskWorkspace(task) as T;
    }
    case 'get_settings':
      return patSettings() as T;
    case 'save_settings':
      if (args.clearGithubPat === true) githubPat = '';
      else if (typeof args.githubPat === 'string' && args.githubPat.trim()) githubPat = args.githubPat.trim();
      return patSettings() as T;
    case 'conduit_list':
      return { active: conduitActive, connections: conduitConnections } as T;
    case 'conduit_save': {
      const input = args.input as Record<string, unknown>;
      const id = String(input.provider);
      const previous = conduitConnections.find((item) => item.id === id);
      conduitConnections = [
        {
          id,
          provider: id,
          status: 'configured',
          key_set: Boolean(input.credentials) || Boolean(previous?.key_set),
          defaultModel: input.defaultModel,
          meta: input.meta,
          createdAt: previous?.createdAt ?? now,
          updatedAt: new Date().toISOString(),
        },
        ...conduitConnections.filter((item) => item.id !== id),
      ];
      return null as T;
    }
    case 'conduit_delete':
      conduitConnections = conduitConnections.filter((item) => item.id !== args.id);
      if (conduitActive === args.id) conduitActive = null;
      return null as T;
    case 'conduit_set_active':
      conduitActive = args.id == null ? null : String(args.id);
      return null as T;
    default:
      throw new Error('Browser preview does not implement ' + command + '.');
  }
}

export async function openUrl(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}
