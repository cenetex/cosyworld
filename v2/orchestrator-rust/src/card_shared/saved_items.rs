// Released saves keep every item through an upgrade except the old flask's
// dose count: one flask now fills one empty lamp and returns full (#1526).
use serde_json::Value;

pub(super) fn upgraded(items: &Value) -> Value {
    let mut items = items.clone();
    if let Some(oil) = items.get_mut("oil").and_then(Value::as_object_mut) {
        oil.remove("doses");
    }
    items
}

/// The same expectation for one saved field of a game; only `items` changes.
pub(super) fn upgraded_field(game: &Value, field: &str) -> Value {
    if field == "items" {
        upgraded(&game[field])
    } else {
        game[field].clone()
    }
}

/// Willows revision 2 moves the Swede's unmoved kit (#1692): the sheet and
/// sack to the landing, the paddle and rope to the bank. A save from Willows
/// revision 1 expects these new places.
pub(super) fn willows_kit_moved(items: &mut Value) {
    for (id, was, now) in [
        ("willows-paddle", "willows-landing", "willows-bank"),
        ("willows-sheet", "willows-camp", "willows-landing"),
        ("willows-rope", "willows-camp", "willows-bank"),
        ("willows-provisions", "willows-camp", "willows-landing"),
    ] {
        if items[id]["holder"] == was {
            items[id]["holder"] = Value::from(now);
        }
    }
}
