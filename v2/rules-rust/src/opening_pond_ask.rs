use super::{
    authored_order::Order, initial_wants, opening_content, opening_crossings, opening_mirror_move,
    opening_pickups::item_as_named, opening_place_cards::Deck, opening_roster, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const POND: &str = "pond";
const LAMP: &str = "lamp";
const CLOTH: &str = "cloth";

fn quiet_pond(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    let moth = &world["actors"][PIP];
    let vale = &world["actors"][VALE];
    let action = world["log"].as_array()?.last()?;
    let mut want = forest["people"][PIP]["want"].as_object()?.clone();
    want.insert("since".into(), json!(0));
    want.insert("refusals".into(), json!(0));
    if world["turn"] != 1
        || world.get("began").is_some_and(|turn| turn != 0)
        || world["opening"]["crossed"] != true
        || world["opening"]["met"][PIP] != 1
        || world["playerActorId"] != VALE
        || ["heldActors", "controlledActors", "presentActors"]
            .iter()
            .any(|field| world[*field] != json!([VALE]))
        || action["actorId"] != VALE
        || action["verb"] != "move"
        || action["fromLocationId"] != "attic"
        || action["locationId"] != POND
        || action["seq"] != world["arrival"]["seq"]
        || action["seq"] != world["eventSeq"]
        || moth["place"] != POND
        || !moth["sleeping"].is_null()
        || !moth["homeward"].is_null()
        || moth["lastTalk"] != -9
        || !moth["metTurn"].is_null()
        || !moth["under"].is_null()
        || !moth["dwellUntil"].is_null()
        || world["peaceUntil"][PIP] != 0
        || moth["want"] != Value::Object(want)
        || moth["want"]["kind"] != "item"
        || moth["want"]["target"] != LAMP
        || moth["want"]["lit"] != true
        || !moth["want"]["step"].is_null()
        || moth["heldItem"] != CLOTH
        || moth["visited"] != json!([POND])
        || vale["place"] != POND
        || vale.get("want") != Some(&Value::Null)
        || !vale["under"].is_null()
        || !vale["sleeping"].is_null()
        || world["items"][LAMP]["holder"] != VALE
        || world["items"][LAMP]["lit"] != false
        || world["items"][CLOTH]["holder"] != PIP
        || world["items"].as_object()?.iter().any(|(id, item)| {
            (item["holder"] == VALE && id != LAMP)
                || (item["holder"] == PIP && id != CLOTH)
                || item["holder"] == LAMP
        })
        || world["motives"]["version"] != 1
        || [VALE, PIP].iter().any(|id| {
            !world["motives"]["grievances"][*id]
                .as_array()
                .is_some_and(Vec::is_empty)
        })
        || !world["life"]["actors"][VALE]["attachments"][LAMP].is_null()
        || !world["memories"][PIP]["learning"].is_null()
        || !world["pondLampLoan"].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || world["crossings"].as_object()?.values().any(|state| {
            ["phase", "until"]
                .iter()
                .any(|field| state.get(*field).is_some_and(|value| value != 0))
        })
        || forest["people"][PIP]["home"] != POND
        || forest["people"][PIP]["travels"] == false
        || forest["places"][POND]["sanctuary"] == true
        || !forest["people"][VALE]["grievances"].is_null()
        || ["claims", "records", "teachesQuest"]
            .iter()
            .any(|field| !forest["things"][CLOTH][*field].is_null())
        || geo.packs().any(|pack| {
            pack["items"].get(LAMP).is_some()
                || pack["items"].get(CLOTH).is_some()
                || pack["avatars"].get(PIP).is_some()
        })
        || !geo.human_present(world, VALE)
        || !geo.entity_active(world, PIP)?
        || !geo.entity_active(world, LAMP)?
    {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

fn first_trial(world: &Value, turn: u64, text: &str) -> Option<Value> {
    let want = &world["actors"][PIP]["want"];
    let intent = json!([want["kind"], want["target"]]).to_string();
    let trust = world["actors"][VALE]["trust"][PIP].as_u64()?;
    let mut nearby_items: Vec<_> = world["items"]
        .as_object()?
        .iter()
        .filter(|(id, item)| id.as_str() == LAMP || item["holder"] == VALE || item["holder"] == PIP)
        .collect();
    nearby_items.sort_unstable_by_key(|(id, _)| *id);
    let custody: Vec<_> = nearby_items
        .iter()
        .map(|(id, item)| json!([id, item["holder"], item["fuel"]]))
        .collect();
    let held = nearby_items
        .iter()
        .filter(|(_, item)| item["holder"] == PIP)
        .count();
    let met = initial_wants::root(world, LAMP)? == PIP;
    let observation = json!({"met":met, "trust":trust, "held":held, "strain":0});
    let conditions = json!([
        world["actors"][VALE]["place"],
        trust,
        [],
        [null, null],
        null,
        custody,
        world["actors"][PIP]["place"],
        intent,
    ])
    .to_string();
    Some(json!({
        "version":2, "seq":world["eventSeq"], "turn":turn,
        "goal":{"kind":"ask","target":VALE,"item":LAMP,"destination":null},
        "action":{"kind":"ask","target":VALE,"item":LAMP,"receive":null,"destination":null},
        "intent":intent, "conditions":conditions, "afterConditions":conditions,
        "before":observation, "after":observation,
        "expected":{"value":null,"samples":0,"local":0}, "reward":-1, "evidence":text,
    }))
}

pub(super) fn settle(
    world: &mut Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
    deck: &Deck<'_>,
) -> Option<()> {
    quiet_pond(world, geo)?;
    deck.settle(world, geo, None)?;
    let visited = world["actors"][VALE]["visited"].as_array_mut()?;
    if !visited.iter().any(|place| place == POND) {
        visited.push(json!(POND));
        visited.drain(..visited.len().saturating_sub(64));
    }

    let cast = opening_roster::known_actors(world, geo, order, Some(POND))?;
    if cast.len() != 2 || !cast.contains(&VALE) || !cast.contains(&PIP) {
        return None;
    }
    let items = opening_mirror_move::pond_items(world, geo, authored)?;
    let mut witnesses: Vec<_> = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .collect();
    witnesses.extend_from_slice(&items);
    let forest = &geo.files()["v2/card-game/forest.json"];
    let pip = forest["people"][PIP]["name"].as_str()?;
    let vale = forest["people"][VALE]["name"].as_str()?;
    let lamp = item_as_named(forest["things"][LAMP]["name"].as_str()?);
    let text = format!("{pip} asks {vale} for {lamp}. {vale} keeps it for now.");
    let turn = world["turn"].as_u64()?;
    world["actors"][PIP]["want"]["refusals"] = json!(1);
    world["actors"][PIP]["lastTalk"] = json!(turn);
    let detail = json!({
        "speaker":"World","kind":"action","verb":"ask","actorId":PIP,
        "locationId":POND,"fromLocationId":POND,"text":text,"itemId":LAMP,
        "targetId":VALE,"accepted":false,"reason":"wants-something-else","witnesses":witnesses,
    });
    evidence.record(world, &cast, &items, detail, true)?;
    world["memories"][PIP]["learning"] = json!([first_trial(world, turn, &text)?]);
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = opening_mirror_move::move_world(request)?;
    if before["turn"] != 0 {
        return None;
    }
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = opening_mirror_move::begin(before, &geo, &authored, &order, &evidence, carry)?;
    let deck = Deck::new(&world, &geo)?;
    settle(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
