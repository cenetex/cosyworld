use super::engine;
use serde_json::{json, Value};

/// Two rules versions agree when they reduce the same requests to the same
/// world. #1390 (the world.mjs facade split) will pass an old and a new
/// bundle here; until then both sides are the current version, proving the
/// reducer is deterministic.
fn rules_agree(a: &str, b: &str, requests: &[Value]) {
    for request in requests {
        let left = engine::reduce_version(a, request.clone()).unwrap();
        let right = engine::reduce_version(b, request.clone()).unwrap();
        assert_eq!(left, right, "rules disagree for {request}");
    }
}

#[test]
fn current_rules_agree_with_themselves() {
    rules_agree(
        engine::VERSION,
        engine::VERSION,
        &[
            json!({"op":"create"}),
            json!({"op":"create","seed":7}),
            json!({"op":"create","seed":42}),
        ],
    );
}
