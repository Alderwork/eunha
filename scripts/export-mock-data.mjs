#!/usr/bin/env node
/**
 * Export the real eunha SQLite DB → public/mock-data.json for browser preview
 * (`pnpm dev` without Tauri). The output is gitignored — it contains your real
 * library data. Re-run after the library changes:
 *
 *   node scripts/export-mock-data.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = join(homedir(), 'Library/Application Support/com.jinmu.eunha/eunha.db');
const out = join(root, 'public', 'mock-data.json');

function q(sql) {
	const stdout = execFileSync('sqlite3', ['-json', db, sql], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	}).trim();
	return stdout ? JSON.parse(stdout) : [];
}

const repos = q(`
  SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
         llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags,
         llm_generated_at, prompt_version, user_notes, user_category,
         watching, category_locked, owner_avatar_url
  FROM repos ORDER BY added_at DESC
`);

const collections = q(`
  SELECT c.id, c.name, c.description, c.icon, c.sort_order, c.is_read_later, c.created_at,
         (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS repo_count
  FROM collections c ORDER BY c.sort_order
`);

const collectionItems = q(`SELECT collection_id, repo_id FROM collection_items`);

const releases = q(`
  SELECT id, repo_id, tag_name, name, body, html_url, published_at, is_prerelease, read_at
  FROM releases ORDER BY published_at DESC LIMIT 300
`);

const feedItems = q(`
  SELECT repo_full_name, repo_description, repo_url, repo_language, repo_stars_count,
         repo_topics, starred_by, starred_at, dismissed, added_to_library
  FROM feed_items WHERE dismissed = 0 ORDER BY starred_at DESC LIMIT 200
`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
	out,
	JSON.stringify(
		{
			exported_at: new Date().toISOString(),
			repos,
			collections,
			collectionItems,
			releases,
			feedItems,
		},
		null,
		0,
	),
);
console.log(
	`mock-data.json: ${repos.length} repos, ${collections.length} collections, ${releases.length} releases, ${feedItems.length} feed items`,
);
