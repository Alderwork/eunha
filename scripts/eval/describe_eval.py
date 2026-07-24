#!/usr/bin/env python3
"""
eunha LLM 묘사 품질 평가 스크립트

- 20개 AI/LLM/Agent 프로젝트를 eunha의 prompt contract와 동일하게 describe
- OpenCode Go API (OpenAI-compatible) 사용
- 결과를 JSON으로 저장
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import requests

# eunha prompt contract
CURRENT_PROMPT_VERSION = 2
VALID_CATEGORIES = [
    "CLI Tool",
    "Library",
    "Framework",
    "Service",
    "Learning Resource",
    "Template",
    "Other",
]

REPOS = [
    "anthropics/claude-code",
    "google-gemini/gemini-cli",
    "mastra-ai/mastra",
    "browserbase/stagehand",
    "danielmiessler/Fabric",
    "upstash/context7",
    "cocoindex-io/cocoindex-code",
    "tw93/Kaku",
    "raullenchai/Rapid-MLX",
    "micro/go-micro",
    "spacedriveapp/spacebot",
    "gastownhall/gastown",
    "microsoft/RD-Agent",
    "karakeep-app/karakeep",
    "brianpetro/obsidian-smart-connections",
    "nhaouari/obsidian-textgenerator-plugin",
    "PleasePrompto/notebooklm-mcp",
    "stickerdaniel/linkedin-mcp-server",
    "srbhr/Resume-Matcher",
    "Arsture/whispree",
]


def load_eunha_config():
    """Load PAT from ~/.eunha/config.toml"""
    config_path = Path.home() / ".eunha" / "config.toml"
    if not config_path.exists():
        return {}
    try:
        import tomllib
        with open(config_path, "rb") as f:
            return tomllib.load(f)
    except Exception as e:
        print(f"Warning: failed to read eunha config: {e}")
        return {}


def load_opencode_go_key():
    """Load opencode-go API key from ~/.local/share/opencode/auth.json"""
    auth_path = Path.home() / ".local" / "share" / "opencode" / "auth.json"
    if not auth_path.exists():
        return None
    try:
        with open(auth_path) as f:
            data = json.load(f)
        return data.get("opencode-go", {}).get("key")
    except Exception as e:
        print(f"Warning: failed to read opencode auth: {e}")
        return None


def load_db_settings():
    """Load settings from eunha SQLite DB"""
    db_path = Path.home() / "Library" / "Application Support" / "com.jinmu.eunha" / "eunha.db"
    if not db_path.exists():
        return {}
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM settings")
        return {k: v for k, v in cur.fetchall()}
    except Exception as e:
        print(f"Warning: failed to read eunha DB settings: {e}")
        return {}


def fetch_repo_metadata(full_name: str, pat: str):
    url = f"https://api.github.com/repos/{full_name}"
    headers = {"User-Agent": "eunha-eval/1.0", "Accept": "application/vnd.github.v3+json"}
    if pat:
        headers["Authorization"] = f"Bearer {pat}"
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return {
        "full_name": full_name,
        "description": data.get("description") or "",
        "language": data.get("language") or "",
        "topics": data.get("topics", []),
    }


def fetch_readme(full_name: str, pat: str):
    url = f"https://api.github.com/repos/{full_name}/readme"
    headers = {"User-Agent": "eunha-eval/1.0", "Accept": "application/vnd.github.v3.raw"}
    if pat:
        headers["Authorization"] = f"Bearer {pat}"
    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code == 200:
        return resp.text[:500]
    return None


def build_prompt(repo: dict, readme: str | None, output_language: str) -> str:
    topics = ", ".join(repo.get("topics", []))
    lang_instruction = (
        ""
        if output_language == "English"
        else f'\nWrite the "what", "why", and "use_case" values in {output_language}. Keep "category" and "tags" in English.'
    )
    return f"""Given this GitHub repo:
