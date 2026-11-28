use super::{content, engine, Result};
use serde_json::{json, Value};

#[derive(Debug, Default)]
pub(super) struct Report {
    pub(super) matched: usize,
    pub(super) unsupported: Vec<&'static str>,
}

impl Report {
    pub(super) fn require_coverage(&self, full: bool) -> Result<()> {
        if full && !self.unsupported.is_empty() {
            return Err("The candidate must match every direct fixture for cutover.".into());
        }
        Ok(())
    }
}

fn without_save_stack<'a>(message: &'a str, caller: &str) -> &'a str {
    let Some((primary, stack)) = message
        .strip_suffix(')')
        .and_then(|message| message.split_once(" ("))
    else {
        return message;
    };
    let first = match primary {
        "This save needs a fresh start." => "upgradeSave",
        "This save needs a fresh start. Your previous save is kept until you choose New game." => {
            "validateWorld"
        }
        _ => return message,
    };
    let mut frames = stack.split(" < ");
    let recognized = [first, "decodeSave", caller, "dispatchShared"]
        .into_iter()
        .all(|name| {
            frames
                .next()
                .and_then(|frame| frame.split_once(':'))
                .is_some_and(|(candidate, line)| {
                    candidate == name
                        && line.bytes().all(|byte| byte.is_ascii_digit())
                        && line.parse::<u32>().is_ok_and(|line| line > 0)
                })
        });
    if recognized && frames.next().is_none() {
        primary
    } else {
        message
    }
}

fn same_reply(request: &Value, actual: &Value, reference: &Value) -> bool {
    if actual == reference {
        return true;
    }
    let caller = match request["op"].as_str() {
        Some("validate") => "load",
        Some("create") if !request["save"].is_null() => "importClientSave",
        _ => return false,
    };
    if actual["ok"] != false || reference["ok"] != false {
        return false;
    }
    let (Some(actual), Some(reference)) = (actual.as_object(), reference.as_object()) else {
        return false;
    };
    actual.len() == reference.len()
        && actual.iter().all(|(field, actual)| {
            let reference = reference.get(field);
            if field == "error" {
                let actual = actual
                    .as_str()
                    .map(|message| without_save_stack(message, caller));
                let reference = reference
                    .and_then(Value::as_str)
                    .map(|message| without_save_stack(message, caller));
                actual.is_some() && actual == reference
            } else {
                Some(actual) == reference
            }
        })
}

pub(super) fn verify(
    mut candidate: impl FnMut(&str, Option<&str>, &Value) -> Result<Option<Value>>,
) -> Result<Report> {
    let version = engine::version();
    let pack = Some(content::current());
    let mut report = Report::default();
    let mut check = |name, request: Value, accepted| {
        let reference = engine::reduce_pack_envelope(version, pack, request.clone())
            .map_err(|_| format!("QuickJS failed for direct fixture {name}"))?;
        if reference["ok"].as_bool() != Some(accepted) {
            return Err(format!(
                "Unexpected QuickJS outcome for direct fixture {name}"
            ));
        }
        match candidate(version, pack, &request)
            .map_err(|_| format!("Candidate failed for direct fixture {name}"))?
        {
            Some(actual) if same_reply(&request, &actual, &reference) => report.matched += 1,
            Some(_) => return Err(format!("Reducer output differs for direct fixture {name}")),
            None => report.unsupported.push(name),
        }
        Ok(reference)
    };

    check(
        "create-fresh-unseeded",
        json!({"op":"create","save":null}),
        true,
    )?;
    let _unseeded = check(
        "create-fresh-unseeded-history",
        json!({"op":"create","save":null,"history":true}),
        true,
    )?;
    let fresh = check(
        "create-fresh",
        json!({"op":"create","save":null,"seed":4242,"history":true}),
        true,
    )?;
    let world = &fresh["world"];
    check(
        "create-import",
        json!({"op":"create","save":world.to_string(),"seed":4321}),
        true,
    )?;
    check(
        "create-import-retired",
        json!({"op":"create","save":"{\"schema\":7}","seed":4321}),
        false,
    )?;
    let request = |op| {
        json!({
            "op":op, "world":world, "actor":"vale", "claimed":["vale"], "present":["vale"]
        })
    };
    check("view-claimed", request("view"), true)?;
    check("validate-current", request("validate"), true)?;
    let mut invalid = request("validate");
    invalid["world"] = json!({"schema":1});
    check("validate-malformed", invalid, false)?;
    let mut empty = request("validate");
    empty["world"] = json!({"schema":8});
    check("validate-empty-current", empty, false)?;

    let mut unavailable = request("play");
    unavailable["action"] = json!("unknown-card");
    check("play-unavailable", unavailable.clone(), false)?;
    let mut stale = unavailable.clone();
    stale["revision"] = json!(-1);
    check("play-stale", stale, false)?;
    unavailable["present"] = json!([]);
    check("play-absent", unavailable, false)?;
    Ok(report)
}

