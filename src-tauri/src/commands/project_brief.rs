use crate::db::DbState;
use crate::llm::{call_llm, get_llm_settings};
use crate::models::{
    BriefEvidence, ContributionBrief, DetectedTool, ProjectContribution, ProjectIssue,
    ProjectSnapshot, SourceDocument,
};
use rusqlite::{params, OptionalExtension, Row};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_DOCUMENT_CHARS: usize = 40_000;
const MAX_PROMPT_DOCUMENT_CHARS: usize = 8_000;
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_TEMPLATE_COUNT: usize = 12;
const MANIFEST_NAMES: &[&str] = &[
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "Makefile",
    "justfile",
    "go.mod",
    "Gemfile",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
];

#[derive(Debug)]
struct ProjectContext {
    id: String,
    full_name: Option<String>,
    description: Option<String>,
    default_branch: Option<String>,
    workspace_path: Option<String>,
    head_sha: Option<String>,
}

#[derive(Default)]
struct CollectedSources {
    readme: Option<SourceDocument>,
    contributing: Option<SourceDocument>,
    code_of_conduct: Option<SourceDocument>,
    templates: Vec<SourceDocument>,
    manifests: Vec<SourceDocument>,
    commit_sha: Option<String>,
    errors: Vec<String>,
}

impl CollectedSources {
    fn documents(&self) -> Vec<SourceDocument> {
        self.readme
            .iter()
            .chain(self.contributing.iter())
            .chain(self.code_of_conduct.iter())
            .chain(self.templates.iter())
            .chain(self.manifests.iter())
            .cloned()
            .collect()
    }
}

#[derive(Deserialize)]
struct GithubTreeResponse {
    sha: Option<String>,
    tree: Vec<GithubTreeItem>,
    truncated: Option<bool>,
}

#[derive(Deserialize)]
struct GithubTreeItem {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Deserialize)]
struct GithubIssueResponse {
    id: i64,
    number: i64,
    title: String,
    body: Option<String>,
    html_url: String,
    labels: Vec<GithubLabel>,
    state: String,
    user: Option<GithubUser>,
    pull_request: Option<serde_json::Value>,
    comments: Option<i64>,
    updated_at: Option<String>,
}

#[derive(Deserialize)]
struct GithubLabel {
    name: String,
}

#[derive(Deserialize)]
struct GithubUser {
    login: String,
}

fn github_request(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .header("User-Agent", "eunha/1.0")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = crate::config::get_secret("github_pat").filter(|value| !value.is_empty()) {
        request.bearer_auth(token)
    } else {
        request
    }
}

async fn response_error(response: reqwest::Response, label: &str) -> String {
    let status = response.status();
    let rate_limited = matches!(status.as_u16(), 403 | 429)
        && response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok())
            == Some("0");
    if rate_limited {
        return "GitHub API rate limit reached. Cached project data is still available.".into();
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return "GitHub authentication failed. Update or remove the saved token in Settings."
            .into();
    }
    let detail = response.text().await.unwrap_or_default();
    if detail.is_empty() {
        format!("{label} failed with HTTP {status}.")
    } else {
        format!(
            "{label} failed with HTTP {status}: {}",
            truncate(&detail, 240)
        )
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn read_file_within_root(root: &Path, relative: &Path) -> Result<String, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Workspace root is no longer accessible.".to_string())?;
    let candidate = canonical_root.join(relative);
    let canonical_file = candidate
        .canonicalize()
        .map_err(|_| format!("{} is no longer accessible.", relative.display()))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(format!(
            "Refused to read {} because it resolves outside the workspace.",
            relative.display()
        ));
    }
    let metadata = fs::metadata(&canonical_file).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file.", relative.display()));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "Refused to read {} because it exceeds the 1 MB evidence limit.",
            relative.display()
        ));
    }
    let bytes = fs::read(&canonical_file).map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(truncate(&text, MAX_DOCUMENT_CHARS))
}

fn root_files(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_file() || kind.is_symlink())
                .map(|_| PathBuf::from(entry.file_name()))
        })
        .collect()
}

fn find_root_document(files: &[PathBuf], prefix: &str) -> Option<PathBuf> {
    files.iter().find_map(|path| {
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        (name == prefix || name.starts_with(&format!("{prefix}."))).then(|| path.clone())
    })
}

fn find_standard_document(root: &Path, root_entries: &[PathBuf], prefix: &str) -> Option<PathBuf> {
    find_root_document(root_entries, prefix).or_else(|| {
        [".github", "docs"].into_iter().find_map(|directory| {
            let entries = root_files(&root.join(directory));
            find_root_document(&entries, prefix).map(|path| PathBuf::from(directory).join(path))
        })
    })
}

fn is_template_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let supported = lower.ends_with(".md") || lower.ends_with(".yml") || lower.ends_with(".yaml");
    supported
        && (lower.starts_with(".github/issue_template/")
            || lower.starts_with("docs/issue_template/")
            || lower.starts_with(".github/pull_request_template/")
            || lower.starts_with("docs/pull_request_template/")
            || lower == ".github/pull_request_template.md"
            || lower == "docs/pull_request_template.md"
            || lower == "pull_request_template.md")
}