- Name: {repo['full_name']}
- GitHub description: {repo['description']}
- Language: {repo['language']}
- Topics: {topics}
- README excerpt: {readme or '[not available]'}
{lang_instruction}
Respond ONLY with valid JSON in this exact format:
{{
  "what": "One sentence: what this repo IS (max 80 chars)",
  "why": "One sentence: why a developer would care (max 80 chars)",
  "use_case": "One sentence: specific scenario (max 80 chars)",
  "category": "One of: CLI Tool | Library | Framework | Service | Learning Resource | Template | Other",
  "tags": ["tag1", "tag2"]
}}"""


def truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[:max_len]


def normalize_category(cat: str) -> str:
    return cat if cat in VALID_CATEGORIES else "Other"


def parse_llm_json(raw: str) -> dict:
    clean = raw.strip()
    clean = re.sub(r"^```json\s*", "", clean)
    clean = re.sub(r"^```\s*", "", clean)
    clean = re.sub(r"\s*```$", "", clean)
    clean = clean.strip()

    parsed = json.loads(clean)
    required = ["what", "why", "use_case", "category", "tags"]
    for field in required:
        if not parsed.get(field):
            raise ValueError(f"Missing or empty field: {field}")

    return {
        "what": truncate(parsed["what"], 80),
        "why": truncate(parsed["why"], 80),
        "use_case": truncate(parsed["use_case"], 80),
        "category": normalize_category(parsed["category"]),
        "tags": [truncate(t, 20) for t in parsed["tags"][:4]],
        "raw_json": clean,
    }


def call_opencode_go(prompt: str, api_key: str, model: str, base_url: str, repo_name: str) -> str:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "max_tokens": 4000,
    }
    resp = requests.post(endpoint, headers=headers, json=body, timeout=120)
    if resp.status_code != 200:
        raise RuntimeError(
            f"HTTP {resp.status_code}: {resp.text[:500]}"
        )
    try:
        data = resp.json()
    except Exception as e:
        raise RuntimeError(
            f"JSON parse error ({e}). Response text (first 500 chars): {resp.text[:500]}"
        )

    # Debug: save raw response
    debug_dir = Path("eval_results/raw_responses")
    debug_dir.mkdir(parents=True, exist_ok=True)
    safe_name = repo_name.replace("/", "__")
    with open(debug_dir / f"{safe_name}.json", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError(
            f"Empty content in response. Full data keys: {list(data.keys())}. "
            f"Choices[0] keys: {list(data.get('choices', [{}])[0].keys())}"
        )
    return content


def describe_repo(full_name: str, pat: str, api_key: str, model: str, base_url: str, output_language: str):
    repo = fetch_repo_metadata(full_name, pat)
    readme = fetch_readme(full_name, pat)
    prompt = build_prompt(repo, readme, output_language)

    raw = call_opencode_go(prompt, api_key, model, base_url, full_name)
    result = parse_llm_json(raw)

    return {
        "repo": full_name,
        "input": repo,
        "readme_excerpt": readme,
        "prompt": prompt,
        "llm_result": result,
        "prompt_version": CURRENT_PROMPT_VERSION,
    }


def main():
    config = load_eunha_config()
    pat = config.get("github_pat", "")
    if not pat:
        print("Error: github_pat not found in ~/.eunha/config.toml")
        sys.exit(1)

    api_key = load_opencode_go_key()
    if not api_key:
        print("Error: opencode-go API key not found in ~/.local/share/opencode/auth.json")
        sys.exit(1)

    settings = load_db_settings()
    output_language = settings.get("output_language", "English")

    model = os.environ.get("EVAL_MODEL", "deepseek-v4-flash")
    base_url = os.environ.get("EVAL_BASE_URL", "https://opencode.ai/zen/go/v1")

    print(f"Using model: {model}")
    print(f"Using base URL: {base_url}")
    print(f"Output language: {output_language}")
    print(f"Repos to describe: {len(REPOS)}")

    results = []
    failed = []
    for i, full_name in enumerate(REPOS, 1):
        print(f"\n[{i}/{len(REPOS)}] Describing {full_name}...")
        try:
            item = describe_repo(full_name, pat, api_key, model, base_url, output_language)
            results.append(item)
            print(f"  what: {item['llm_result']['what']}")
            print(f"  category: {item['llm_result']['category']}")
            print(f"  tags: {item['llm_result']['tags']}")
        except Exception as e:
            print(f"  FAILED: {e}")
            failed.append({"repo": full_name, "error": str(e)})
        # small delay to avoid rate limits
        time.sleep(0.5)

    output = {
        "model": model,
        "base_url": base_url,
        "output_language": output_language,
        "prompt_version": CURRENT_PROMPT_VERSION,
        "described": results,
        "failed": failed,
    }

    out_path = Path(os.environ.get("EVAL_OUTPUT", "eval_results/describe_v1_results.json"))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"Described: {len(results)}, Failed: {len(failed)}")
    print(f"Saved to: {out_path}")


if __name__ == "__main__":
    main()
