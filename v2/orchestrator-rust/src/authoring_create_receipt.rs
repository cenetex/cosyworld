//! A retried Create returns its first committed pack and checks owner-ready files.
use super::{Failure, INVALID, UNAVAILABLE};
use axum::http::{HeaderMap, StatusCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use webauthn_rs::prelude::Uuid;

pub(super) fn owner(headers: &HeaderMap, owner: &str) -> Result<(), Failure> {
    let values = headers.get_all("x-authoring-owner");
    let mut values = values.iter();
    if let Some(value) = values.next() {
        if value.to_str().ok() != Some(owner) || values.next().is_some() {
            return Err((
                StatusCode::CONFLICT,
                "Open the account that started this transfer.",
                None,
            ));
        }
    }
    Ok(())
}

pub(super) fn key(headers: &HeaderMap) -> Result<Option<String>, Failure> {
    let values = headers.get_all("idempotency-key");
    let mut values = values.iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| INVALID)?;
    let parsed = Uuid::parse_str(value).map_err(|_| INVALID)?;
    if values.next().is_some() || parsed.hyphenated().to_string() != value {
        return Err(INVALID);
    }
    Ok(Some(value.into()))
}

pub(super) fn schema(c: &Connection) -> Result<(), Failure> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS authoring_assets (
        owner TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
        touched_at INTEGER NOT NULL, PRIMARY KEY(owner,sha256));
        CREATE TABLE IF NOT EXISTS authoring_creates (
        owner TEXT NOT NULL, request TEXT NOT NULL, digest TEXT NOT NULL,
        pack_id TEXT NOT NULL REFERENCES authoring_packs(id) ON DELETE CASCADE,
        receipt TEXT NOT NULL, PRIMARY KEY(owner,request));",
    )
    .map_err(|_| UNAVAILABLE)
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), canonical(&object[k])))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
        value => value.clone(),
    }
}

pub(super) fn digest(source: &Value, launch: &Value) -> String {
    let content = canonical(&json!([
        source["schemaVersion"],
        source["title"],
        source["document"],
        source["pack"],
        source["bridge"],
        source["assets"],
        source["sources"],
        launch
    ]));
    format!("{:x}", Sha256::digest(content.to_string().as_bytes()))
}

pub(super) fn previous(
    c: &Connection,
    owner: &str,
    key: Option<&str>,
    digest: &str,
) -> Result<Option<Value>, Failure> {
    let Some(key) = key else { return Ok(None) };
    let saved: Option<(String, String)> = c
        .query_row(
            "SELECT digest,receipt FROM authoring_creates WHERE owner=? AND request=?",
            params![owner, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| UNAVAILABLE)?;
    match saved {
        Some((expected, receipt)) if expected == digest => serde_json::from_str(&receipt)
            .map(Some)
            .map_err(|_| UNAVAILABLE),
        Some(_) => Err((
            StatusCode::CONFLICT,
            "Retry Create with its saved content.",
            None,
        )),
        None => Ok(None),
    }
}

pub(super) fn check_assets(c: &Connection, owner: &str, draft: &Value) -> Result<(), Failure> {
    let mut ready = c
        .prepare("SELECT size FROM authoring_assets WHERE owner=? AND sha256=?")
        .map_err(|_| UNAVAILABLE)?;
    for asset in draft["assets"].as_array().ok_or(INVALID)? {
        let size: Option<u64> = ready
            .query_row(
                params![owner, asset["sha256"].as_str().ok_or(INVALID)?],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| UNAVAILABLE)?;
        if size != asset["size"].as_f64().map(|n| n as u64) {
            return Err((
                StatusCode::CONFLICT,
                "Upload this pack's files before saving.",
                None,
            ));
        }
    }
    Ok(())
}

pub(super) fn remember(
    c: &Connection,
    owner: &str,
    key: Option<&str>,
    digest: &str,
    receipt: &Value,
) -> Result<(), Failure> {
    if let Some(key) = key {
        c.execute(
            "INSERT INTO authoring_creates(owner,request,digest,pack_id,receipt) VALUES(?,?,?,?,?)",
            params![
                owner,
                key,
                digest,
                receipt["id"].as_str().ok_or(INVALID)?,
                receipt.to_string()
            ],
        )
        .map_err(|_| UNAVAILABLE)?;
    }
    Ok(())
}