fn discover_local_templates(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for directory in [
        ".github/ISSUE_TEMPLATE",
        "docs/ISSUE_TEMPLATE",
        ".github/PULL_REQUEST_TEMPLATE",
        "docs/PULL_REQUEST_TEMPLATE",
    ] {
        let base = root.join(directory);
        if let Ok(entries) = fs::read_dir(base) {
            for entry in entries.flatten() {
                let relative = PathBuf::from(directory).join(entry.file_name());
                if is_template_path(&relative.to_string_lossy()) {
                    found.push(relative);
                }
            }
        }
    }
    for file in [
        ".github/PULL_REQUEST_TEMPLATE.md",
        "docs/PULL_REQUEST_TEMPLATE.md",
        "PULL_REQUEST_TEMPLATE.md",
    ] {
        if root.join(file).exists() {
            found.push(PathBuf::from(file));
        }
    }
    found.sort();
    found.truncate(MAX_TEMPLATE_COUNT);
    found
}

fn local_document(
    root: &Path,
    relative: PathBuf,
    errors: &mut Vec<String>,
) -> Option<SourceDocument> {
    match read_file_within_root(root, &relative) {
        Ok(content) => Some(SourceDocument {
            source: relative.to_string_lossy().to_string(),
            content,
        }),
        Err(error) => {
            errors.push(error);
            None
        }
    }
}

fn collect_local_sources(root: &Path, head_sha: Option<String>) -> CollectedSources {
    let files = root_files(root);
    let mut collected = CollectedSources {
        commit_sha: head_sha,
        ..Default::default()
    };
    collected.readme = find_root_document(&files, "readme")
        .and_then(|path| local_document(root, path, &mut collected.errors));
    collected.contributing = find_standard_document(root, &files, "contributing")
        .and_then(|path| local_document(root, path, &mut collected.errors));
    collected.code_of_conduct = find_standard_document(root, &files, "code_of_conduct")
        .and_then(|path| local_document(root, path, &mut collected.errors));
    collected.templates = discover_local_templates(root)
        .into_iter()
        .filter_map(|path| local_document(root, path, &mut collected.errors))
        .collect();
    collected.manifests = MANIFEST_NAMES
        .iter()
        .map(PathBuf::from)
        .filter(|path| root.join(path).exists())
        .filter_map(|path| local_document(root, path, &mut collected.errors))
        .collect();
    collected
}

fn remote_path_kind(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    let is_root = !path.contains('/');
    let in_standard_docs_dir = lower.starts_with(".github/") || lower.starts_with("docs/");
    let file_name = lower.rsplit('/').next().unwrap_or(&lower);
    if is_root && (lower == "readme" || lower.starts_with("readme.")) {
        Some("readme")
    } else if (is_root || in_standard_docs_dir)
        && (file_name == "contributing" || file_name.starts_with("contributing."))
    {
        Some("contributing")
    } else if (is_root || in_standard_docs_dir)
        && (file_name == "code_of_conduct" || file_name.starts_with("code_of_conduct."))
    {
        Some("code_of_conduct")
    } else if is_template_path(path) {
        Some("template")
    } else if is_root
        && MANIFEST_NAMES
            .iter()
            .any(|name| name.eq_ignore_ascii_case(path))
    {
        Some("manifest")
    } else {
        None
    }
}

async fn fetch_remote_file(
    client: &reqwest::Client,
    full_name: &str,
    branch: &str,
    path: &str,
) -> Result<SourceDocument, String> {
    let url = format!("https://api.github.com/repos/{full_name}/contents/{path}");
    let response = github_request(client, &url)
        .header("Accept", "application/vnd.github.raw+json")
        .query(&[("ref", branch)])
        .send()
        .await
        .map_err(|error| format!("Could not fetch {path}: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, &format!("Fetching {path}")).await);
    }
    let content = response
        .text()
        .await
        .map_err(|error| format!("Could not read {path}: {error}"))?;
    Ok(SourceDocument {
        source: path.to_string(),
        content: truncate(&content, MAX_DOCUMENT_CHARS),
    })
}

async fn collect_remote_sources(full_name: &str, branch: &str) -> CollectedSources {
    let client = reqwest::Client::new();
    let tree_url = format!("https://api.github.com/repos/{full_name}/git/trees/{branch}");
    let response = match github_request(&client, &tree_url)
        .query(&[("recursive", "1")])
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return CollectedSources {
                errors: vec![format!("Could not read GitHub tree: {error}")],
                ..Default::default()
            };
        }
    };
    if !response.status().is_success() {
        return CollectedSources {
            errors: vec![response_error(response, "GitHub tree collection").await],
            ..Default::default()
        };
    }
    let tree: GithubTreeResponse = match response.json().await {
        Ok(tree) => tree,
        Err(error) => {
            return CollectedSources {
                errors: vec![format!("Invalid GitHub tree response: {error}")],
                ..Default::default()
            };
        }
    };
    let mut collected = CollectedSources {
        commit_sha: tree.sha,
        ..Default::default()
    };
    if tree.truncated.unwrap_or(false) {
        collected
            .errors
            .push("GitHub truncated the repository tree; some templates may be missing.".into());
    }
    let mut selected: Vec<(String, &'static str)> = tree
        .tree
        .into_iter()
        .filter(|item| item.item_type == "blob")
        .filter_map(|item| remote_path_kind(&item.path).map(|kind| (item.path, kind)))
        .collect();
    selected.sort_by(|left, right| left.0.cmp(&right.0));
    selected.truncate(3 + MAX_TEMPLATE_COUNT + MANIFEST_NAMES.len());
    for (path, kind) in selected {
        match fetch_remote_file(&client, full_name, branch, &path).await {
            Ok(document) => match kind {
                "readme" if collected.readme.is_none() => collected.readme = Some(document),
                "contributing" if collected.contributing.is_none() => {
                    collected.contributing = Some(document)
                }
                "code_of_conduct" if collected.code_of_conduct.is_none() => {
                    collected.code_of_conduct = Some(document)
                }
                "template" if collected.templates.len() < MAX_TEMPLATE_COUNT => {
                    collected.templates.push(document)
                }
                "manifest" => collected.manifests.push(document),
                _ => {}
            },
            Err(error) => collected.errors.push(error),
        }
    }
    collected
}

