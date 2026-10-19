use axum::http::HeaderMap;
use std::{
    collections::{BTreeMap, VecDeque},
    fmt,
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug)]
pub(super) struct RateLimit {
    pub(super) max_hits: usize,
    pub(super) window: Duration,
}

/// Hits recorded for one key, together with the window that key is checked
/// against. One limiter holds keys with different windows (for example a
/// one-minute per-IP bucket next to a one-hour shared bucket), so pruning must
/// use each key's own window rather than the window of whichever call
/// happened to trigger the prune.
#[derive(Debug)]
struct Bucket {
    window: Duration,
    hits: VecDeque<Instant>,
}

impl Bucket {
    fn prune(&mut self, now: Instant) {
        let cutoff = now.checked_sub(self.window).unwrap_or(now);
        while self.hits.front().is_some_and(|hit| *hit <= cutoff) {
            self.hits.pop_front();
        }
    }
}

const PRUNE_THRESHOLD: usize = 4096;

#[derive(Debug, Default)]
pub(super) struct RateLimiter {
    hits: BTreeMap<String, Bucket>,
}

impl RateLimiter {
    pub(super) fn allow(&mut self, key: String, limit: RateLimit, now: Instant) -> bool {
        let bucket = self.hits.entry(key).or_insert_with(|| Bucket {
            window: limit.window,
            hits: VecDeque::new(),
        });
        bucket.window = limit.window;
        bucket.prune(now);
        if bucket.hits.len() >= limit.max_hits {
            return false;
        }
        bucket.hits.push_back(now);

        if self.hits.len() > PRUNE_THRESHOLD {
            self.hits.retain(|_, bucket| {
                bucket.prune(now);
                !bucket.hits.is_empty()
            });
        }

        true
    }
}

pub(super) const AVATAR_CREATE_LIMIT: RateLimit = RateLimit {
    max_hits: 12,
    window: Duration::from_secs(10 * 60),
};
pub(super) const CHAT_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 45,
    window: Duration::from_secs(60),
};
pub(super) const REPORT_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 12,
    window: Duration::from_secs(10 * 60),
};
pub(super) const GENERAL_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 180,
    window: Duration::from_secs(60),
};
pub(super) const PUBLIC_MUTATION_LIMIT: RateLimit = RateLimit {
    max_hits: 240,
    window: Duration::from_secs(60),
};
pub(super) const RATE_LIMITED_STATUS: u32 = 429;

pub(super) fn client_ip_key(client_addr: SocketAddr) -> String {
    client_addr.ip().to_string()
}

/// Header that Fly's edge proxy sets to the connecting client's address. The
/// proxy overwrites any client-supplied value, so it is trustworthy only when
/// every request reaches this process through that proxy.
pub(super) const FLY_CLIENT_IP_HEADER: &str = "fly-client-ip";

/// Where the per-client rate-limit identity comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ClientIpSource {
    /// Use the TCP peer address. Forwarding headers are ignored.
    SocketPeer,
    /// Behind Fly's `[http_service]` proxy every TCP peer is the proxy
    /// itself, so use the proxy-set `Fly-Client-IP` header instead.
    FlyProxy,
}

impl ClientIpSource {
    /// Fly sets `FLY_APP_NAME` on every machine it runs. Anywhere else the
    /// socket peer is the client, and a forwarding header could be forged.
    pub(super) fn from_env() -> Self {
        Self::from_fly_app_name(std::env::var("FLY_APP_NAME").ok().as_deref())
    }

    fn from_fly_app_name(fly_app_name: Option<&str>) -> Self {
        if fly_app_name.is_some_and(|name| !name.trim().is_empty()) {
            Self::FlyProxy
        } else {
            Self::SocketPeer
        }
    }
}

/// Derive the client address used for per-IP rate limits. `X-Forwarded-For`
/// and similar headers are never consulted because any client can set them.
/// `Fly-Client-IP` is used only when running on Fly; a missing, duplicated or
/// malformed value falls back to the socket peer (the shared proxy bucket), so
/// a client cannot pick an arbitrary bucket for itself.
pub(super) fn client_addr(
    peer: SocketAddr,
    headers: &HeaderMap,
    source: ClientIpSource,
) -> SocketAddr {
    if source == ClientIpSource::SocketPeer {
        return peer;
    }
    let mut values = headers.get_all(FLY_CLIENT_IP_HEADER).iter();
    let (Some(value), None) = (values.next(), values.next()) else {
        return peer;
    };
    value
        .to_str()
        .ok()
        .and_then(|value| value.trim().parse::<IpAddr>().ok())
        .map(|ip| SocketAddr::new(ip, peer.port()))
        .unwrap_or(peer)
}