#[test]
fn requires_each_fixture_in_full_coverage_mode() -> Result<()> {
    let equal = |version: &str, pack: Option<&str>, request: &Value| {
        engine::reduce_pack_envelope(version, pack, request.clone()).map(Some)
    };
    let report = verify(equal)?;
    assert_eq!(report.matched, 12);
    report.require_coverage(true)?;

    let report = verify(|version, pack, request| {
        if request["op"] == "validate" && request["world"]["schema"] == 1 {
            return Ok(None);
        }
        equal(version, pack, request)
    })?;
    assert_eq!(report.matched, 11);
    assert_eq!(report.unsupported, ["validate-malformed"]);
    assert!(report.require_coverage(false).is_ok());
    assert!(report.require_coverage(true).is_err());
    Ok(())
}

#[test]
fn validates_only_recognized_save_diagnostics_as_the_same_refusal() {
    let request = json!({"op":"validate"});
    let bare = json!({"ok":false,"error":"This save needs a fresh start."});
    let traced = json!({
        "ok":false,
        "error":"This save needs a fresh start. (upgradeSave:1 < decodeSave:2 < load:3 < dispatchShared:4)"
    });
    assert!(same_reply(&request, &bare, &traced));
    assert!(same_reply(&request, &traced, &bare));
    assert!(!same_reply(&json!({"op":"play"}), &bare, &traced));
    let import = json!({"op":"create","save":"{\"schema\":7}"});
    let import_trace = json!({
        "ok":false,
        "error":"This save needs a fresh start. (upgradeSave:1 < decodeSave:2 < importClientSave:3 < dispatchShared:4)"
    });
    assert!(same_reply(&import, &bare, &import_trace));
    assert!(!same_reply(&import, &bare, &traced));
    assert!(!same_reply(&request, &bare, &import_trace));
    for error in [
        "This save needs a fresh start. (unknown)",
        "This save needs a fresh start. (decline:1 < decodeSave:2 < load:3 < dispatchShared:4)",
        "This save needs a fresh start. (upgradeSave:1 < decodeSave:zero < load:3 < dispatchShared:4)",
        "This save is corrupt. (upgradeSave:1 < decodeSave:2 < load:3 < dispatchShared:4)",
    ] {
        assert!(!same_reply(&request, &bare, &json!({"ok":false,"error":error})));
    }
    let mut extra = traced.clone();
    extra["world"] = json!({"revision":1});
    assert!(!same_reply(&request, &bare, &extra));
    let mut different = bare.clone();
    different["world"] = json!({"revision":2});
    assert!(!same_reply(&request, &different, &extra));
}

#[test]
fn compares_the_full_refusal_envelope() -> Result<()> {
    let error = verify(|version, pack, request| {
        let mut reply = engine::reduce_pack_envelope(version, pack, request.clone())?;
        if request["op"] == "play" {
            assert_eq!(reply["ok"], false);
            reply["world"]["revision"] = json!(999);
        }
        Ok(Some(reply))
    })
    .unwrap_err();
    assert_eq!(
        error,
        "Reducer output differs for direct fixture play-unavailable"
    );
    Ok(())
}