fn package_manager(documents: &[SourceDocument]) -> &'static str {
    let names: HashSet<String> = documents
        .iter()
        .map(|doc| doc.source.to_lowercase())
        .collect();
    if names.contains("pnpm-lock.yaml") {
        "pnpm"
    } else if names.contains("yarn.lock") {
        "yarn"
    } else if names.contains("bun.lock") || names.contains("bun.lockb") {
        "bun"
    } else {
        "npm"
    }
}

fn detect_tools(
    manifests: &[SourceDocument],
    all_documents: &[SourceDocument],
) -> Vec<DetectedTool> {
    let mut tools = Vec::new();
    for document in manifests {
        match document.source.to_lowercase().as_str() {
            "package.json" => {
                let manager = package_manager(all_documents);
                let commands = serde_json::from_str::<serde_json::Value>(&document.content)
                    .ok()
                    .and_then(|json| {
                        json.get("scripts")
                            .and_then(|value| value.as_object())
                            .cloned()
                    })
                    .map(|scripts| {
                        ["test", "lint", "check", "typecheck", "build"]
                            .into_iter()
                            .filter(|name| scripts.contains_key(*name))
                            .map(|name| {
                                if manager == "npm" && name == "test" {
                                    "npm test".into()
                                } else {
                                    format!("{manager} {name}")
                                }
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                tools.push(DetectedTool {
                    source: document.source.clone(),
                    name: "Node.js".into(),
                    commands,
                });
            }
            "cargo.toml" => tools.push(DetectedTool {
                source: document.source.clone(),
                name: "Rust / Cargo".into(),
                commands: vec![
                    "cargo test".into(),
                    "cargo fmt --check".into(),
                    "cargo clippy --all-targets".into(),
                ],
            }),
            "pyproject.toml" => {
                let mut commands = Vec::new();
                if document.content.contains("pytest") {
                    commands.push("python -m pytest".into());
                }
                if document.content.contains("ruff") {
                    commands.push("ruff check .".into());
                }
                tools.push(DetectedTool {
                    source: document.source.clone(),
                    name: "Python".into(),
                    commands,
                });
            }
            "makefile" | "justfile" => {
                let runner = if document.source.eq_ignore_ascii_case("Makefile") {
                    "make"
                } else {
                    "just"
                };
                let commands = ["test", "check", "lint"]
                    .into_iter()
                    .filter(|target| {
                        document
                            .content
                            .lines()
                            .any(|line| line.trim_start().starts_with(&format!("{target}:")))
                    })
                    .map(|target| format!("{runner} {target}"))
                    .collect();
                tools.push(DetectedTool {
                    source: document.source.clone(),
                    name: runner.into(),
                    commands,
                });
            }
            "go.mod" => tools.push(DetectedTool {
                source: document.source.clone(),
                name: "Go".into(),
                commands: vec!["go test ./...".into()],
            }),
            "gemfile" => tools.push(DetectedTool {
                source: document.source.clone(),
                name: "Ruby / Bundler".into(),
                commands: Vec::new(),
            }),
            _ => {}
        }
    }
    tools
}

fn first_evidence(document: &SourceDocument) -> Option<BriefEvidence> {
    document.content.lines().find_map(|line| {
        let excerpt = line.trim();
        (excerpt.chars().count() >= 12 && !excerpt.starts_with("[![")).then(|| BriefEvidence {
            source: document.source.clone(),
            excerpt: truncate(excerpt, 240),
        })
    })
}

fn deterministic_brief(
    context: &ProjectContext,
    sources: &CollectedSources,
    tools: &[DetectedTool],
    issues: &[ProjectIssue],
) -> ContributionBrief {
    let documents = sources.documents();
    let evidence: Vec<BriefEvidence> = documents
        .iter()
        .filter_map(first_evidence)
        .take(8)
        .collect();
    let definition = context
        .description
        .clone()
        .or_else(|| {
            sources.readme.as_ref().and_then(|doc| {
                doc.content
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().trim_start_matches('#').trim().to_string())
            })
        })
        .unwrap_or_else(|| "Project definition was not available from collected sources.".into());
    let mut entry_points = Vec::new();
    if let Some(contributing) = &sources.contributing {
        entry_points.push(format!("Start with {}.", contributing.source));
    }
    let beginner_issues = issues
        .iter()
        .filter(|issue| {
            issue.labels.iter().any(|label| {
                matches!(
                    label.to_lowercase().as_str(),
                    "good first issue" | "help wanted"
                )
            })
        })
        .count();
    if beginner_issues > 0 {
        entry_points.push(format!(
            "Review {beginner_issues} open issue(s) labeled for contributors."
        ));
    }
    if !sources.templates.is_empty() {
        entry_points.push(
            "Use the repository issue and pull request templates when proposing work.".into(),
        );
    }
    let setup_requirements = tools
        .iter()
        .map(|tool| {
            format!(
                "{} configuration is declared in {}.",
                tool.name, tool.source
            )
        })
        .collect();
    let verification_commands = tools
        .iter()
        .flat_map(|tool| tool.commands.clone())
        .collect();
    let contribution_rules = sources
        .contributing
        .as_ref()
        .map(|doc| {
            vec![format!(
                "Follow the contribution process documented in {}.",
                doc.source
            )]
        })
        .unwrap_or_default();
    let open_issues = issues.iter().filter(|issue| !issue.is_pull_request).count();
    let open_prs = issues.iter().filter(|issue| issue.is_pull_request).count();
    let maturity_signals = if issues.is_empty() {
        Vec::new()
    } else {
        vec![format!("The current GitHub sample contains {open_issues} open issues and {open_prs} open pull requests.")]
    };
    let mut cautions = Vec::new();
    let mut unknowns = Vec::new();
    if sources.contributing.is_none() {
        cautions.push("No CONTRIBUTING document was found in the collected sources.".into());
    }
    if tools.iter().all(|tool| tool.commands.is_empty()) {
        unknowns
            .push("No verification command could be derived from a manifest or build file.".into());
    }
    if context.full_name.is_none() {
        unknowns.push(
            "GitHub issue and pull request activity is unavailable for this local-only project."
                .into(),
        );
    }
    if evidence.is_empty() {
        unknowns.push("No source excerpt was available; review the project files manually.".into());
    }
    ContributionBrief {
        project_definition: definition,
        contributor_entry_points: entry_points,
        setup_requirements,
        verification_commands,
        contribution_rules,
        maturity_signals,
        cautions,
        evidence,
        unknowns,
    }
}

fn clean_json(raw: &str) -> &str {
    let clean = raw.trim();
    let clean = clean
        .strip_prefix("```json")
        .or_else(|| clean.strip_prefix("```"))
        .unwrap_or(clean);
    clean.strip_suffix("```").unwrap_or(clean).trim()
}

async fn fetch_default_branch(full_name: &str) -> Result<String, String> {
    let response = github_request(
        &reqwest::Client::new(),
        &format!("https://api.github.com/repos/{full_name}"),
    )
    .send()
    .await
    .map_err(|error| format!("Could not resolve the default branch: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Default branch lookup").await);
    }
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid repository metadata: {error}"))?;
    json["default_branch"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "GitHub did not return a default branch.".to_string())
}

fn bounded_list(values: Vec<String>, count: usize, chars: usize) -> Vec<String> {
    values
        .into_iter()
        .map(|value| truncate(value.trim(), chars))
        .filter(|value| !value.is_empty())
        .take(count)
        .collect()
}

pub(crate) fn validate_contribution_brief(
    raw: &str,
    documents: &[SourceDocument],
    allowed_commands: &[String],
) -> Result<ContributionBrief, String> {
    let mut brief: ContributionBrief = serde_json::from_str(clean_json(raw))
        .map_err(|error| format!("Invalid Contribution Brief JSON: {error}"))?;
    brief.project_definition = truncate(brief.project_definition.trim(), 400);
    if brief.project_definition.is_empty() {
        return Err("Contribution Brief is missing project_definition.".into());
    }
    brief.contributor_entry_points = bounded_list(brief.contributor_entry_points, 8, 280);
    brief.setup_requirements = bounded_list(brief.setup_requirements, 10, 280);
    brief.contribution_rules = bounded_list(brief.contribution_rules, 10, 280);
    brief.maturity_signals = bounded_list(brief.maturity_signals, 8, 280);
    brief.cautions = bounded_list(brief.cautions, 8, 280);
    brief.unknowns = bounded_list(brief.unknowns, 10, 280);
    let allowed: HashSet<&str> = allowed_commands.iter().map(String::as_str).collect();
    let proposed = std::mem::take(&mut brief.verification_commands);
    for command in proposed {
        if allowed.contains(command.trim()) {
            brief.verification_commands.push(command.trim().to_string());
        } else {
            brief.unknowns.push(format!(
                "Unverified command omitted: {}",
                truncate(command.trim(), 120)
            ));
        }
    }
    let by_source: HashMap<&str, &str> = documents
        .iter()
        .map(|doc| (doc.source.as_str(), doc.content.as_str()))
        .collect();
    brief.evidence.retain(|item| {
        let excerpt = item.excerpt.trim();
        !excerpt.is_empty()
            && by_source
                .get(item.source.as_str())
                .is_some_and(|content| content.contains(excerpt))
    });
    brief.evidence.truncate(12);
    if brief.evidence.is_empty() {
        return Err("Contribution Brief contained no verifiable source excerpt.".into());
    }
    Ok(brief)
}

fn brief_prompt(
    context: &ProjectContext,
    documents: &[SourceDocument],
    tools: &[DetectedTool],
    issues: &[ProjectIssue],
) -> String {
    let prompt_documents: Vec<SourceDocument> = documents
        .iter()
        .map(|doc| SourceDocument {
            source: doc.source.clone(),
            content: truncate(&doc.content, MAX_PROMPT_DOCUMENT_CHARS),
        })
        .collect();
    let commands: Vec<String> = tools
        .iter()
        .flat_map(|tool| tool.commands.clone())
        .collect();
    let issue_sample: Vec<serde_json::Value> = issues.iter().take(20).map(|issue| serde_json::json!({ "number": issue.number, "title": issue.title, "labels": issue.labels, "is_pull_request": issue.is_pull_request })).collect();
    format!(
        r#"Build a Contribution Brief for an open-source project.
Use only the supplied sources. Never invent files, commands, versions, rules, or project activity.
Every evidence excerpt must be copied verbatim from the matching source content.
verification_commands may contain only strings from allowed_commands.
Put anything not established by the supplied material in unknowns.

Project: {}
Description: {}
Sources: {}
Detected tools: {}
Allowed commands: {}
Open GitHub sample: {}

Respond only with JSON matching this exact shape:
{{"project_definition":"...","contributor_entry_points":["..."],"setup_requirements":["..."],"verification_commands":["..."],"contribution_rules":["..."],"maturity_signals":["..."],"cautions":["..."],"evidence":[{{"source":"exact source path","excerpt":"exact verbatim excerpt"}}],"unknowns":["..."]}}"#,
        context.full_name.as_deref().unwrap_or(&context.id),
        context.description.as_deref().unwrap_or("[not available]"),
        serde_json::to_string(&prompt_documents).unwrap_or_default(),
        serde_json::to_string(tools).unwrap_or_default(),
        serde_json::to_string(&commands).unwrap_or_default(),
        serde_json::to_string(&issue_sample).unwrap_or_default()
    )
}

async fn fetch_github_issues(
    full_name: &str,
    project_id: &str,
) -> Result<Vec<ProjectIssue>, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{full_name}/issues");
    let response = github_request(&client, &url)
        .query(&[("state", "open"), ("per_page", "50"), ("sort", "updated")])
        .send()
        .await
        .map_err(|error| format!("Could not fetch GitHub issues: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "GitHub issue collection").await);
    }
    let rows: Vec<GithubIssueResponse> = response
        .json()
        .await
        .map_err(|error| format!("Invalid GitHub issue response: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|issue| ProjectIssue {
            github_issue_id: issue.id,
            project_id: project_id.to_string(),
            number: issue.number,
            title: issue.title,
            body: issue.body.map(|body| truncate(&body, 20_000)),
            html_url: issue.html_url,
            labels: issue.labels.into_iter().map(|label| label.name).collect(),
            state: issue.state,
            author_login: issue.user.map(|user| user.login),
            is_pull_request: issue.pull_request.is_some(),
            comments_count: issue.comments.unwrap_or(0),
            updated_at: issue.updated_at,
        })
        .collect())
}

fn load_context(state: &State<'_, DbState>, project_id: &str) -> Result<ProjectContext, String> {
    let conn = state.0.lock().map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT p.id,p.github_full_name,p.description,COALESCE(p.default_branch,w.default_branch),w.local_path,w.head_sha FROM projects p LEFT JOIN workspaces w ON w.project_id=p.id WHERE p.id=?1",
        [project_id],
        |row| Ok(ProjectContext { id: row.get(0)?, full_name: row.get(1)?, description: row.get(2)?, default_branch: row.get(3)?, workspace_path: row.get(4)?, head_sha: row.get(5)? }),
    ).map_err(|error| error.to_string())
}

