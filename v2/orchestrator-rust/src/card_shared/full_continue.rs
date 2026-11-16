//! A queued scene keeps its committed cast and reads the present facts.
use super::*;

pub(super) fn context(
    c: &rusqlite::Connection,
    w: &World,
    key: &str,
    actor: usize,
    prior: &Value,
) -> Result<Value> {
    let command: String = c
        .query_row(
            "SELECT command FROM card_full_plays WHERE id=?",
            [key],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    let mut command: Value = serde_json::from_str(&command).map_err(sql_error)?;
    let revealed = store::take_revealed(&mut command);
    let mut request = w.request("context", actor);
    request["action"] = command["action"].clone();
    if let Some(revealed) = revealed {
        request["revealed"] = revealed;
    }
    let mut context = super::super::narrator::context(&request)?;
    // The committed occasion owns its cast. Only present facts are refreshed.
    for key in ["speakers", "scenery", "focus", "waking", "covered"] {
        if let Some(value) = prior["context"].get(key) {
            context[key] = value.clone();
        }
    }
    let mut narrative = prior.clone();
    narrative["context"] = context;
    Ok(narrative)
}
