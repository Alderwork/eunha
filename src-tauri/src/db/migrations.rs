use rusqlite::{Connection, Result};

const CURRENT_SCHEMA_VERSION: u32 = 4;

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
}
