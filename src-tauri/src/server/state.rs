use rusqlite::Connection;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Wrong PINs tolerated from one address before it is locked out.
pub const MAX_FAILED_ATTEMPTS: u32 = 5;
/// How long an address stays locked out after hitting the limit.
pub const LOCKOUT: Duration = Duration::from_secs(300);
/// Stop tracking addresses once the table grows past this, dropping expired ones.
const MAX_TRACKED_ADDRESSES: usize = 1024;

/// Broadcast message pushed to every connected WebSocket client whenever a
/// key's data changes, so other PCs update live instead of polling.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ChangeEvent {
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthOutcome {
    Allowed,
    /// PIN missing or wrong.
    Denied,
    /// Too many wrong PINs from this address — rejected without even checking.
    Locked,
}

#[derive(Default)]
struct Attempts {
    failures: u32,
    locked_until: Option<Instant>,
}

#[derive(Clone)]
pub struct ServerState {
    pub db: Arc<Mutex<Connection>>,
    pub pin: Arc<Mutex<String>>,
    pub changes: broadcast::Sender<ChangeEvent>,
    attempts: Arc<Mutex<HashMap<IpAddr, Attempts>>>,
}

/// A panic while a lock was held would otherwise poison it and take the whole
/// server down on the next request; the guarded data stays usable here.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Compares without bailing out at the first differing byte, so response
/// timing doesn't reveal how much of a guessed PIN was right.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

impl ServerState {
    pub fn new(db: Connection, pin: String) -> Self {
        let (changes, _) = broadcast::channel(64);
        Self {
            db: Arc::new(Mutex::new(db)),
            pin: Arc::new(Mutex::new(pin)),
            changes,
            attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn db(&self) -> MutexGuard<'_, Connection> {
        lock(&self.db)
    }

    pub fn check_pin(&self, candidate: &str) -> bool {
        let expected = lock(&self.pin);
        !expected.is_empty() && constant_time_eq(expected.as_bytes(), candidate.as_bytes())
    }

    /// Checks a PIN on behalf of one client address, counting failures so the
    /// PIN can't be brute-forced: after `MAX_FAILED_ATTEMPTS` wrong guesses the
    /// address is rejected outright for `LOCKOUT`, correct PIN included.
    pub fn authenticate(&self, ip: IpAddr, candidate: Option<&str>) -> AuthOutcome {
        let now = Instant::now();
        let mut table = lock(&self.attempts);

        if table.len() > MAX_TRACKED_ADDRESSES {
            table.retain(|_, a| a.locked_until.map_or(false, |until| until > now));
        }

        let entry = table.entry(ip).or_default();
        match entry.locked_until {
            Some(until) if until > now => return AuthOutcome::Locked,
            Some(_) => *entry = Attempts::default(), // lockout served
            None => {}
        }

        match candidate {
            Some(pin) if self.check_pin(pin) => {
                table.remove(&ip);
                AuthOutcome::Allowed
            }
            Some(_) => {
                entry.failures += 1;
                if entry.failures >= MAX_FAILED_ATTEMPTS {
                    entry.locked_until = Some(now + LOCKOUT);
                    AuthOutcome::Locked
                } else {
                    AuthOutcome::Denied
                }
            }
            None => AuthOutcome::Denied,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(pin: &str) -> ServerState {
        ServerState::new(Connection::open_in_memory().unwrap(), pin.to_string())
    }

    fn ip(last: u8) -> IpAddr {
        IpAddr::from([192, 168, 1, last])
    }

    #[test]
    fn constant_time_eq_matches_only_identical_bytes() {
        assert!(constant_time_eq(b"123456", b"123456"));
        assert!(!constant_time_eq(b"123456", b"123457"));
        assert!(!constant_time_eq(b"123456", b"12345"));
    }

    #[test]
    fn empty_pin_never_authenticates() {
        assert!(!state("").check_pin(""));
    }

    #[test]
    fn correct_pin_is_allowed_and_wrong_or_missing_is_denied() {
        let s = state("123456");
        assert_eq!(s.authenticate(ip(1), Some("123456")), AuthOutcome::Allowed);
        assert_eq!(s.authenticate(ip(1), Some("000000")), AuthOutcome::Denied);
        assert_eq!(s.authenticate(ip(1), None), AuthOutcome::Denied);
    }

    #[test]
    fn address_is_locked_out_after_repeated_wrong_pins() {
        let s = state("123456");
        for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
            assert_eq!(s.authenticate(ip(2), Some("000000")), AuthOutcome::Denied);
        }
        assert_eq!(s.authenticate(ip(2), Some("000000")), AuthOutcome::Locked);
        // Even the right PIN is refused while locked.
        assert_eq!(s.authenticate(ip(2), Some("123456")), AuthOutcome::Locked);
    }

    #[test]
    fn lockout_is_per_address_and_success_resets_the_count() {
        let s = state("123456");
        for _ in 0..MAX_FAILED_ATTEMPTS {
            s.authenticate(ip(3), Some("000000"));
        }
        assert_eq!(s.authenticate(ip(4), Some("123456")), AuthOutcome::Allowed);

        for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
            s.authenticate(ip(5), Some("000000"));
        }
        assert_eq!(s.authenticate(ip(5), Some("123456")), AuthOutcome::Allowed);
        // The earlier near-misses no longer count against ip(5).
        for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
            assert_eq!(s.authenticate(ip(5), Some("000000")), AuthOutcome::Denied);
        }
    }
}
