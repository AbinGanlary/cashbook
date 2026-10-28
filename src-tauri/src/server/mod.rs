pub mod db;
pub mod net;
pub mod state;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Path, Query, Request, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use state::{AuthOutcome, ChangeEvent, ServerState};
use std::collections::HashMap;
use std::net::SocketAddr;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Largest request body accepted (the full ledger is sent as one JSON blob).
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

fn err(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn pin_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers.get("x-cashbook-pin").and_then(|v| v.to_str().ok())
}

/// Origins a browser may call this server from: the app's own webview (Tauri
/// serves it as http://tauri.localhost on Windows, tauri://localhost elsewhere)
/// and, in debug builds only, the Vite dev server. Any other web page — e.g. a
/// site open in a browser on the same network — gets no CORS access.
fn is_allowed_origin(origin: &str) -> bool {
    const APP_ORIGINS: &[&str] = &["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
    const DEV_ORIGINS: &[&str] = &["http://localhost:5173", "http://127.0.0.1:5173"];
    APP_ORIGINS.contains(&origin) || (cfg!(debug_assertions) && DEV_ORIGINS.contains(&origin))
}

fn auth_failure(outcome: AuthOutcome) -> Response {
    match outcome {
        AuthOutcome::Locked => err(StatusCode::TOO_MANY_REQUESTS, "Too many wrong PINs — try again in a few minutes"),
        _ => err(StatusCode::UNAUTHORIZED, "Invalid or missing PIN"),
    }
}

/// Runs before any /api/data handler, so a request is authenticated (and wrong
/// guesses are counted) before its body is read or parsed.
async fn require_pin(
    State(state): State<ServerState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    match state.authenticate(addr.ip(), pin_from_headers(req.headers())) {
        AuthOutcome::Allowed => next.run(req).await,
        denied => auth_failure(denied),
    }
}

async fn ping() -> impl IntoResponse {
    Json(json!({ "status": "ok", "app": "cashbook-server" }))
}

async fn get_all_data(State(state): State<ServerState>) -> Response {
    let conn = state.db();
    match db::get_all(&conn) {
        Ok(map) => Json(map).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn get_one(State(state): State<ServerState>, Path(key): Path<String>) -> Response {
    if !db::ALLOWED_KEYS.contains(&key.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Unknown data key");
    }
    let conn = state.db();
    match db::get(&conn, &key) {
        Ok(Some(raw)) => {
            let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Json(value).into_response()
        }
        Ok(None) => Json(Value::Null).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn put_one(State(state): State<ServerState>, Path(key): Path<String>, Json(value): Json<Value>) -> Response {
    if !db::ALLOWED_KEYS.contains(&key.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Unknown data key");
    }
    let raw = value.to_string();
    let write_result = {
        let conn = state.db();
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
    ws: Option<WebSocketUpgrade>,
    State(state): State<ServerState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    // Browsers attach an Origin to WebSocket handshakes and don't apply CORS to
    // them, so refuse foreign pages here (non-browser clients send no Origin).
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin.to_str().map(is_allowed_origin).unwrap_or(false) {
            return err(StatusCode::FORBIDDEN, "Origin not allowed");
        }
    }
    match state.authenticate(addr.ip(), params.get("pin").map(String::as_str)) {
        AuthOutcome::Allowed => match ws {
            Some(ws) => ws.on_upgrade(move |socket| handle_socket(socket, state)),
            None => err(StatusCode::BAD_REQUEST, "Expected a WebSocket upgrade"),
        },
        denied => auth_failure(denied),
    }
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
    // allow_private_network answers Chromium's Private Network Access preflight,
    // which WebView2 enforces when the app's webview calls a LAN IP like this —
    // safe now that only the app's own origins are allowed at all.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            origin.to_str().map(is_allowed_origin).unwrap_or(false)
        }))
        .allow_methods([Method::GET, Method::PUT, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::HeaderName::from_static("x-cashbook-pin")])
        .allow_private_network(true);

    let data = Router::new()
        .route("/api/data", get(get_all_data))
        .route("/api/data/:key", get(get_one).put(put_one))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_pin));

    Router::new()
        .route("/api/ping", get(ping))
        .route("/ws", get(ws_handler))
        .merge(data)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
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
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
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

    #[tokio::test]
    async fn repeated_wrong_pins_lock_the_address_out() {
        let (base, shutdown) = spawn_test_server("123456").await;
        let client = reqwest::Client::new();
        for _ in 0..state::MAX_FAILED_ATTEMPTS - 1 {
            let resp = client.get(format!("{base}/api/data")).header("x-cashbook-pin", "000000").send().await.unwrap();
            assert_eq!(resp.status(), 401);
        }
        let locking = client.get(format!("{base}/api/data")).header("x-cashbook-pin", "000000").send().await.unwrap();
        assert_eq!(locking.status(), 429);
        let right_pin = client.get(format!("{base}/api/data")).header("x-cashbook-pin", "123456").send().await.unwrap();
        assert_eq!(right_pin.status(), 429);
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn unauthenticated_requests_are_rejected_before_the_body_is_parsed() {
        let (base, shutdown) = spawn_test_server("123456").await;
        let client = reqwest::Client::new();
        let resp = client
            .put(format!("{base}/api/data/transactions"))
            .header("content-type", "application/json")
            .body("this is not json")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401); // not 400/422 — auth runs first
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn cors_allows_only_the_apps_own_origins() {
        let (base, shutdown) = spawn_test_server("123456").await;
        let client = reqwest::Client::new();

        let foreign = client.get(format!("{base}/api/ping")).header("origin", "https://evil.example").send().await.unwrap();
        assert!(foreign.headers().get("access-control-allow-origin").is_none());

        let own = client.get(format!("{base}/api/ping")).header("origin", "http://tauri.localhost").send().await.unwrap();
        assert_eq!(own.headers().get("access-control-allow-origin").unwrap(), "http://tauri.localhost");

        let preflight = client
            .request(reqwest::Method::OPTIONS, format!("{base}/api/data"))
            .header("origin", "http://tauri.localhost")
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "x-cashbook-pin")
            .send()
            .await
            .unwrap();
        assert!(preflight.status().is_success()); // preflight needs no PIN
        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn websocket_handshake_from_a_foreign_origin_is_refused() {
        let (base, shutdown) = spawn_test_server("123456").await;
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("{base}/ws?pin=123456"))
            .header("origin", "https://evil.example")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 403);
        let _ = shutdown.send(());
    }
}
