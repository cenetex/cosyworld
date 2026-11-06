//! A new shared world's first line uses the saved speech queue at turn zero.
use super::super::{
    full_world::{actor_id, World},
    narrator,
    store::{sql_error, Result},
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn key(id: &str, a: usize) -> String {
    format!("opening-{id}-{}", actor_id(a))
}
fn due(w: &World, a: usize) -> bool {
    w.game["turn"] == 0
        && !w.game["log"].as_array().is_some_and(|log| {
            log.iter()
                .any(|e| e["generated"] == true && e["actorId"] == actor_id(a))
        })
}
pub(super) fn enqueue(
    c: &Connection,
    id: &str,
    user: &str,
    w: &World,
    a: usize,
    now: i64,
) -> Result<()> {
    if !due(w, a) {
        return Ok(());
    }
    let key = key(id, a);
    let room = w.room(a)?;
    let mut context = narrator::context(&w.request("context", a))?;
    context["waking"] = json!(true);
    context["scenery"] = json!(false);
    context["focus"] = Value::Null;
    context["speakers"] = json!([actor_id(a)]);
    context["covered"] = json!(context["entities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| e["id"].as_str())
        .filter(|id| *id != actor_id(a))
        .collect::<Vec<_>>());
    let view = w.project(a)?;
    let scene = json!({"play":key,"actor":actor_id(a),"room":room,"turn":0,"opening":true,
        "context":context,"profiles":view["profiles"],"events":[],"lines":[],
        "starts_at":now,"until_at":now,"error":null,"browser_chat":false});
    // A prepared retry already has its committed scene. Taking it asks for
    // words without spending a game turn. Its stable key keeps one opener.
    c.execute("INSERT OR IGNORE INTO card_full_plays(id,world,actor,user,room,command,status,created,result,narrative) VALUES(?,?,?,?,?,?,'retry',?,?,?)",
        params![key,id,a,user,room,json!({"op":"opening","actor":actor_id(a)}).to_string(),now,scene.to_string(),scene.to_string()]).map_err(sql_error)?;
    Ok(())
}
pub(super) fn resume(c: &Connection, id: &str, w: &World, a: usize) -> Result<()> {
    if !due(w, a) {
        return Ok(());
    }
    // Re-entering revives an interrupted opener. The attempt counter fences
    // its old worker, and completed words remain in the journal and history.
    c.execute("UPDATE card_full_plays SET status='retry',until_at=0,retries=retries+1,result=narrative WHERE id=? AND (status='cancelled' OR (status='done' AND json_extract(result,'$.failed')=1))", [key(id,a)]).map_err(sql_error)?;
    Ok(())
}

#[cfg(test)]
#[path = "full_opening_tests.rs"]
mod tests;
