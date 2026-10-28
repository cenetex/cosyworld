//! Cache validators and byte ranges for the public card assets.
use axum::{
    body::{Body, Bytes},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
};

const REVALIDATE: &str = "public, no-cache";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

pub(super) fn is_media(content_type: &str) -> bool {
    !content_type.starts_with("image/svg+xml")
        && ["image/", "audio/", "video/"]
            .iter()
            .any(|prefix| content_type.starts_with(prefix))
}

fn unchanged(headers: &HeaderMap, etag: &str) -> bool {
    headers.get_all(header::IF_NONE_MATCH).iter().any(|value| {
        value.to_str().is_ok_and(|value| {
            value.split(',').any(|candidate| {
                let candidate = candidate.trim();
                candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
            })
        })
    })
}

fn fresh_range(headers: &HeaderMap, etag: &str) -> bool {
    let mut values = headers.get_all(header::IF_RANGE).iter();
    match values.next() {
        None => true,
        Some(value) => values.next().is_none() && value.to_str().is_ok_and(|value| value == etag),
    }
}

fn decimal(value: &str) -> Option<usize> {
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())).then(|| {
        value.bytes().fold(0usize, |number, byte| {
            number
                .saturating_mul(10)
                .saturating_add((byte - b'0') as usize)
        })
    })
}

// None means a full reply. An invalid byte selection gets an empty 416 reply.
fn byte_range(value: &str, length: usize) -> Option<Result<(usize, usize), ()>> {
    let value = value.strip_prefix("bytes=")?;
    if value.contains(',') {
        return None;
    }
    let selection = || {
        let (start, end) = value.split_once('-')?;
        if length == 0 {
            return None;
        }
        if start.is_empty() {
            let count = decimal(end)?;
            (count > 0).then_some((length.saturating_sub(count), length - 1))
        } else {
            let start = decimal(start)?;
            let end = if end.is_empty() {
                length - 1
            } else {
                decimal(end)?.min(length - 1)
            };
            (start <= end).then_some((start, end))
        }
    };
    Some(selection().ok_or(()))
}

