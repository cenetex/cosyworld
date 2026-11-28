use super::{
    lamp_state, opening, opening_content, opening_crossings, opening_drop, opening_play,
    opening_play::Mirror, opening_view, pack_state::Catalog, resident_evidence::ResidentEvidence,
    Geography, LampPosition,
};
use serde_json::{json, Map, Value};

const VALE: &str = "vale";
const ROOM: &str = "attic";
const LAMP: &str = "lamp";
const CLOSES: &str = "The attic mirror's path to the pond closes.";

pub(super) fn settle(
    before: &Value,
    world: &mut Value,
    geo: &Geography,
    evidence: &ResidentEvidence,
) -> Option<Mirror> {
    let files = geo.files();
    opening_play::attic_state(before)?;
    opening_play::quiet_attic_scene(world)?;
    opening_play::attic_content(files)?;
    let turn = opening::unplayed_turn(before)?.checked_add(1)?;
    let drop_seq = before["eventSeq"].as_u64()?.checked_add(1)?;
    let lamp = &world["items"][LAMP];
    let vale = &world["actors"][VALE];
    if world["turn"] != turn
        || before["actors"][VALE]["place"] != ROOM
        || vale["place"] != ROOM
        || vale.get("heldItem") != Some(&Value::Null)
        || lamp["holder"] != ROOM
        || !world["placeCard"][ROOM].is_null()
        || before["crossings"] != world["crossings"]
        || opening_view::other_attic_content(files)?
        || !geo.entity_active(world, LAMP)?
    {
        return None;
    }
    let mut expected = Value::Object(Map::new());
    lamp_state(&before["items"][LAMP])
        .ok()?
        .settle(LampPosition {
            place: ROOM.into(),
            held: false,
            grounded: true,
        })
        .write(&mut expected);
    if expected
        .as_object()?
        .iter()
        .any(|(key, value)| lamp.get(key) != Some(value))
    {
        return None;
    }
    let log = world["log"].as_array()?;
    let drop = log.iter().find(|entry| entry["seq"] == drop_seq)?;
    if drop["turn"] != turn
        || drop["actorId"] != VALE
        || drop["verb"] != "drop"
        || drop["itemId"] != LAMP
        || drop["locationId"] != ROOM
        || log.iter().any(|entry| {
            entry["text"] == CLOSES && entry["seq"].as_u64().is_some_and(|seq| seq >= drop_seq)
        })
    {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)?;
    opening_crossings::no_attic_crossing_narration(before, world, geo)?;
    let route = files["v2/card-game/forest.json"]["reflectionRoutes"]
        .as_array()?
        .iter()
        .find(|route| route["from"] == ROOM)?;
    let was_open = geo.reflection_open(before, route)?;
    let open = geo.reflection_open(world, route)?;
    let quest = vale.get("want")?;
    let accepted = *quest == opening_play::pond_quest(before);
    if (!quest.is_null() && (!accepted || open)) || (open && !was_open) {
        return None;
    }
    if was_open && !open {
        evidence.narrate(world, &[VALE], &[LAMP], ROOM, CLOSES)?;
    }
    if open {
        Some(Mirror::Open {
            pond_available: geo.entity_active(world, "pond")?,
        })
    } else {
        Some(Mirror::Shut {
            quest_accepted: accepted,
        })
    }
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = opening_drop::drop_world(request)?;
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = request.get("afterDrop")?.clone();
    let previous = world["eventSeq"].as_u64()?;
    let mirror = settle(before, &mut world, &geo, &evidence)?;
    let narration = if world["eventSeq"] != previous {
        world["log"].as_array()?.last()?.clone()
    } else {
        Value::Null
    };
    let response = opening_play::attic_response(opening::stored_response(world)?, &files, mirror)?;
    let world = &response["world"];
    let memories: Map<_, _> = [VALE, ROOM, LAMP]
        .into_iter()
        .map(|id| (id.to_owned(), world["memories"][id].clone()))
        .collect();
    Some(json!({
        "ok":true, "narration":narration, "eventSeq":world["eventSeq"], "log":world["log"],
        "exits":response["exits"], "actions":response["actions"], "crossings":world["crossings"],
        "memories":memories,
    }))
}