fn issue_from_row(row: &Row<'_>) -> rusqlite::Result<ProjectIssue> {
    let labels: String = row.get(6)?;
    Ok(ProjectIssue {
        github_issue_id: row.get(0)?,
        project_id: row.get(1)?,
        number: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        html_url: row.get(5)?,
        labels: serde_json::from_str(&labels).unwrap_or_default(),
        state: row.get(7)?,
        author_login: row.get(8)?,
        is_pull_request: row.get::<_, i64>(9)? != 0,
        comments_count: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn load_issues(conn: &rusqlite::Connection, project_id: &str) -> Result<Vec<ProjectIssue>, String> {
    let mut statement = conn.prepare("SELECT i.github_issue_id,i.project_id,i.number,i.title,i.body,i.html_url,i.labels_json,i.state,i.author_login,i.is_pull_request,i.comments_count,i.updated_at FROM project_issues i JOIN project_snapshots s ON s.project_id=i.project_id WHERE i.project_id=?1 AND i.cached_at>=s.captured_at ORDER BY i.is_pull_request,i.updated_at DESC").map_err(|error| error.to_string())?;
    let issues = statement
        .query_map([project_id], issue_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(issues)
}

fn snapshot_from_row(row: &Row<'_>) -> rusqlite::Result<ProjectSnapshot> {
    let templates: String = row.get(5)?;
    let tools: String = row.get(6)?;
    let evidence: String = row.get(7)?;
    let brief: Option<String> = row.get(8)?;
    let errors: String = row.get(9)?;
    Ok(ProjectSnapshot {
        project_id: row.get(0)?,
        commit_sha: row.get(1)?,
        readme: row.get(2)?,
        contributing: row.get(3)?,
        code_of_conduct: row.get(4)?,
        templates: serde_json::from_str(&templates).unwrap_or_default(),
        detected_tools: serde_json::from_str(&tools).unwrap_or_default(),
        evidence: serde_json::from_str(&evidence).unwrap_or_default(),
        contribution_brief: brief.and_then(|value| serde_json::from_str(&value).ok()),
        collection_errors: serde_json::from_str(&errors).unwrap_or_default(),
        captured_at: row.get(10)?,
        generated_at: row.get(11)?,
    })
}

fn load_contribution_inner(
    state: &State<'_, DbState>,
    project_id: &str,
) -> Result<Option<ProjectContribution>, String> {
    let conn = state.0.lock().map_err(|error| error.to_string())?;
    let snapshot = conn.query_row("SELECT project_id,commit_sha,readme,contributing,code_of_conduct,templates_json,detected_tools_json,evidence_json,contribution_brief_json,collection_errors_json,strftime('%Y-%m-%dT%H:%M:%SZ',captured_at),strftime('%Y-%m-%dT%H:%M:%SZ',generated_at) FROM project_snapshots WHERE project_id=?1", [project_id], snapshot_from_row).optional().map_err(|error| error.to_string())?;
    match snapshot {
        Some(snapshot) => Ok(Some(ProjectContribution {
            snapshot,
            issues: load_issues(&conn, project_id)?,
        })),
        None => Ok(None),
    }
}

fn replace_issue_sample(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    issues: &[ProjectIssue],
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM project_issues WHERE project_id=?1 AND github_issue_id NOT IN (SELECT issue_id FROM contribution_tasks WHERE project_id=?1 AND issue_id IS NOT NULL)",
        [project_id],
    )
    .map_err(|error| error.to_string())?;
    for issue in issues {
        tx.execute("INSERT INTO project_issues (github_issue_id,project_id,number,title,body,html_url,labels_json,state,author_login,is_pull_request,comments_count,updated_at,cached_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,datetime('now')) ON CONFLICT(github_issue_id) DO UPDATE SET project_id=excluded.project_id,number=excluded.number,title=excluded.title,body=excluded.body,html_url=excluded.html_url,labels_json=excluded.labels_json,state=excluded.state,author_login=excluded.author_login,is_pull_request=excluded.is_pull_request,comments_count=excluded.comments_count,updated_at=excluded.updated_at,cached_at=datetime('now')", params![issue.github_issue_id,issue.project_id,issue.number,issue.title,issue.body,issue.html_url,serde_json::to_string(&issue.labels).map_err(|error| error.to_string())?,issue.state,issue.author_login,issue.is_pull_request as i64,issue.comments_count,issue.updated_at]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn save_analysis(
    state: &State<'_, DbState>,
    context: &ProjectContext,
    sources: &CollectedSources,
    tools: &[DetectedTool],
    brief: &ContributionBrief,
    issues: &[ProjectIssue],
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO project_snapshots (project_id,commit_sha,readme,contributing,code_of_conduct,templates_json,detected_tools_json,evidence_json,contribution_brief_json,collection_errors_json,captured_at,generated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,datetime('now'),datetime('now')) ON CONFLICT(project_id) DO UPDATE SET commit_sha=excluded.commit_sha,readme=excluded.readme,contributing=excluded.contributing,code_of_conduct=excluded.code_of_conduct,templates_json=excluded.templates_json,detected_tools_json=excluded.detected_tools_json,evidence_json=excluded.evidence_json,contribution_brief_json=excluded.contribution_brief_json,collection_errors_json=excluded.collection_errors_json,captured_at=datetime('now'),generated_at=datetime('now')",
        params![context.id, sources.commit_sha, sources.readme.as_ref().map(|doc| &doc.content), sources.contributing.as_ref().map(|doc| &doc.content), sources.code_of_conduct.as_ref().map(|doc| &doc.content), serde_json::to_string(&sources.templates).map_err(|error| error.to_string())?, serde_json::to_string(tools).map_err(|error| error.to_string())?, serde_json::to_string(&brief.evidence).map_err(|error| error.to_string())?, serde_json::to_string(brief).map_err(|error| error.to_string())?, serde_json::to_string(&sources.errors).map_err(|error| error.to_string())?],
    ).map_err(|error| error.to_string())?;
    replace_issue_sample(&tx, &context.id, issues)?;
    tx.execute(
        "UPDATE projects SET updated_at=datetime('now') WHERE id=?1",
        [&context.id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_project_contribution(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Option<ProjectContribution>, String> {
    load_contribution_inner(&state, &project_id)
}

#[tauri::command]
pub async fn analyze_project_contribution(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<ProjectContribution, String> {
    let context = load_context(&state, &project_id)?;
    let mut branch_error = None;
    let resolved_branch = if let Some(branch) = context.default_branch.clone() {
        branch
    } else if let Some(full_name) = &context.full_name {
        match fetch_default_branch(full_name).await {
            Ok(branch) => branch,
            Err(error) => {
                branch_error = Some(error);
                "main".to_string()
            }
        }
    } else {
        "main".to_string()
    };
    let mut sources = if let Some(path) = &context.workspace_path {
        let root = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| "The connected workspace is no longer accessible.".to_string())?;
        collect_local_sources(&root, context.head_sha.clone())
    } else if let Some(full_name) = &context.full_name {
        collect_remote_sources(full_name, &resolved_branch).await
    } else {
        CollectedSources {
            errors: vec![
                "No local workspace or GitHub repository is available for collection.".into(),
            ],
            ..Default::default()
        }
    };
    if let Some(error) = branch_error {
        sources.errors.push(error);
    }
    let fetched_issues = if let Some(full_name) = &context.full_name {
        match fetch_github_issues(full_name, &context.id).await {
            Ok(issues) => Some(issues),
            Err(error) => {
                sources.errors.push(error);
                None
            }
        }
    } else {
        sources
            .errors
            .push("GitHub issue collection skipped for a local-only project.".into());
        None
    };
    let cached_issues = if fetched_issues.is_none() {
        let conn = state.0.lock().map_err(|error| error.to_string())?;
        load_issues(&conn, &context.id)?
    } else {
        Vec::new()
    };
    let issues = fetched_issues.as_deref().unwrap_or(&cached_issues);
    let documents = sources.documents();
    if documents.is_empty() && !sources.errors.is_empty() {
        if let Some(mut cached) = load_contribution_inner(&state, &project_id)? {
            cached
                .snapshot
                .collection_errors
                .extend(sources.errors.clone());
            cached.snapshot.collection_errors.sort();
            cached.snapshot.collection_errors.dedup();
            return Ok(cached);
        }
    }
    let tools = detect_tools(&sources.manifests, &documents);
    let mut brief = deterministic_brief(&context, &sources, &tools, issues);
    if documents.is_empty() {
        sources.errors.push(
            "No README, contribution guide, template, or supported manifest was found.".into(),
        );
    } else if context.full_name.is_none() {
        sources
            .errors
            .push("AI brief skipped for a local-only or unverified project.".into());
    } else {
        match get_llm_settings() {
            Ok(settings) => match call_llm(
                &brief_prompt(&context, &documents, &tools, issues),
                &settings,
            )
            .await
            {
                Ok(raw) => match validate_contribution_brief(
                    &raw,
                    &documents,
                    &brief.verification_commands,
                ) {
                    Ok(validated) => brief = validated,
                    Err(error) => sources.errors.push(format!("AI brief rejected: {error}")),
                },
                Err(error) => sources
                    .errors
                    .push(format!("AI brief unavailable: {error}")),
            },
            Err(error) => sources
                .errors
                .push(format!("AI brief unavailable: {error}")),
        }
    }
    save_analysis(&state, &context, &sources, &tools, &brief, issues)?;
    load_contribution_inner(&state, &project_id)?
        .ok_or_else(|| "Saved analysis could not be loaded.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("eunha-{label}-{}-{suffix}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn cached_issue(id: i64) -> ProjectIssue {
        ProjectIssue {
            github_issue_id: id,
            project_id: "github:owner/repo".into(),
            number: id,
            title: format!("Issue {id}"),
            body: Some("Context".into()),
            html_url: format!("https://github.com/owner/repo/issues/{id}"),
            labels: vec![],
            state: "open".into(),
            author_login: None,
            is_pull_request: false,
            comments_count: 0,
            updated_at: None,
        }
    }

    #[test]
    fn issue_refresh_keeps_metadata_referenced_by_a_task() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (id,display_name) VALUES ('github:owner/repo','repo')",
            [],
        )
        .unwrap();
        for issue in [cached_issue(1), cached_issue(2)] {
            conn.execute(
                "INSERT INTO project_issues (github_issue_id,project_id,number,title,html_url,state) VALUES (?1,?2,?3,?4,?5,?6)",
                params![issue.github_issue_id,issue.project_id,issue.number,issue.title,issue.html_url,issue.state],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO contribution_tasks (id,project_id,issue_id,title) VALUES ('task:1','github:owner/repo',1,'Keep context')",
            [],
        )
        .unwrap();

        let tx = conn.transaction().unwrap();
        replace_issue_sample(&tx, "github:owner/repo", &[cached_issue(3)]).unwrap();
        tx.commit().unwrap();

        let mut statement = conn
            .prepare("SELECT github_issue_id FROM project_issues ORDER BY github_issue_id")
            .unwrap();
        let ids = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids, vec![1, 3]);
    }

    #[test]
    fn local_collection_finds_docs_templates_and_grounded_commands() {
        let root = temp_root("collect");
        fs::write(root.join("README.md"), "# Sample\nA useful project.").unwrap();
        fs::write(
            root.join("CONTRIBUTING.md"),
            "Run tests before opening a pull request.",
        )
        .unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"scripts":{"test":"vitest","lint":"eslint .","deploy":"danger"}}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join(".github/ISSUE_TEMPLATE")).unwrap();
        fs::write(
            root.join(".github/ISSUE_TEMPLATE/bug.yml"),
            "name: Bug report",
        )
        .unwrap();
        let sources = collect_local_sources(&root, Some("abc".into()));
        let documents = sources.documents();
        let tools = detect_tools(&sources.manifests, &documents);
        assert!(sources.readme.is_some());
        assert!(sources.contributing.is_some());
        assert_eq!(sources.templates.len(), 1);
        assert_eq!(tools[0].commands, vec!["npm test", "npm lint"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn workspace_reader_rejects_symlink_that_escapes_root() {
        use std::os::unix::fs::symlink;
        let root = temp_root("boundary");
        let outside = temp_root("outside");
        fs::write(outside.join("secret.md"), "must not be read").unwrap();
        symlink(outside.join("secret.md"), root.join("README.md")).unwrap();
        let error = read_file_within_root(&root, Path::new("README.md")).unwrap_err();
        assert!(error.contains("outside the workspace"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn brief_validation_rejects_invented_evidence_and_commands() {
        let documents = vec![SourceDocument {
            source: "CONTRIBUTING.md".into(),
            content: "Run cargo test before submitting.".into(),
        }];
        let raw = r#"{"project_definition":"A tool","contributor_entry_points":[],"setup_requirements":[],"verification_commands":["rm -rf /","cargo test"],"contribution_rules":[],"maturity_signals":[],"cautions":[],"evidence":[{"source":"CONTRIBUTING.md","excerpt":"Run cargo test before submitting."},{"source":"README.md","excerpt":"invented"}],"unknowns":[]}"#;
        let brief = validate_contribution_brief(raw, &documents, &["cargo test".into()]).unwrap();
        assert_eq!(brief.verification_commands, vec!["cargo test"]);
        assert_eq!(brief.evidence.len(), 1);
        assert!(brief.unknowns.iter().any(|item| item.contains("rm -rf")));
    }

    #[test]
    fn brief_validation_requires_verifiable_evidence() {
        let raw = r#"{"project_definition":"A tool","contributor_entry_points":[],"setup_requirements":[],"verification_commands":[],"contribution_rules":[],"maturity_signals":[],"cautions":[],"evidence":[{"source":"README.md","excerpt":"invented"}],"unknowns":[]}"#;
        assert!(validate_contribution_brief(raw, &[], &[]).is_err());
    }

    #[test]
    fn deterministic_brief_distinguishes_present_and_missing_contribution_guide() {
        let context = ProjectContext {
            id: "local:test".into(),
            full_name: None,
            description: Some("Test project".into()),
            default_branch: Some("main".into()),
            workspace_path: None,
            head_sha: None,
        };
        let with_guide = CollectedSources {
            contributing: Some(SourceDocument {
                source: "docs/CONTRIBUTING.md".into(),
                content: "Run checks before opening a pull request.".into(),
            }),
            ..Default::default()
        };
        let present = deterministic_brief(&context, &with_guide, &[], &[]);
        assert!(present.contribution_rules[0].contains("docs/CONTRIBUTING.md"));
        assert_eq!(present.evidence[0].source, "docs/CONTRIBUTING.md");

        let missing = deterministic_brief(&context, &CollectedSources::default(), &[], &[]);
        assert!(missing
            .cautions
            .iter()
            .any(|item| item.contains("No CONTRIBUTING")));
        assert!(missing
            .unknowns
            .iter()
            .any(|item| item.contains("GitHub issue")));
    }

    #[test]
    fn fenced_brief_json_is_unwrapped_without_losing_content() {
        let documents = vec![SourceDocument {
            source: "README.md".into(),
            content: "A grounded definition.".into(),
        }];
        let raw = "```json\n{\"project_definition\":\"A tool\",\"contributor_entry_points\":[],\"setup_requirements\":[],\"verification_commands\":[],\"contribution_rules\":[],\"maturity_signals\":[],\"cautions\":[],\"evidence\":[{\"source\":\"README.md\",\"excerpt\":\"A grounded definition.\"}],\"unknowns\":[]}\n```";
        assert!(validate_contribution_brief(raw, &documents, &[]).is_ok());
    }
}
