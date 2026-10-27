use std::net::UdpSocket;

/// Finds this machine's primary LAN IP by asking the OS which local address
/// it would use to route to an external host — no packets actually leave the
/// machine (UDP `connect` just resolves a route), so this works offline too
/// and needs no extra dependency or admin privileges.
pub fn primary_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_a_plausible_ipv4_or_none() {
        // CI/sandboxed machines may have no routable interface at all, so we
        // only assert the shape when a result comes back.
        if let Some(ip) = primary_lan_ip() {
            assert!(ip.split('.').count() == 4 || ip.contains(':'));
        }
    }
}
