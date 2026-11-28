use super::{
    authored_order::Order, opening_content, opening_crossings, opening_full_wait::visible_items,
    opening_held_items, opening_pickups::item_as_named, opening_pond_ask::lamp_trial,
    opening_roster, opening_station_quest_drop_learning::confirm_pond_ask_trial,
    opening_station_read::record_station_witness, opening_station_view::keeper_abandoned,
    pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const CLOTH: &str = "cloth";
const LAMP: &str = "lamp";
const STATION: &str = "station";
const TURN: u64 = 4;
const COMPANY_TURNS: u64 = 3;

fn gift_cut(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let actors = world["actors"].as_object()?;
    let pip = actors.get(PIP)?;
    let vale = actors.get(VALE)?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let [.., read, wait, drop] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    if !keeper_abandoned(world)
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["opening"]["met"][PIP] != 1
        || world["opening"]["met"][KEEPER] != 2
        || world["playerActorId"] != VALE
        || ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .any(|key| world[*key] != json!([VALE]))
        || world["speechVoices"][VALE] != json!([])
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || world["life"]["version"] != 3
        || world["life"]["actors"].as_object()?.values().any(|life| {
            life["attachments"]
                .as_object()
                .is_none_or(|records| !records.is_empty())
        })
        || world["motives"]["version"] != 1
        || world["motives"]["grievances"]
            .as_object()?
            .values()
            .any(|grievances| {
                grievances
                    .as_array()
                    .is_none_or(|records| !records.is_empty())
            })
        || (pip["place"] != STATION || vale["place"] != STATION)
        || pip["want"] != json!({"kind":"item","target":LAMP,"lit":true,"since":0,"refusals":1})
        || pip["heldItem"] != CLOTH
        || pip["trust"][VALE] != 0
        || vale["trust"][PIP] != 0
        || pip["lastTalk"] != 1
        || pip["xp"] != 0
        || vale["xp"] != 0
        || ["sleeping", "homeward", "level"]
            .iter()
            .any(|key| !pip[*key].is_null() || !vale[*key].is_null())
        || world["items"][CLOTH]["holder"] != PIP
        || world["items"][LAMP]["holder"] != VALE
        || world["items"][LAMP]["lit"] != false
        || world["items"][LAMP]["fuelPlace"] != STATION
        || world["items"].as_object()?.iter().any(|(id, item)| {
            (item["holder"] == PIP && id != CLOTH)
                || (item["holder"] == VALE && id != LAMP)
                || item["holder"] == CLOTH
                || item["holder"] == LAMP
        })
        || forest["people"][VALE]["values"][CLOTH] != 4
        || !forest["people"][VALE]["valueRules"][CLOTH].is_null()
        || !forest["things"][CLOTH]["valueRules"].is_null()
        || ["claims", "records", "teachesQuest"]
            .iter()
            .any(|key| !forest["things"][CLOTH][*key].is_null())
        || forest["people"][VALE]["keepsForGood"] == true
        || geo.packs().any(|pack| {
            pack["items"].get(CLOTH).is_some()
                || pack["choices"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|choice| choice["on"] == "give" && choice["subject"] == VALE)
        })
        || [read, wait, drop].iter().any(|event| {
            event["kind"] != "action"
                || event["generated"] == true
                || event["locationId"] != STATION
        })
        || read["actorId"] != VALE
        || read["verb"] != "read"
        || read["itemId"] != "keeper-log"
        || read["turn"] != 3
        || wait["actorId"] != PIP
        || wait["verb"] != "wait"
        || wait["turn"] != 3
        || !wait["sleep"].is_null()
        || !wait["guards"].is_null()
        || drop["actorId"] != VALE
        || drop["verb"] != "drop"
        || drop["turn"] != TURN
        || !drop["itemId"].is_null()
        || !drop["targetId"].is_null()
        || drop["seq"] != world["eventSeq"]
        || wait["seq"].as_u64()? != read["seq"].as_u64()?.checked_add(1)?
        || drop["seq"].as_u64()? != wait["seq"].as_u64()?.checked_add(1)?
    {
        return None;
    }
    let [ask_trial, wait_trial] = world["memories"][PIP]["learning"].as_array()?.as_slice() else {
        return None;
    };
    confirm_pond_ask_trial(world, ask_trial, 1)?;
    let mut expected = lamp_trial(world, 3, "wait", wait["text"].as_str()?)?;
    expected["seq"] = wait["seq"].clone();
    (*wait_trial == expected).then_some(())
}

pub fn settle_keeper_abandon_gift(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<Value> {
    gift_cut(&world, geo)?;
    let cast = opening_roster::known_actors(&world, geo, order, Some(STATION))?;
    if cast.len() != 3 || ![VALE, PIP, KEEPER].iter().all(|id| cast.contains(id)) {
        return None;
    }
    let items = visible_items(&world, geo, authored, STATION)?;
    let witnesses: Vec<_> = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .chain(items.iter().copied())
        .collect();
    let drop = world["log"].as_array()?.last()?;
    if drop["cast"] != json!(cast) || drop["witnesses"] != json!(witnesses) {
        return None;
    }
    let name = |id: &str| evidence.profile(id)?.get("name")?.as_str();
    let cloth = item_as_named(name(CLOTH)?);
    let text = format!("{} gives {cloth} to {}.", name(PIP)?, name(VALE)?);
    let mut trial = lamp_trial(&world, TURN, "give", &text)?;
    let hands = opening_held_items::snapshot(&world, geo)?;
    let item = &mut world["items"][CLOTH];
    item["holder"] = json!(VALE);
    let history = item["history"].as_array_mut()?;
    history.push(json!(format!("Turn {TURN}: {text}")));
    history.drain(..history.len().saturating_sub(12));
    opening_held_items::settle_from(&mut world, geo, Some(&hands))?;
    opening_crossings::no_crossing_unlocks(&world, geo)?;

    let life = world["life"]["actors"].as_object_mut()?;
    life.get_mut(VALE)?["attachments"]
        .as_object_mut()?
        .insert(CLOTH.into(), json!({"from":PIP,"turn":TURN}));
    for (actor, other) in [(PIP, VALE), (VALE, PIP)] {
        life.get_mut(actor)?["company"]
            .as_object_mut()?
            .insert(other.into(), json!(TURN + COMPANY_TURNS));
    }
    evidence.record(
        &mut world,
        &cast,
        &items,
        json!({
            "speaker":"World","text":text,"kind":"action","actorId":PIP,
            "locationId":STATION,"fromLocationId":STATION,"verb":"give","itemId":CLOTH,
            "targetId":VALE,"accepted":true,"witnesses":witnesses,
        }),
        true,
    )?;
    let seq = world["eventSeq"].as_u64()?;
    record_station_witness(&mut world["knowledge"], PIP, seq, TURN, &text)?;
    let outcome = lamp_trial(&world, TURN, "give", &text)?;
    for field in ["seq", "after", "afterConditions"] {
        trial[field] = outcome[field].clone();
    }
    trial["reward"] = json!(-5);
    world["memories"][PIP]["learning"]
        .as_array_mut()?
        .push(trial);
    Some(world)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let order = opening_roster::actor_order(request, saved)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let world = settle_keeper_abandon_gift(saved.clone(), &geo, &authored, &order, &evidence)?;
    Some(json!({"ok":true,"world":world}))
}
