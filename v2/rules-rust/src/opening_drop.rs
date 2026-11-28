use super::{
    lamp_state,
    opening::{self, MAX_REVISION},
    opening_content, opening_crossings, opening_pickups, opening_play, opening_wait_response,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography, LampPosition,
};
use serde_json::{json, Map, Value};

const VALE: &str = "vale";
const ROOM: &str = "attic";
const LAMP: &str = "lamp";
pub(super) const DROP: &str = "drop:vale:lamp:attic";

pub(super) fn drop_world(request: &Value) -> Option<&Value> {
    let world = opening::supported_world(request)?;
    let action = &request["action"];
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || action["kind"] == "pack"
        || action.as_str().or_else(|| action["key"].as_str()) != Some(DROP)
    {
        return None;
    }
    Some(world)
}

pub(super) fn begin(
    before: &Value,
    geo: &Geography,
    evidence: &ResidentEvidence,
) -> Option<(Value, Value)> {
    opening_play::attic_state(before)?;
    let files = geo.files();
    opening_play::attic_content(files)?;
    if before["actors"][VALE]["place"] != ROOM
        || geo.packs().any(|pack| {
            pack["choices"].as_array().is_some_and(|choices| {
                choices
                    .iter()
                    .any(|choice| choice["at"] == ROOM && choice["on"] == "meet")
            })
        })
        || !geo.entity_active(before, LAMP)?
    {
        return None;
    }
    let turn = opening::unplayed_turn(before)?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    let prior_seq = before["eventSeq"].as_u64()?;
    if revision > MAX_REVISION
        || turn > MAX_REVISION
        || before["log"].as_array()?.is_empty()
        || before["log"]
            .as_array()?
            .iter()
            .any(|event| event["seq"].as_u64().is_none_or(|seq| seq > prior_seq))
    {
        return None;
    }
    let forest = &files["v2/card-game/forest.json"];
    let who = forest["people"][VALE]["name"].as_str()?;
    let item_name = opening_pickups::item_as_named(forest["things"][LAMP]["name"].as_str()?);
    let room_name = forest["places"][ROOM]["name"].as_str()?;
    let text = format!("{who} puts {item_name} in {room_name}.");
    let mut world = before.clone();
    world["turn"] = json!(turn);
    world["revision"] = json!(revision);
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("offered");
    vale.remove("guarding");
    vale.insert("heldItem".into(), Value::Null);

    let lamp = &mut world["items"][LAMP];
    lamp["holder"] = json!(ROOM);
    let history = lamp["history"].as_array_mut()?;
    history.push(json!(format!("Turn {turn}: {text}")));
    history.drain(..history.len().saturating_sub(12));
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: ROOM.into(),
            held: false,
            grounded: true,
        })
        .write(lamp);
    for life in world["life"]["actors"].as_object_mut()?.values_mut() {
        life["attachments"].as_object_mut()?.remove(LAMP);
    }

    opening_crossings::no_crossing_unlocks(&world, geo)?;
    let detail = json!({
        "speaker":"World", "text":text,"kind":"action","verb":"drop","actorId":VALE,
        "locationId":ROOM,"fromLocationId":ROOM,"itemId":LAMP,"targetId":ROOM,
        "witnesses":[VALE,LAMP],
    });
    evidence.record(&mut world, &[VALE], &[LAMP], detail, true)?;
    let event = world["log"].as_array()?.last()?.clone();
    Some((world, event))
}

pub(super) fn completed_response(
    mut world: Value,
    files: &Value,
    before_seq: u64,
    mirror: opening_play::Mirror,
) -> Option<Value> {
    let events: Vec<_> = world["log"]
        .as_array()?
        .iter()
        .filter_map(|entry| {
            entry["seq"]
                .as_u64()
                .filter(|seq| *seq > before_seq)
                .map(|_| entry.clone())
        })
        .collect();
    let first = events.first()?;
    if first["seq"].as_u64() != before_seq.checked_add(1)
        || first["actorId"] != VALE
        || first["verb"] != "drop"
        || first["itemId"] != LAMP
        || first["locationId"] != ROOM
        || events.last()?["seq"] != world["eventSeq"]
        || world["actors"][VALE]["waitSpeech"] != json!({"place":ROOM,"turn":null})
    {
        return None;
    }
    opening_wait_response::apply_vale_voice(&mut world)?;
    let mut response =
        opening_play::attic_response(opening::stored_response(world)?, files, mirror)?;
    response["events"] = json!(events);
    Some(response)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = drop_world(request)?;
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, event) = begin(before, &geo, &evidence)?;
    let memories: Map<_, _> = [VALE, ROOM, LAMP]
        .into_iter()
        .map(|id| (id.to_owned(), world["memories"][id].clone()))
        .collect();
    Some(json!({
        "ok":true, "turn":world["turn"], "revision":world["revision"],
        "event":event,"lamp":world["items"][LAMP],"heldItem":world["actors"][VALE]["heldItem"],"memories":memories,
    }))
}
