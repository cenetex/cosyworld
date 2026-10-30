use serde_json::Value;

/// One legal play toward `target`: its move card when offered, otherwise a
/// course card for it, otherwise the first course along the sea lanes,
/// otherwise a wait. Aboard the ship a voyage is several such plays.
/// A released version 2 ship upgrades to a version 3 voyage at the same dock.
pub(super) fn assert_upgraded_ship(current: &Value, old: &Value) {
    for (id, saved) in old["transports"].as_object().expect("saved ships") {
        let ship = &current["transports"][id];
        assert_eq!(ship["version"], 3, "{id} version");
        assert_eq!(ship["dock"], saved["dock"], "{id} dock");
        assert_eq!(ship["recall"], saved["recall"], "{id} recall");
    }
}

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