pub(super) fn serve(
    content_type: &'static str,
    bytes: &'static [u8],
    etag: &'static str,
    query: Option<&str>,
    method: &Method,
    request: &HeaderMap,
) -> Response {
    let media = is_media(content_type);
    let immutable = query.and_then(|value| value.strip_prefix("v="))
        == etag
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'));
    let mut response = Response::new(Body::empty());
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if immutable { IMMUTABLE } else { REVALIDATE }),
    );
    headers.insert(
        header::ETAG,
        if media {
            HeaderValue::from_static(etag)
        } else {
            format!("W/{etag}").parse().unwrap()
        },
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(super::CSP),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("x-cosyworld-card-version"),
        HeaderValue::from_static(env!("CARGO_PKG_VERSION")),
    );
    if media {
        headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    } else {
        // Compressed text keeps this cache key on both 200 and 304 replies.
        headers.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    }
    if unchanged(request, etag) {
        *response.status_mut() = StatusCode::NOT_MODIFIED;
        return response;
    }
    let selection = (media && method == Method::GET && fresh_range(request, etag))
        .then(|| {
            request
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok())
        })
        .flatten()
        .and_then(|value| byte_range(value, bytes.len()));
    let body = match selection {
        Some(Ok((start, end))) => {
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{}", bytes.len())
                    .parse()
                    .unwrap(),
            );
            Bytes::from_static(bytes).slice(start..=end)
        }
        Some(Err(())) => {
            *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes */{}", bytes.len()).parse().unwrap(),
            );
            Bytes::new()
        }
        None => Bytes::from_static(bytes),
    };
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, body.len().into());
    if method != Method::HEAD {
        *response.body_mut() = body.into();
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    const BYTES: &[u8] = b"a small shared song";
    const ETAG: &str = "\"25d8f6497cd5124fa0ebc71ced2d9ca73cdb8c6de177735ff871b6a0a4b5ed44\"";

    fn response(method: Method, query: Option<&str>, values: &[(&str, &str)]) -> Response {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.append(
                header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        serve("audio/mpeg", BYTES, ETAG, query, &method, &headers)
    }

    #[tokio::test]
    async fn content_hash_urls_keep_their_bytes_and_other_urls_revalidate() {
        let hash = ETAG.trim_matches('"');
        for (query, cache) in [
            (None, REVALIDATE),
            (Some("v=old".to_owned()), REVALIDATE),
            (Some(format!("v={hash}&v={hash}")), REVALIDATE),
            (Some(format!("v={hash}")), IMMUTABLE),
        ] {
            let result = response(Method::GET, query.as_deref(), &[]);
            assert_eq!(result.headers()[header::CACHE_CONTROL], cache);
            assert_eq!(result.headers()[header::ETAG], ETAG);
            assert_eq!(&to_bytes(result.into_body(), 100).await.unwrap()[..], BYTES);
        }
    }

    #[tokio::test]
    async fn weak_lists_and_wildcards_revalidate_before_ranges() {
        for validator in [
            ETAG.to_owned(),
            format!("W/{ETAG}"),
            format!("\"old\", W/{ETAG}"),
            "*".into(),
        ] {
            for method in [Method::GET, Method::HEAD] {
                let result = response(
                    method,
                    None,
                    &[("if-none-match", &validator), ("range", "bytes=0-2")],
                );
                assert_eq!(result.status(), StatusCode::NOT_MODIFIED);
                assert!(!result.headers().contains_key(header::CONTENT_LENGTH));
                assert!(to_bytes(result.into_body(), 100).await.unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn ranges_use_the_current_strong_validator_and_head_keeps_full_length() {
        for (validator, status, body) in [
            (ETAG.to_owned(), StatusCode::PARTIAL_CONTENT, &BYTES[..3]),
            (format!("W/{ETAG}"), StatusCode::OK, BYTES),
            ("\"older\"".into(), StatusCode::OK, BYTES),
            (
                "Wed, 21 Oct 2015 07:28:00 GMT".into(),
                StatusCode::OK,
                BYTES,
            ),
        ] {
            let result = response(
                Method::GET,
                None,
                &[("range", "bytes=0-2"), ("if-range", &validator)],
            );
            assert_eq!(result.status(), status);
            assert_eq!(&to_bytes(result.into_body(), 100).await.unwrap()[..], body);
        }
        let head = response(Method::HEAD, None, &[("range", "bytes=0-2")]);
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(
            head.headers()[header::CONTENT_LENGTH],
            BYTES.len().to_string()
        );
        assert!(to_bytes(head.into_body(), 100).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn empty_media_and_large_numbers_have_bounded_range_replies() {
        let empty = serve(
            "audio/mpeg",
            b"",
            ETAG,
            None,
            &Method::GET,
            &HeaderMap::from_iter([(header::RANGE, "bytes=0-".parse().unwrap())]),
        );
        assert_eq!(empty.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(empty.headers()[header::CONTENT_RANGE], "bytes */0");
        let result = response(
            Method::GET,
            None,
            &[("range", "bytes=-999999999999999999999999999999")],
        );
        assert_eq!(result.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(&to_bytes(result.into_body(), 100).await.unwrap()[..], BYTES);
    }

    #[test]
    fn text_validators_cover_compressed_representations_and_revalidation() {
        let headers = HeaderMap::from_iter([(header::IF_NONE_MATCH, ETAG.parse().unwrap())]);
        let result = serve(
            "text/javascript; charset=utf-8",
            BYTES,
            ETAG,
            None,
            &Method::GET,
            &headers,
        );
        assert_eq!(result.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(result.headers()[header::ETAG], format!("W/{ETAG}"));
        assert_eq!(result.headers()[header::VARY], "accept-encoding");
    }
}
