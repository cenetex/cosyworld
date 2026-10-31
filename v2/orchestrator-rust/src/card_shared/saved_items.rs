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
