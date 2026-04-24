use rusqlite::{Connection, Result};

const CURRENT_SCHEMA_VERSION: u32 = 1;

pub fn run(conn: &Connection) -> Result<()> {
    // WAL mode MUST be set before any schema changes — enables concurrent reads+writes
    // (import task + describe task can both write without "database is locked" errors)
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    let version: u32 = conn.query_row(
        "PRAGMA user_version",
        [],
        |row| row.get(0),
    )?;

    if version >= CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

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

    conn.execute_batch(&format!("PRAGMA user_version = {};", CURRENT_SCHEMA_VERSION))?;

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
}
