//! The authoring-draft.mjs file format, including unfinished local drafts.
use serde_json::Value;
use std::collections::HashSet;

pub(super) const MAX_METADATA_BYTES: usize = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES: u64 = 256 * 1024 * 1024;

fn fields(value: &Value, names: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.len() == names.len() && names.iter().all(|name| v.contains_key(*name)))
}

fn string(value: &Value, max: usize) -> bool {
    value
        .as_str()
        .is_some_and(|v| v.encode_utf16().count() <= max)
}

fn size(value: &Value, max: u64) -> bool {
    value
        .as_f64()
        .is_some_and(|v| v.fract() == 0.0 && v >= 0.0 && v <= max as f64)
}

fn digest(value: &Value, length: usize) -> bool {
    value.as_str().is_some_and(|v| {
        v.len() == length
            && v.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}

fn path(value: &Value) -> bool {
    string(value, 512)
        && value.as_str().is_some_and(|v| {
            !v.chars()
                .any(|c| c <= '\u{1f}' || "\\\u{7f}:?#%".contains(c))
                && v.split('/').all(|part| !["", ".", ".."].contains(&part))
        })
}

fn asset(value: &Value) -> bool {
    if !fields(value, &["path", "mime", "sha256", "size"]) || !path(&value["path"]) {
        return false;
    }
    let mime = match value["path"]
        .as_str()
        .unwrap()
        .rsplit('.')
        .next()
        .unwrap_or("")
    {
        "png" => "image/png",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "json" => "application/json",
        "txt" => "text/plain",
        "md" => "text/markdown",
        _ => return false,
    };
    value["mime"] == mime && digest(&value["sha256"], 64) && size(&value["size"], MAX_ASSET_BYTES)
}

fn source(value: &Value) -> bool {
    if value["kind"] == "file" {
        return fields(value, &["kind", "path"]) && path(&value["path"]);
    }
    let Some((owner, repo)) = value["repo"].as_str().and_then(|v| v.split_once('/')) else {
        return false;
    };
    fields(value, &["kind", "repo", "commit", "path"])
        && value["kind"] == "github"
        && (1..=39).contains(&owner.len())
        && (1..=100).contains(&repo.len())
        && owner
            .bytes()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && owner
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        && repo
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        && ![".", ".."].contains(&repo)
        && digest(&value["commit"], 40)
        && path(&value["path"])
}

fn bounded(value: &Value) -> bool {
    let mut queue = vec![(value, 0)];
    let mut count = 0;
    while let Some((v, depth)) = queue.pop() {
        count += 1;
        if depth > 64 || count > 100_000 {
            return false;
        }
        match v {
            Value::Array(v) => queue.extend(v.iter().map(|v| (v, depth + 1))),
            Value::Object(v) => queue.extend(v.values().map(|v| (v, depth + 1))),
            _ => {}
        }
        if queue.len() + count > 100_000 {
            return false;
        }
    }
    serde_json::to_vec(value).is_ok_and(|v| v.len() <= MAX_METADATA_BYTES)
}

pub(super) fn valid(value: &Value) -> bool {
    if !bounded(value)
        || !fields(
            value,
            &[
                "schemaVersion",
                "id",
                "revision",
                "title",
                "document",
                "pack",
                "bridge",
                "assets",
                "sources",
            ],
        )
    {
        return false;
    }
    let id = &value["id"];
    let Some(assets) = value["assets"].as_array() else {
        return false;
    };
    let Some(sources) = value["sources"].as_array() else {
        return false;
    };
    value["schemaVersion"].as_f64() == Some(1.0)
        && (id.is_null()
            || (string(id, 128)
                && id.as_str().is_some_and(|v| {
                    !v.is_empty()
                        && v.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
                })))
        && size(&value["revision"], 9_007_199_254_740_991)
        && string(&value["title"], 80)
        && value["document"]
            .as_str()
            .is_some_and(|v| v.len() <= MAX_DOCUMENT_BYTES)
        && ["pack", "bridge"]
            .iter()
            .all(|k| value[k].is_null() || value[k].is_object())
        && assets.len() <= 512
        && assets.iter().all(asset)
        && assets
            .iter()
            .map(|a| a["path"].as_str().unwrap())
            .collect::<HashSet<_>>()
            .len()
            == assets.len()
        && assets
            .iter()
            .map(|a| a["size"].as_f64().unwrap() as u64)
            .sum::<u64>()
            <= MAX_TOTAL_ASSET_BYTES
        && sources.len() <= 512
        && sources.iter().all(source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn draft() -> Value {
        json!({"schemaVersion":1,"id":null,"revision":0,"title":"","document":"",
            "pack":{"future":{"kept":true}},"bridge":null,"assets":[],"sources":[]})
    }

    fn file(path: &str, mime: &str, size: u64) -> Value {
        json!({"path":path,"mime":mime,"sha256":"a".repeat(64),"size":size})
    }

    #[test]
    fn accepts_the_local_manifest_and_each_supported_media_type() {
        let mut value = draft();
        for (ext, mime) in [
            ("png", "image/png"),
            ("webp", "image/webp"),
            ("svg", "image/svg+xml"),
            ("jpg", "image/jpeg"),
            ("jpeg", "image/jpeg"),
            ("mp3", "audio/mpeg"),
            ("m4a", "audio/mp4"),
            ("ogg", "audio/ogg"),
            ("wav", "audio/wav"),
            ("json", "application/json"),
            ("txt", "text/plain"),
            ("md", "text/markdown"),
        ] {
            value["assets"] = json!([file(&format!("cover.{ext}"), mime, 0)]);
            assert!(valid(&value), "{ext}");
        }
        value["sources"] = json!([{"kind":"file","path":"book.md"},{"kind":"github","repo":"Writer/a.b","commit":"b".repeat(40),"path":"card-world.json"}]);
        value["revision"] = json!(1.0);
        assert!(valid(&value));
        value["title"] = json!("🌲".repeat(40));
        assert!(valid(&value));
        value["title"] = json!("🌲".repeat(41));
        assert!(!valid(&value));
    }

    #[test]
    fn checks_paths_sources_and_exact_file_fields() {
        for bad in [
            "/cover.png",
            "a//cover.png",
            "../cover.png",
            "a/./cover.png",
            "a\\cover.png",
            "a:cover.png",
            "a?cover.png",
            "a#cover.png",
            "a%20.png",
            "a\u{7f}.png",
        ] {
            assert!(!asset(&file(bad, "image/png", 1)), "{bad}");
        }
        assert!(path(&json!("🌲".repeat(256))));
        assert!(!path(&json!("🌲".repeat(257))));
        let mut image = file("cover.png", "image/jpeg", 1);
        assert!(!asset(&image));
        image["mime"] = json!("image/png");
        image["extra"] = json!(true);
        assert!(!asset(&image));
        for bad in [
            json!({"kind":"file","path":"book.md","extra":1}),
            json!({"kind":"github","repo":"writer/repo","commit":"a".repeat(40)}),
            json!({"kind":"github","repo":"writer/..","commit":"a".repeat(40),"path":"book.md"}),
            json!({"kind":"github","repo":"writer/repo","commit":"A".repeat(40),"path":"book.md"}),
        ] {
            assert!(!source(&bad));
        }
    }

    #[test]
    fn enforces_tree_document_record_and_byte_limits() {
        let mut value = draft();
        let mut nested = Value::Null;
        for _ in 0..63 {
            nested = json!({"next":nested});
        }
        value["pack"] = nested;
        assert!(valid(&value));
        value["pack"] = json!({"next":value["pack"]});
        assert!(!valid(&value));
        value = draft();
        value["pack"] = json!({"nodes":vec![Value::Null; 99_989]});
        assert!(valid(&value));
        value["pack"]["nodes"]
            .as_array_mut()
            .unwrap()
            .push(Value::Null);
        assert!(!valid(&value));
        value = draft();
        value["document"] = json!("x".repeat(MAX_DOCUMENT_BYTES));
        assert!(valid(&value));
        value["document"] = json!("x".repeat(MAX_DOCUMENT_BYTES + 1));
        assert!(!valid(&value));
        value = draft();
        value["sources"] = json!(vec![json!({"kind":"file","path":"book.md"}); 512]);
        assert!(valid(&value));
        value["sources"]
            .as_array_mut()
            .unwrap()
            .push(json!({"kind":"file","path":"book.md"}));
        assert!(!valid(&value));
        value = draft();
        value["assets"] = json!((0..16)
            .map(|i| file(&format!("{i}.png"), "image/png", MAX_ASSET_BYTES))
            .collect::<Vec<_>>());
        assert!(valid(&value));
        value["assets"]
            .as_array_mut()
            .unwrap()
            .push(file("more.png", "image/png", 1));
        assert!(!valid(&value));
        value = draft();
        value["pack"] = json!({"text":"x".repeat(MAX_METADATA_BYTES)});
        assert!(!valid(&value));
        assert!(!asset(&file("big.png", "image/png", MAX_ASSET_BYTES + 1)));
        value = draft();
        value["assets"] = json!((0..512)
            .map(|i| file(&format!("{i}.png"), "image/png", 0))
            .collect::<Vec<_>>());
        assert!(valid(&value));
        value["assets"]
            .as_array_mut()
            .unwrap()
            .push(file("more.png", "image/png", 0));
        assert!(!valid(&value));
        value["assets"] = json!([
            file("same.png", "image/png", 0),
            file("same.png", "image/png", 0)
        ]);
        assert!(!valid(&value));
    }
}
