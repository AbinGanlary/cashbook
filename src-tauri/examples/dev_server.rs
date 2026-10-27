// Standalone dev harness — starts the exact same server/db code the Tauri
// commands use, without needing the Tauri IPC layer or a native window.
// Only used to verify the real compiled server against a real browser fetch();
// not shipped, not referenced by the app.
use app_lib::server::{self, db, state::ServerState};

#[tokio::main]
async fn main() {
    let conn = rusqlite::Connection::open_in_memory().expect("open db");
    db::create_schema(&conn).expect("create schema");
    let state = ServerState::new(conn, "433247".to_string());

    let port: u16 = std::env::var("DEV_SERVER_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(4321);
    let listener = server::bind(port).await.expect("bind");
    println!("dev_server listening on 127.0.0.1:{port} pin=433247");

    let (_tx, rx) = tokio::sync::oneshot::channel();
    server::run(listener, state, rx).await.expect("serve");
}
