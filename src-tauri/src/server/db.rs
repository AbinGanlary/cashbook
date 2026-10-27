use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// The only data keys the Main Cashbook syncs in this first version — mirrors
/// the localStorage keys the frontend already uses (`cashbook_<key>`), so the
/// eventual frontend swap-over (stage 3) is a straight key-for-key mapping.
pub const ALLOWED_KEYS: &[&str] = &["transactions", "bills", "brs", "codes", "settings", "prev_claims"];

pub fn init(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    create_schema(&conn)?;
    Ok(conn)
}

/// Exposed separately (rather than inlined in `init`) so tests can build an
/// in-memory `Connection` with the same schema without touching disk.
pub fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS data_blobs (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS server_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM data_blobs WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

pub fn get_all(conn: &Connection) -> rusqlite::Result<HashMap<String, Value>> {
    let mut stmt = conn.prepare("SELECT key, value FROM data_blobs")?;
    let rows = stmt.query_map([], |row| {
        let k: String = row.get(0)?;
        let v: String = row.get(1)?;
        Ok((k, v))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        map.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
    }
    Ok(map)
}

pub fn put(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO data_blobs (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
    )?;
    Ok(())
}

// Not called yet — wired up in stage 2, to prefill the Settings UI with the
// previously-configured PIN/port when Host Mode was left on across restarts.
#[allow(dead_code)]
pub fn get_config(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM server_config WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

pub fn set_config(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO server_config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn put_then_get_roundtrips() {
        let conn = mem();
        put(&conn, "transactions", "[1,2,3]").unwrap();
        assert_eq!(get(&conn, "transactions").unwrap(), Some("[1,2,3]".to_string()));
    }

    #[test]
    fn put_overwrites_existing_key() {
        let conn = mem();
        put(&conn, "settings", "{\"a\":1}").unwrap();
        put(&conn, "settings", "{\"a\":2}").unwrap();
        assert_eq!(get(&conn, "settings").unwrap(), Some("{\"a\":2}".to_string()));
    }

    #[test]
    fn missing_key_returns_none() {
        let conn = mem();
        assert_eq!(get(&conn, "nope").unwrap(), None);
    }

    #[test]
    fn get_all_returns_every_stored_key() {
        let conn = mem();
        put(&conn, "transactions", "[]").unwrap();
        put(&conn, "codes", "[]").unwrap();
        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.contains_key("transactions"));
        assert!(all.contains_key("codes"));
    }

    #[test]
    fn config_roundtrips_independently_of_data_blobs() {
        let conn = mem();
        set_config(&conn, "pin", "1234").unwrap();
        assert_eq!(get_config(&conn, "pin").unwrap(), Some("1234".to_string()));
        assert_eq!(get(&conn, "pin").unwrap(), None); // separate table, not visible via data API
    }
}
