use rusqlite::{Connection, Result};

const CURRENT_SCHEMA_VERSION: u32 = 12;

pub fn run(conn: &Connection) -> Result<()> {
    // WAL mode MUST be set before any schema changes — enables concurrent reads+writes
    // (import task + describe task can both write without "database is locked" errors)
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    let version: u32 = conn.query_row(
        "PRAGMA user_version",
        [],
        |row| row.get(0),
    )?;

    if version < 1 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS repos (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                description TEXT,
                url TEXT NOT NULL,
                language TEXT,
                stars_count INTEGER,
                topics TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                source TEXT NOT NULL DEFAULT 'starred',

                llm_summary TEXT,
                llm_what TEXT,
                llm_why TEXT,
                llm_use_case TEXT,
                llm_category TEXT,
                llm_tags TEXT,
                llm_generated_at DATETIME,
                prompt_version INTEGER,

                user_notes TEXT,
                user_category TEXT
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
                full_name,
                llm_what,
                llm_why,
                llm_use_case,
                llm_category,
                llm_tags,
                user_notes,
                content='repos',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS repos_fts_insert AFTER INSERT ON repos BEGIN
                INSERT INTO repos_fts(rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, user_notes)
                VALUES (new.rowid, new.full_name, new.llm_what, new.llm_why, new.llm_use_case, new.llm_category, new.llm_tags, new.user_notes);
            END;

            CREATE TRIGGER IF NOT EXISTS repos_fts_update AFTER UPDATE ON repos BEGIN
                INSERT INTO repos_fts(repos_fts, rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, user_notes)
                VALUES('delete', old.rowid, old.full_name, old.llm_what, old.llm_why, old.llm_use_case, old.llm_category, old.llm_tags, old.user_notes);
                INSERT INTO repos_fts(rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, user_notes)
                VALUES (new.rowid, new.full_name, new.llm_what, new.llm_why, new.llm_use_case, new.llm_category, new.llm_tags, new.user_notes);
            END;

            CREATE TRIGGER IF NOT EXISTS repos_fts_delete AFTER DELETE ON repos BEGIN
                INSERT INTO repos_fts(repos_fts, rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, user_notes)
                VALUES('delete', old.rowid, old.full_name, old.llm_what, old.llm_why, old.llm_use_case, old.llm_category, old.llm_tags, old.user_notes);
            END;
        ")?;
    }

    if version < 2 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ")?;
    }

    if version < 3 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS feed_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_full_name TEXT NOT NULL,
                repo_description TEXT,
                repo_url TEXT NOT NULL,
                repo_language TEXT,
                repo_stars_count INTEGER,
                starred_by TEXT NOT NULL,
                starred_at TEXT NOT NULL,
                fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
                dismissed INTEGER NOT NULL DEFAULT 0,
                added_to_library INTEGER NOT NULL DEFAULT 0,
                UNIQUE(repo_full_name, starred_by)
            );
            CREATE INDEX IF NOT EXISTS idx_feed_dismissed ON feed_items(dismissed);
        ")?;
    }

    if version < 4 {
        conn.execute_batch("
            ALTER TABLE repos ADD COLUMN watching INTEGER NOT NULL DEFAULT 0;
        ")?;
    }

    if version < 5 {
        conn.execute_batch("
            ALTER TABLE repos ADD COLUMN category_locked INTEGER NOT NULL DEFAULT 0;
            UPDATE repos SET category_locked = 1 WHERE user_category IS NOT NULL;
        ")?;
    }

    if version < 6 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS releases (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                tag_name TEXT NOT NULL,
                name TEXT,
                body TEXT,
                html_url TEXT NOT NULL,
                published_at TEXT NOT NULL,
                is_prerelease INTEGER NOT NULL DEFAULT 0,
                fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
                read_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_releases_repo ON releases(repo_id);
            CREATE INDEX IF NOT EXISTS idx_releases_published ON releases(published_at DESC);

            CREATE TABLE IF NOT EXISTS release_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                download_url TEXT NOT NULL,
                size_bytes INTEGER,
                content_type TEXT,
                platform TEXT,
                arch TEXT,
                file_type TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_assets_release ON release_assets(release_id);
        ")?;
    }

    if version < 7 {
        // Rebuild FTS index to include the `topics` column so curated GitHub tags are searchable.
        conn.execute_batch("
            DROP TRIGGER IF EXISTS repos_fts_insert;
            DROP TRIGGER IF EXISTS repos_fts_update;
            DROP TRIGGER IF EXISTS repos_fts_delete;
            DROP TABLE IF EXISTS repos_fts;

            CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
                full_name,
                llm_what,
                llm_why,
                llm_use_case,
                llm_category,
                llm_tags,
                topics,
                user_notes,
                content='repos',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS repos_fts_insert AFTER INSERT ON repos BEGIN
                INSERT INTO repos_fts(rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes)
                VALUES (new.rowid, new.full_name, new.llm_what, new.llm_why, new.llm_use_case, new.llm_category, new.llm_tags, new.topics, new.user_notes);
            END;

            CREATE TRIGGER IF NOT EXISTS repos_fts_update AFTER UPDATE ON repos BEGIN
                INSERT INTO repos_fts(repos_fts, rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes)
                VALUES('delete', old.rowid, old.full_name, old.llm_what, old.llm_why, old.llm_use_case, old.llm_category, old.llm_tags, old.topics, old.user_notes);
                INSERT INTO repos_fts(rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes)
                VALUES (new.rowid, new.full_name, new.llm_what, new.llm_why, new.llm_use_case, new.llm_category, new.llm_tags, new.topics, new.user_notes);
            END;

            CREATE TRIGGER IF NOT EXISTS repos_fts_delete AFTER DELETE ON repos BEGIN
                INSERT INTO repos_fts(repos_fts, rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes)
                VALUES('delete', old.rowid, old.full_name, old.llm_what, old.llm_why, old.llm_use_case, old.llm_category, old.llm_tags, old.topics, old.user_notes);
            END;

            INSERT INTO repos_fts(rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes)
            SELECT rowid, full_name, llm_what, llm_why, llm_use_case, llm_category, llm_tags, topics, user_notes FROM repos;
        ")?;
    }

    if version < 8 {
        conn.execute_batch("
            ALTER TABLE repos ADD COLUMN owner_avatar_url TEXT;
        ")?;
    }

    if version < 9 {
        conn.execute_batch("
            ALTER TABLE feed_items ADD COLUMN repo_topics TEXT;
        ")?;
    }

    if version < 10 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS tracked_users (
                login TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_synced_following_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tracked_enabled ON tracked_users(enabled);
        ")?;
    }

    if version < 11 {
        conn.execute_batch("
            ALTER TABLE repos ADD COLUMN resurface_archived INTEGER NOT NULL DEFAULT 0;

            CREATE TABLE IF NOT EXISTS digest_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                batch_date    TEXT NOT NULL,
                reason        TEXT NOT NULL,
                reason_detail TEXT,
                score         REAL,
                surfaced_at   TEXT NOT NULL DEFAULT (datetime('now')),
                action        TEXT,
                action_at     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_digest_batch ON digest_items(batch_date);
            CREATE INDEX IF NOT EXISTS idx_digest_repo  ON digest_items(repo_id);
        ")?;
    }

    if version < 12 {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_read_later INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS collection_items (
                collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                note TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (collection_id, repo_id)
            );

            CREATE INDEX IF NOT EXISTS idx_collection_items_repo ON collection_items(repo_id);

            CREATE TABLE IF NOT EXISTS repo_engagement (
                repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                event_count INTEGER NOT NULL DEFAULT 1,
                last_event_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (repo_id, event_type)
            );
        ")?;
    }

    conn.execute_batch(&format!("PRAGMA user_version = {};", CURRENT_SCHEMA_VERSION))?;

    Ok(())
}

pub fn settings_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
    .filter(|s: &String| !s.is_empty())
}

pub fn settings_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        conn
    }

    #[test]
    fn migration_runs_on_empty_db() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();

        // Verify table exists and has expected columns
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        // Run again — should not error or duplicate columns
        run(&conn).unwrap();

        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn settings_table_read_write() {
        let conn = open_test_db();
        settings_set(&conn, "llm_provider", "ollama").unwrap();
        assert_eq!(settings_get(&conn, "llm_provider"), Some("ollama".to_string()));

        settings_set(&conn, "llm_provider", "anthropic").unwrap();
        assert_eq!(settings_get(&conn, "llm_provider"), Some("anthropic".to_string()));

        assert_eq!(settings_get(&conn, "nonexistent"), None);
    }

    #[test]
    fn fts_syncs_correctly_on_update() {
        let conn = open_test_db();
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source, llm_what) VALUES ('a/b', 'a/b', 'https://github.com/a/b', 'manual', 'old text')",
            [],
        ).unwrap();

        conn.execute(
            "UPDATE repos SET llm_what = 'new text' WHERE id = 'a/b'",
            [],
        ).unwrap();

        // Old text should not match
        let old_match: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid WHERE repos_fts MATCH 'old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_match, 0);

        // New text should match exactly once (no duplicates)
        let new_match: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid WHERE repos_fts MATCH 'new'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(new_match, 1);
    }

    #[test]
    fn migration_upgrades_from_v1_to_v3() {
        let conn = Connection::open_in_memory().unwrap();
        // Bootstrap v1 schema manually — simulates a user who ran the original release
        conn.execute_batch("
            CREATE TABLE repos (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                description TEXT,
                url TEXT NOT NULL,
                language TEXT,
                stars_count INTEGER,
                topics TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                source TEXT NOT NULL DEFAULT 'starred',
                llm_summary TEXT,
                llm_what TEXT,
                llm_why TEXT,
                llm_use_case TEXT,
                llm_category TEXT,
                llm_tags TEXT,
                llm_generated_at DATETIME,
                prompt_version INTEGER,
                user_notes TEXT,
                user_category TEXT
            );
            PRAGMA user_version = 1;
        ").unwrap();

        run(&conn).unwrap();

        // v2: settings table must exist
        conn.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get::<_, i64>(0))
            .expect("settings table missing after upgrade");

        // v3: feed_items table must exist
        conn.query_row("SELECT COUNT(*) FROM feed_items", [], |r| r.get::<_, i64>(0))
            .expect("feed_items table missing after upgrade");

        // Final schema version must be current
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn migration_v10_creates_tracked_users() {
        let conn = open_test_db();

        // Insert + read round-trip exercises every column
        conn.execute(
            "INSERT INTO tracked_users (login, source) VALUES ('alice', 'following')",
            [],
        )
        .unwrap();

        let (login, source, enabled): (String, String, i64) = conn
            .query_row(
                "SELECT login, source, enabled FROM tracked_users WHERE login = 'alice'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(login, "alice");
        assert_eq!(source, "following");
        assert_eq!(enabled, 1, "enabled should default to 1");

        // Index must exist
        let idx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tracked_enabled'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 1, "idx_tracked_enabled should exist");
    }

    #[test]
    fn migration_v11_creates_digest_schema() {
        let conn = open_test_db();

        // New column is writable.
        conn.execute("UPDATE repos SET resurface_archived = 1 WHERE 1 = 0", [])
            .expect("resurface_archived column missing");

        // digest_items round-trips (FK + defaults).
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source) VALUES ('a/b','a/b','https://x','manual')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason, reason_detail, score)
             VALUES ('a/b', date('now'), 'forgotten', '7', 1.5)",
            [],
        )
        .unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM digest_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 1);

        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_digest_batch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "idx_digest_batch should exist");

        let idx2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_digest_repo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx2, 1, "idx_digest_repo should exist");
    }

    #[test]
    fn migration_v12_creates_collections_schema() {
        let conn = open_test_db();

        // collections round-trip
        conn.execute(
            "INSERT INTO collections (name, description, icon) VALUES ('My Favs', 'My favorite repos', '⭐')",
            [],
        ).unwrap();
        let (name, is_read_later): (String, i64) = conn
            .query_row("SELECT name, is_read_later FROM collections WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(name, "My Favs");
        assert_eq!(is_read_later, 0, "is_read_later should default to 0");

        // collection_items FK + cascade
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source) VALUES ('a/b','a/b','https://x','manual')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO collection_items (collection_id, repo_id) VALUES (1, 'a/b')",
            [],
        ).unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 1);

        // Cascade delete collection
        conn.execute("DELETE FROM collections WHERE id = 1", []).unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 0, "collection_items should cascade on collection delete");

        // Cascade delete repo
        conn.execute(
            "INSERT INTO collections (id, name) VALUES (2, 'Test')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO collection_items (collection_id, repo_id) VALUES (2, 'a/b')",
            [],
        ).unwrap();
        conn.execute("DELETE FROM repos WHERE id = 'a/b'", []).unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 0, "collection_items should cascade on repo delete");

        // repo_engagement round-trip
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source) VALUES ('c/d','c/d','https://y','manual')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO repo_engagement (repo_id, event_type, event_count)
             VALUES ('c/d', 'open_browser', 3)",
            [],
        ).unwrap();
        let (et, cnt): (String, i64) = conn
            .query_row(
                "SELECT event_type, event_count FROM repo_engagement WHERE repo_id = 'c/d'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(et, "open_browser");
        assert_eq!(cnt, 3);

        // Upsert
        conn.execute(
            "INSERT INTO repo_engagement (repo_id, event_type, event_count)
             VALUES ('c/d', 'open_browser', 1)
             ON CONFLICT(repo_id, event_type)
             DO UPDATE SET event_count = event_count + 1",
            [],
        ).unwrap();
        let cnt: i64 = conn
            .query_row(
                "SELECT event_count FROM repo_engagement WHERE repo_id = 'c/d' AND event_type = 'open_browser'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 4, "ON CONFLICT should increment event_count");

        // Cascade delete repo
        conn.execute("DELETE FROM repos WHERE id = 'c/d'", []).unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM repo_engagement", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 0, "repo_engagement should cascade on repo delete");
    }
}
