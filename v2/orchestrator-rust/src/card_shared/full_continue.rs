//! A quiet hand change refreshes unfinished words, never the committed play.
use super::*;

pub(super) fn hold_seq(c: &rusqlite::Connection, id: &str) -> Result<i64> {
    c.query_row("SELECT coalesce(max(seq),0) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='hold'", [id], |r| r.get(0)).map_err(sql_error)
}

pub(super) fn refresh(c: &rusqlite::Connection, id: &str, work: &Work, time: i64) -> Result<bool> {
    let seq = hold_seq(c, id)?;
    // Older jobs lack this marker; their saved scene remains compatible.
    if work.context["hold_seq"]
        .as_i64()
        .is_none_or(|old| old == seq)
    {
        return Ok(false);
    }
    let w = store::world(c, id, time)?;
    if w.game["turn"] != work.context["turn"] || w.room(work.actor)? != work.room {
        return Ok(false);
    }
    let mut narrative = context(c, &w, &work.id, work.actor, &work.context)?;
    narrative["hold_seq"] = json!(seq);
    c.execute("UPDATE card_full_plays SET status='retry',retries=retries+1,until_at=0,narrative=?,result=? WHERE id=?", params![narrative.to_string(), narrative.to_string(), work.id]).map_err(sql_error)?;
    Ok(true)
}

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
