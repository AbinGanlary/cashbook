pub mod db;
pub mod net;
pub mod state;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use state::{ChangeEvent, ServerState};
use std::collections::HashMap;
use tower_http::cors::CorsLayer;

fn err(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn pin_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers.get("x-cashbook-pin").and_then(|v| v.to_str().ok())
}

async fn ping() -> impl IntoResponse {
    Json(json!({ "status": "ok", "app": "cashbook-server" }))
}

async fn get_all_data(State(state): State<ServerState>, headers: HeaderMap) -> Response {
    match pin_from_headers(&headers) {
        Some(p) if state.check_pin(p) => {}
        _ => return err(StatusCode::UNAUTHORIZED, "Invalid or missing PIN"),
    }
    let conn = state.db.lock().unwrap();
    match db::get_all(&conn) {
        Ok(map) => Json(map).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn get_one(State(state): State<ServerState>, headers: HeaderMap, Path(key): Path<String>) -> Response {
    match pin_from_headers(&headers) {
        Some(p) if state.check_pin(p) => {}
        _ => return err(StatusCode::UNAUTHORIZED, "Invalid or missing PIN"),
    }
    if !db::ALLOWED_KEYS.contains(&key.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Unknown data key");
    }
    let conn = state.db.lock().unwrap();
    match db::get(&conn, &key) {
        Ok(Some(raw)) => {
            let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Json(value).into_response()
        }
        Ok(None) => Json(Value::Null).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn put_one(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(value): Json<Value>,
) -> Response {
    match pin_from_headers(&headers) {
        Some(p) if state.check_pin(p) => {}
        _ => return err(StatusCode::UNAUTHORIZED, "Invalid or missing PIN"),
    }
    if !db::ALLOWED_KEYS.contains(&key.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Unknown data key");
    }
    let raw = value.to_string();
    let write_result = {
        let conn = state.db.lock().unwrap();
        db::put(&conn, &key, &raw)
    };
    match write_result {
        Ok(()) => {
            // Fire-and-forget: no listeners connected is not an error.
            let _ = state.changes.send(ChangeEvent { key: key.clone(), value });
            Json(json!({ "status": "ok" })).into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let pin_ok = params.get("pin").map(|p| state.check_pin(p)).unwrap_or(false);
    if !pin_ok {
        return err(StatusCode::UNAUTHORIZED, "Invalid or missing PIN");
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: ServerState) {
    let mut rx = state.changes.subscribe();
    while let Ok(event) = rx.recv().await {
        let text = match serde_json::to_string(&event) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if socket.send(Message::Text(text)).await.is_err() {
            break; // client disconnected
        }
    }
}

pub fn router(state: ServerState) -> Router {
    Router::new()
        .route("/api/ping", get(ping))
        .route("/api/data", get(get_all_data))
        .route("/api/data/:key", get(get_one).put(put_one))
        .route("/ws", get(ws_handler))
        // permissive() covers the ordinary cross-origin case; allow_private_network
        // additionally satisfies Chromium's Private Network Access preflight, which
        // WebView2 enforces when a client's webview calls out to a LAN IP like this.
        .layer(CorsLayer::permissive().allow_private_network(true))
        .with_state(state)
}

/// Binds the listening socket synchronously, so a port-already-in-use error
/// surfaces immediately to whoever calls `start_host_server` — separated from
/// `run` below so that failure isn't silently swallowed inside a spawned task.
pub async fn bind(port: u16) -> Result<tokio::net::TcpListener, String> {
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    tokio::net::TcpListener::bind(addr).await.map_err(|e| e.to_string())
}

/// Serves on an already-bound listener until `shutdown_rx` fires. Intended to
/// be spawned on Tauri's existing async runtime via `tauri::async_runtime::spawn`.
pub async fn run(
    listener: tokio::net::TcpListener,
    state: ServerState,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let app = router(state);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_state(pin: &str) -> ServerState {
        let conn = Connection::open_in_memory().unwrap();
        db::create_schema(&conn).unwrap();
        ServerState::new(conn, pin.to_string())
    }

    async fn spawn_test_server(pin: &str) -> (String, tokio::sync::oneshot::Sender<()>) {
        let state = test_state(pin);
        let listener = bind(0).await.unwrap(); // port 0 = OS picks a free port
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            run(listener, state, rx).await.unwrap();
        });
        (format!("http://127.0.0.1:{}", addr.port()), tx)
    }

    #[tokio::test]
    async fn bind_fails_clearly_when_port_already_taken() {
        let first = bind(0).await.unwrap();
        let taken_port = first.local_addr().unwrap().port();
        let second = bind(taken_port).await;
        assert!(second.is_err());
    }

    #[tokio::test]
    async fn ping_requires_no_auth() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let resp = reqwest::get(format!("{base}/api/ping")).await.unwrap();
        assert_eq!(resp.status(), 200);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn data_endpoints_reject_missing_pin() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let client = reqwest::Client::new();
        let resp = client.get(format!("{base}/api/data/transactions")).send().await.unwrap();
        assert_eq!(resp.status(), 401);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn data_endpoints_reject_wrong_pin() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{base}/api/data/transactions"))
            .header("x-cashbook-pin", "0000")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn put_then_get_roundtrips_over_http() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let client = reqwest::Client::new();
        let body = json!([{ "id": "1", "amount": 500 }]);
        let put_resp = client
            .put(format!("{base}/api/data/transactions"))
            .header("x-cashbook-pin", "1234")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(put_resp.status(), 200);

        let get_resp = client
            .get(format!("{base}/api/data/transactions"))
            .header("x-cashbook-pin", "1234")
            .send()
            .await
            .unwrap();
        assert_eq!(get_resp.status(), 200);
        let got: Value = get_resp.json().await.unwrap();
        assert_eq!(got, body);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn unknown_key_is_rejected() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{base}/api/data/not_a_real_key"))
            .header("x-cashbook-pin", "1234")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 400);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn get_all_returns_everything_written_so_far() {
        let (base, shutdown) = spawn_test_server("1234").await;
        let client = reqwest::Client::new();
        client
            .put(format!("{base}/api/data/codes"))
            .header("x-cashbook-pin", "1234")
            .json(&json!([{ "code": "TEL01" }]))
            .send()
            .await
            .unwrap();
        let resp = client
            .get(format!("{base}/api/data"))
            .header("x-cashbook-pin", "1234")
            .send()
            .await
            .unwrap();
        let got: HashMap<String, Value> = resp.json().await.unwrap();
        assert!(got.contains_key("codes"));
        let _ = shutdown.send(());
    }
}
