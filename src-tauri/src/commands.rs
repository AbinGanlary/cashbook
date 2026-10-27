use crate::server::{self, db, net, state::ServerState};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

struct HostHandle {
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
    port: u16,
}

#[derive(Default)]
pub struct AppState {
    host: Mutex<Option<HostHandle>>,
}

#[derive(Serialize, Clone)]
pub struct ServerStatusDto {
    pub running: bool,
    pub port: Option<u16>,
    pub lan_ip: Option<String>,
}

fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("cashbook_server.db"))
}

#[tauri::command]
pub async fn start_host_server(
    app: AppHandle,
    state: State<'_, AppState>,
    pin: String,
    port: u16,
) -> Result<ServerStatusDto, String> {
    if pin.trim().is_empty() {
        return Err("PIN cannot be empty".into());
    }
    if state.host.lock().unwrap().is_some() {
        return Err("Server is already running — stop it first.".into());
    }

    // Bind synchronously first so a port-in-use error is reported to the
    // caller immediately, rather than only appearing in the background task.
    let listener = server::bind(port).await?;

    let path = db_path(&app)?;
    let conn = db::init(&path).map_err(|e| e.to_string())?;
    db::set_config(&conn, "pin", &pin).map_err(|e| e.to_string())?;
    db::set_config(&conn, "port", &port.to_string()).map_err(|e| e.to_string())?;
    let server_state = ServerState::new(conn, pin);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run(listener, server_state, shutdown_rx).await {
            log::error!("Cashbook LAN server stopped: {e}");
        }
    });

    *state.host.lock().unwrap() = Some(HostHandle { shutdown_tx, port });

    Ok(ServerStatusDto { running: true, port: Some(port), lan_ip: net::primary_lan_ip() })
}

#[tauri::command]
pub fn stop_host_server(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(handle) = state.host.lock().unwrap().take() {
        let _ = handle.shutdown_tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn get_server_status(state: State<'_, AppState>) -> ServerStatusDto {
    match &*state.host.lock().unwrap() {
        Some(h) => ServerStatusDto { running: true, port: Some(h.port), lan_ip: net::primary_lan_ip() },
        None => ServerStatusDto { running: false, port: None, lan_ip: None },
    }
}

#[tauri::command]
pub fn get_lan_ip() -> Option<String> {
    net::primary_lan_ip()
}