pub(super) fn rate_limit_key(scope: &str, subject: impl fmt::Display) -> String {
    format!("{scope}:{subject}")
}

pub(super) const WALLET_AUTH_LIMIT: RateLimit = RateLimit {
    max_hits: 30,
    window: Duration::from_secs(60),
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_each_key_by_its_own_window() {
        let mut limiter = RateLimiter::default();
        let minute = RateLimit {
            max_hits: 30,
            window: Duration::from_secs(60),
        };
        let hour = RateLimit {
            max_hits: 1200,
            window: Duration::from_secs(3600),
        };
        let start = Instant::now();
        for second in 0..1200u64 {
            assert!(limiter.allow(
                "shared-hour".to_string(),
                hour,
                start + Duration::from_secs(second * 2)
            ));
        }
        // Enough one-minute keys to force a prune while the hour bucket is
        // still full. A prune using the caller's one-minute window would cut
        // the hour bucket down to its last minute of hits.
        let later = start + Duration::from_secs(2400);
        for client in 0..(PRUNE_THRESHOLD + 10) {
            assert!(limiter.allow(format!("ip:{client}"), minute, later));
        }
        assert_eq!(limiter.hits["shared-hour"].hits.len(), 1200);
        assert!(!limiter.allow("shared-hour".to_string(), hour, later));

        // Expired one-minute keys are still dropped by their own window.
        let after_minute = later + Duration::from_secs(61);
        for client in 0..(PRUNE_THRESHOLD + 1) {
            assert!(limiter.allow(format!("fresh:{client}"), minute, after_minute));
        }
        assert!(!limiter.hits.contains_key("ip:0"));
        assert_eq!(limiter.hits["shared-hour"].hits.len(), 1200);
    }

    fn headers(values: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.append(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        headers
    }

    #[test]
    fn client_ip_source_follows_fly_runtime() {
        assert_eq!(
            ClientIpSource::from_fly_app_name(None),
            ClientIpSource::SocketPeer
        );
        assert_eq!(
            ClientIpSource::from_fly_app_name(Some("  ")),
            ClientIpSource::SocketPeer
        );
        assert_eq!(
            ClientIpSource::from_fly_app_name(Some("cosyworld")),
            ClientIpSource::FlyProxy
        );
    }

    #[test]
    fn derives_client_ip_from_fly_header_only_on_fly() {
        let peer: SocketAddr = "172.16.3.4:51234".parse().unwrap();
        let fly = headers(&[("fly-client-ip", "203.0.113.9")]);
        assert_eq!(
            client_addr(peer, &fly, ClientIpSource::FlyProxy),
            "203.0.113.9:51234".parse::<SocketAddr>().unwrap()
        );
        let v6 = headers(&[("fly-client-ip", " 2001:db8::7 ")]);
        assert_eq!(
            client_addr(peer, &v6, ClientIpSource::FlyProxy).ip(),
            "2001:db8::7".parse::<IpAddr>().unwrap()
        );
        // Off Fly a client could send the header itself, so it is ignored.
        assert_eq!(client_addr(peer, &fly, ClientIpSource::SocketPeer), peer);
    }

    #[test]
    fn spoofed_forwarding_headers_do_not_change_the_client_ip() {
        let peer: SocketAddr = "198.51.100.20:4000".parse().unwrap();
        let spoof = headers(&[
            ("x-forwarded-for", "1.2.3.4"),
            ("x-real-ip", "1.2.3.5"),
            ("forwarded", "for=1.2.3.6"),
        ]);
        for source in [ClientIpSource::SocketPeer, ClientIpSource::FlyProxy] {
            assert_eq!(client_addr(peer, &spoof, source), peer);
        }
        for bad in [
            headers(&[("fly-client-ip", "not-an-ip")]),
            headers(&[("fly-client-ip", "1.2.3.4, 5.6.7.8")]),
            headers(&[("fly-client-ip", "1.2.3.4"), ("fly-client-ip", "5.6.7.8")]),
        ] {
            assert_eq!(client_addr(peer, &bad, ClientIpSource::FlyProxy), peer);
        }
    }

    #[test]
    fn blocks_until_the_window_expires() {
        let mut limiter = RateLimiter::default();
        let limit = RateLimit {
            max_hits: 2,
            window: Duration::from_secs(10),
        };
        let now = Instant::now();

        assert!(limiter.allow("actor:5000".to_string(), limit, now));
        assert!(limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(1)
        ));
        assert!(!limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(2)
        ));
        assert!(limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(11)
        ));
        assert!(limiter.allow(
            "actor:5001".to_string(),
            limit,
            now + Duration::from_secs(2)
        ));
    }
}
