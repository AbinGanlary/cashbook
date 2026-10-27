mod commands;
// public so the `examples/dev_server.rs` harness can drive the real server
// code directly (verifying it against actual HTTP calls) without Tauri IPC.
pub mod server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(commands::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::start_host_server,
      commands::stop_host_server,
      commands::get_server_status,
      commands::get_lan_ip,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
