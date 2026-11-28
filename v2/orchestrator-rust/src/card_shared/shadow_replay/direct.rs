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
            Some(actual) if actual == reference => report.matched += 1,
            Some(_) => return Err(format!("Reducer output differs for direct fixture {name}")),
            None => report.unsupported.push(name),
        }
        Ok(reference)
    };

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
    assert_eq!(report.matched, 8);
    report.require_coverage(true)?;

    let report = verify(|version, pack, request| {
        if request["op"] == "validate" && request["world"]["schema"] == 1 {
            return Ok(None);
        }
        equal(version, pack, request)
    })?;
    assert_eq!(report.matched, 7);
    assert_eq!(report.unsupported, ["validate-malformed"]);
    assert!(report.require_coverage(false).is_ok());
    assert!(report.require_coverage(true).is_err());
    Ok(())
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
