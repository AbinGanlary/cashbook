use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// Broadcast message pushed to every connected WebSocket client whenever a
/// key's data changes, so other PCs update live instead of polling.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ChangeEvent {
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Clone)]
pub struct ServerState {
    pub db: Arc<Mutex<Connection>>,
    pub pin: Arc<Mutex<String>>,
    pub changes: broadcast::Sender<ChangeEvent>,
}

impl ServerState {
    pub fn new(db: Connection, pin: String) -> Self {
        let (changes, _) = broadcast::channel(64);
        Self { db: Arc::new(Mutex::new(db)), pin: Arc::new(Mutex::new(pin)), changes }
    }

    pub fn check_pin(&self, candidate: &str) -> bool {
        let expected = self.pin.lock().unwrap();
        !expected.is_empty() && *expected == candidate
    }
}
