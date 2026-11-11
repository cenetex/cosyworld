use serde_json::Value;

pub(super) fn toward(actions: &Value, target: &str) -> Value {
    let list = actions.as_array().expect("projected actions");
    let find = |kind: &str, to: Option<&str>| {
        list.iter()
            .find(|a| a["kind"] == kind && to.is_none_or(|to| a["target"] == to))
            .cloned()
    };
    find("move", Some(target))
        .or_else(|| find("course", Some(target)))
        .or_else(|| find("course", None))
        .or_else(|| find("wait", None))
        .expect("a play toward the target")
}
