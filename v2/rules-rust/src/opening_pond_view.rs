use super::{
    lamp_state, opening, opening_content, opening_pickups::item_as_named, opening_view,
    opening_wait_response::ordinary_attic_wait, pack_state::Catalog, profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const PIP: &str = "moth";
const POND: &str = "pond";
const STATION: &str = "station";
const LAMP: &str = "lamp";
const CLOTH: &str = "cloth";
const KEY: &str = "ratiradio-station-key";
const WAYFINDER: &str = "elysium-wayfinder";
const SHIP: &str = "greek-ship";

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn second_fresh_move(world: &Value) -> bool {
    world["turn"] == 2 && world.get("began").is_none()
}

fn arrival(world: &Value) -> Option<u64> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let mut actions = entries(&world["log"]).filter(|entry| {
        entry["kind"] == "action" && entry["actorId"] == VALE && entry["generated"] != true
    });
    let first = actions.next()?;
    let event = if second_fresh_move(world) {
        if !ordinary_attic_wait(first) || first["turn"] != 1 || first["seq"].as_u64()? >= seq {
            return None;
        }
        actions.next()?
    } else {
        first
    };
    (world["arrival"]["fromLocationId"] == "attic"
        && world["arrival"]["locationId"] == POND
        && event["seq"] == seq
        && event["verb"] == "move"
        && event["turn"] == world["turn"]
        && event["fromLocationId"] == "attic"
        && event["locationId"] == POND
        && event["targetId"] == POND
        && (event["itemId"].is_null() || event["itemId"] == LAMP)
        && actions.next().is_none())
    .then_some(seq)
}

fn second_ask(world: &Value, arrival_seq: u64) -> Option<()> {
    let mut events = world["log"].as_array()?.iter().filter(|entry| {
        entry["generated"] != true && entry["seq"].as_u64().is_some_and(|seq| seq > arrival_seq)
    });
    let ask = events.next()?;
    if ask["kind"] != "action"
        || ask["actorId"] != PIP
        || ask["verb"] != "ask"
        || ask["turn"] != 2
        || ask["locationId"] != POND
        || ask["fromLocationId"] != POND
        || ask["itemId"] != LAMP
        || ask["targetId"] != VALE
        || ask["accepted"] != false
        || world["actors"][PIP]["lastTalk"] != 2
        || events.any(|event| {
            event["turn"] != 2 || event["locationId"] == POND || event["fromLocationId"] == POND
        })
    {
        return None;
    }
    Some(())
}

fn pond_sleeping(world: &Value, geo: &Geography<'_>, began: u64, turn: u64) -> Option<bool> {
    let sleeping = &world["actors"][PIP]["sleeping"];
    if sleeping.is_null() {
        return Some(false);
    }
    let name = geo.files()["v2/card-game/forest.json"]["people"][PIP]["name"].as_str()?;
    let notice = format!("{name} falls asleep.");
    let arrival_seq = world["arrival"]["seq"].as_u64()?;
    (began > 0
        && sleeping["since"] == turn
        && sleeping["place"] == POND
        && sleeping["until"].as_u64()? > turn
        && entries(&world["log"]).any(|entry| {
            entry["kind"] == "narration"
                && entry["actorId"] == PIP
                && entry["locationId"] == POND
                && entry["turn"] == turn
                && entry["generated"] != true
                && entry["seq"].as_u64().is_some_and(|seq| seq > arrival_seq)
                && entry["text"] == notice
        }))
    .then_some(true)
}

fn quiet_pond(world: &Value, geo: &Geography<'_>) -> Option<bool> {
    let turn = world["turn"].as_u64()?;
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    let vale = &world["actors"][VALE];
    let pip = &world["actors"][PIP];
    let lamp = &world["items"][LAMP];
    let fuel = lamp_state(lamp).ok()?;
    let forest = &geo.files()["v2/card-game/forest.json"];
    let mut want = forest["people"][PIP]["want"].as_object()?.clone();
    want.insert("since".into(), json!(0));
    want.insert("refusals".into(), json!(1));
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || (began.checked_add(1)? != turn && !second_fresh_move(world))
        || (world.get("began").is_some()
            && (began == 0 || geo.files()["v2/card-game/world-history.json"]["turns"] != began))
        || !(turn..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["crossed"] != true
        || world["opening"]["met"][PIP] != turn
        || world["locations"]["attic"]["anchored"] != true
        || !world["disabledPacks"].is_null()
        || !world["placeCard"][POND].is_null()
        || !world["pondLampLoan"].is_null()
        || !world["defeats"][VALE].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || vale["place"] != POND
        || vale["waitSpeech"] != json!({"place":POND,"turn":null})
        || ["want", "under", "sleeping", "arcana"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || !vale["talked"].as_array()?.is_empty()
        || pip["place"] != POND
        || pip["heldItem"] != CLOTH
        || pip["want"] != Value::Object(want)
        || pip["trust"][VALE] != 0
        || world["items"][CLOTH]["holder"] != PIP
        || world["items"][KEY]["holder"] != POND
        || lamp["holder"] != VALE
        || lamp["lit"] != false
        || fuel.fuel_place != POND
        || lamp["fuel"] != fuel.fuel_rooms * 4
        || !(vale["heldItem"].is_null() || (vale["heldItem"] == LAMP && fuel.fuel_rooms == 0))
        || world["items"]
            .as_object()?
            .iter()
            .any(|(id, item)| match item["holder"].as_str() {
                Some(POND) => id != KEY && id != WAYFINDER,
                Some(VALE) => id != LAMP,
                Some(PIP) => id != CLOTH,
                Some(LAMP | CLOTH | KEY | WAYFINDER) => true,
                _ => false,
            })
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && id != PIP && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }
    let seq = arrival(world)?;
    if second_fresh_move(world) {
        second_ask(world, seq)?;
    }
    for id in [VALE, PIP, POND, STATION, LAMP, CLOTH, KEY] {
        if !geo.entity_active(world, id)? {
            return None;
        }
    }
    pond_sleeping(world, geo, began, turn)
}

fn pond_paths(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    let mut returns = entries(&forest["reflectionRoutes"]).filter(|route| route["from"] == POND);
    let route = returns.next()?;
    if forest["places"][POND]["exits"] != json!([STATION])
        || route["to"] != "attic"
        || returns.next().is_some()
        || geo.reflection_open(world, route)?
        || entries(&files["v2/card-game/world-life.json"]["guardable"])
            .any(|way| way["from"] == POND || way["to"] == POND)
    {
        return None;
    }
    let mut locked_ship = false;
    for pack in geo.packs() {
        let pack_id = pack["id"].as_str()?;
        if pack["places"].get(POND).is_some()
            || pack["avatars"].get(PIP).is_some()
            || [LAMP, CLOTH]
                .iter()
                .any(|id| pack["items"].get(*id).is_some())
            || entries(&pack["routes"]).any(|route| route["from"] == POND)
            || entries(&pack["choices"]).any(|choice| choice["at"] == POND)
            || pack["fixtures"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, f)| f["at"] == POND)
            || pack["transports"]
                .as_object()
                .into_iter()
                .flatten()
                .any(|(_, t)| t["place"] == POND)
        {
            return None;
        }
        for crossing in entries(&pack["crossings"]).filter(|crossing| crossing["from"] == POND) {
            let id = crossing["id"].as_str()?;
            let discovered = world["crossings"][id]["discovered"].as_bool()?;
            if crossing["transport"] == SHIP
                && crossing["unlockMethod"] == "pond-lamp"
                && crossing["unlockWhen"]
                    .as_array()?
                    .iter()
                    .any(|gate| gate["kind"] == "grounded" && gate["item"] == LAMP)
                && !discovered
            {
                if locked_ship {
                    return None;
                }
                locked_ship = true;
            } else if !crossing["transport"].is_null()
                || !crossing["unlockWhen"].is_null()
                || ((crossing["retired"] != true || discovered)
                    && (crossing["signal"].is_null()
                        || world["crossings"][id]["until"].as_u64()? > turn)
                    && geo.crossing_conditions(
                        world,
                        pack_id,
                        &crossing["requires"],
                        Some(VALE),
                    )?)
            {
                return None;
            }
        }
    }
    locked_ship.then_some(())
}

fn offer(
    kind: &str,
    item: Option<&str>,
    target: Option<&str>,
    text: String,
    cards: &[&str],
) -> Value {
    let key = format!(
        "{kind}:{VALE}:{}:{}",
        item.unwrap_or_default(),
        target.unwrap_or_default()
    );
    json!({"kind":kind,"actor":VALE,"item":item,"target":target,"text":text,"cards":cards,"key":key})
}

fn pond_response(mut response: Value, plans: Vec<Value>, profiles: Value) -> Value {
    response["actor"] = json!(VALE);
    response["room"] = json!(POND);
    response["actions"] = json!(plans);
    response["exits"] = json!([STATION]);
    response["profiles"] = profiles;
    response
}

fn actions(
    world: &Value,
    geo: &Geography<'_>,
    profiles: &Value,
    pip_sleeping: bool,
) -> Option<Vec<Value>> {
    let name = |id: &str| profiles[id]["name"].as_str();
    let vale = name(VALE)?;
    let pip = name(PIP)?;
    let pond = name(POND)?;
    let station = name(STATION)?;
    let lamp = item_as_named(name(LAMP)?);
    let cloth = item_as_named(name(CLOTH)?);
    let mut out = vec![offer(
        "wait",
        None,
        None,
        format!("{vale} waits one turn."),
        &[],
    )];
    if !pip_sleeping {
        let mut accompany = offer(
            "accompany",
            None,
            Some(PIP),
            format!("{vale} asks {pip} to accompany them to {station}."),
            &[PIP, STATION],
        );
        accompany["destination"] = json!(STATION);
        accompany["key"] = json!(format!("accompany:{VALE}::{PIP}:{STATION}"));
        out.push(accompany);
    }
    out.extend([
        offer(
            "move",
            None,
            Some(STATION),
            format!("{vale} goes to {station}."),
            &[STATION],
        ),
        offer(
            "move",
            Some(LAMP),
            Some(STATION),
            format!("{vale} carries {lamp} to {station}."),
            &[LAMP, STATION],
        ),
        offer(
            "threaten",
            Some(CLOTH),
            Some(PIP),
            format!("{vale} threatens {pip} over {cloth}."),
            &[PIP],
        ),
        offer(
            "talk",
            None,
            Some(PIP),
            format!("{vale} has a conversation with {pip}."),
            &[PIP],
        ),
    ]);
    for id in [KEY, WAYFINDER] {
        if world["items"][id]["holder"] == POND && geo.entity_active(world, id)? {
            let thing = item_as_named(name(id)?);
            out.push(offer(
                "take",
                Some(id),
                None,
                format!("{vale} takes {thing}."),
                &[id],
            ));
        }
    }
    out.extend([
        offer(
            "drop",
            Some(LAMP),
            Some(POND),
            format!("{vale} puts {lamp} in {pond}."),
            &[LAMP],
        ),
        offer(
            "give",
            Some(LAMP),
            Some(PIP),
            format!("{vale} gives {lamp} to {pip}."),
            &[LAMP, PIP],
        ),
    ]);
    if !pip_sleeping {
        out.push(offer(
            "ask",
            Some(CLOTH),
            Some(PIP),
            format!("{vale} asks {pip} for {cloth}."),
            &[CLOTH, PIP],
        ));
        let owned_cloth = name(CLOTH)?;
        let mut trade = offer(
            "trade",
            Some(LAMP),
            Some(PIP),
            format!("{vale} trades {lamp} for {pip}’s {owned_cloth}."),
            &[LAMP, CLOTH],
        );
        trade["receive"] = json!(CLOTH);
        trade["key"] = json!(format!("trade:{VALE}:{LAMP}:{PIP}:{CLOTH}"));
        out.push(trade);
    }
    let mut quest = offer(
        "accept",
        None,
        None,
        format!("{vale} accepts the closed box's quest."),
        &[],
    );
    quest["box"] = json!(SHIP);
    quest["key"] = json!(format!("accept:{VALE}::box:{SHIP}"));
    out.push(quest);
    Some(out)
}

pub fn completed_move_response(
    world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    present: &[&str],
) -> Option<Value> {
    completed_move_response_with_profiles(world, geo, before_seq, present, || {
        profiles::project(geo.files())
    })
}

pub(super) fn completed_move_response_with_profiles(
    mut world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    present: &[&str],
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    if present != [VALE] || arrival(&world)? != before_seq.checked_add(1)? {
        return None;
    }
    let pip_sleeping = quiet_pond(&world, geo)?;
    pond_paths(&world, geo)?;
    let files = geo.files();
    let speech = &files["v2/card-game/speech.json"];
    if speech["action"] != json!(["actor"]) || speech["first_meeting"] != json!(["newcomer"]) {
        return None;
    }
    let events: Vec<_> = entries(&world["log"])
        .filter(|entry| entry["seq"].as_u64().is_some_and(|seq| seq > before_seq))
        .cloned()
        .collect();
    if events.first()?["seq"] != world["arrival"]["seq"]
        || events.last()?["seq"] != world["eventSeq"]
        || events.iter().any(|entry| entry["generated"] == true)
    {
        return None;
    }
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(VALE.into(), json!([VALE, PIP]));
    let profiles = profile_source()?;
    let plans = actions(&world, geo, &profiles, pip_sleeping)?;
    let mut response = opening::stored_response(world)?;
    response["events"] = Value::Array(events);
    Some(pond_response(response, plans, profiles))
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    if request["claimed"] != json!([VALE]) || (!present.is_empty() && present != [VALE]) {
        return None;
    }
    let world = request.get("world")?;
    if world["speechVoices"][VALE] != json!([VALE, PIP]) {
        return None;
    }
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let pip_sleeping = quiet_pond(world, &geo)?;
    pond_paths(world, &geo)?;
    let profiles = profiles::project(&files)?;
    let plans = actions(world, &geo, &profiles, pip_sleeping)?;
    let projected = opening_view::private_world(world, request)?;
    Some(pond_response(
        json!({"ok":true,"world":projected}),
        plans,
        profiles,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, process::Command};

    #[test]
    fn pond_moves_project_the_complete_pinned_response() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let (files, _) = opening_content::wait_files(&json!({
            "packContentJson":include_str!("../../orchestrator-rust/src/card_shared/content.json")
        }))
        .unwrap();
        let catalog = Catalog::from_files(&files).unwrap();
        let geo = Geography::new(&files, catalog.packs()).unwrap();
        let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const { cardShared } = currentSharedEngine();
const pinned = request => JSON.parse(cardShared(JSON.stringify(request)));
const seats = { actor: 'vale', claimed: ['vale'], present: ['vale'] };
const options = [false, true].flatMap(history =>
  [undefined, 0, 2, 17, 42, 4242, 4294967295].map(seed => ({seed, history})));
for (const {seed, history} of options) {
  for (const lamp of ['stowed', 'dry']) {
    for (const action of ['move:vale::pond', 'move:vale:lamp:pond']) {
      const created = pinned({op:'create', seed, history});
      assert.equal(created.ok, true, created.error);
      let {world} = created;
      if (lamp === 'stowed') {
        const held = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}});
        assert.equal(held.ok, true, held.error);
        world = held.world;
      } else {
        Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
      }
      const voices = {mara:['mara']};
      world.speechVoices = voices;
      const expected = pinned({...seats, op:'play', world, action});
      assert.equal(expected.ok, true, expected.error);
      console.log(JSON.stringify({beforeSeq:world.eventSeq, expected, voices, title:{seed,history,lamp,action}}));
    }
  }
}
for (const [seed, prior] of [[17, false], [2, true], [4242, true]]) {
  for (const lamp of ['stowed', 'dry']) {
    for (const action of ['move:vale::pond', 'move:vale:lamp:pond']) {
      let {world} = pinned({op:'create', seed});
      if (lamp === 'stowed')
        world = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}}).world;
      else Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
      world.speechVoices = {mara:['mara']};
      world = pinned({...seats, op:'play', world, action:'wait:vale::'}).world;
      assert.deepEqual(world.speechVoices.vale, ['vale']);
      if (prior) world = pinned({...seats, op:'speech', room:'attic', world, lines:[
        {entityId:'attic', actorId:null, text:'The floorboards settle.'},
      ]}).world;
      const expected = pinned({...seats, op:'play', world, action});
      assert.equal(expected.ok, true, expected.error);
      assert.deepEqual(expected.world.actors.vale.waitSpeech, {place:'pond', turn:null});
      assert.deepEqual(expected.world.speechVoices, {mara:['mara'], vale:['vale','moth']});
      assert.deepEqual(expected.events.slice(0,2).map(event => event.verb), ['move','ask']);
      assert.equal(expected.events.length, seed === 17 ? 2 : 3);
      assert.ok(expected.events.every(event => event.turn === 2 && event.seq > world.eventSeq));
      console.log(JSON.stringify({beforeSeq:world.eventSeq, expected, voices:world.speechVoices, title:{seed,lamp,action,prior}}));
    }
  }
}

"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .expect("Node runs the pinned shared reducer");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let lines = String::from_utf8(output.stdout).unwrap();
        assert_eq!(lines.lines().count(), 68);
        for line in lines.lines() {
            let case: Value = serde_json::from_str(line).unwrap();
            let expected = &case["expected"];
            let mut world = expected["world"].clone();
            world["speechVoices"] = case["voices"].clone();
            world["playerActorId"] = json!(VALE);
            for field in ["heldActors", "presentActors", "controlledActors"] {
                world[field] = json!([VALE]);
            }
            let result =
                completed_move_response(world, &geo, case["beforeSeq"].as_u64().unwrap(), &[VALE])
                    .unwrap_or_else(|| panic!("Unsupported {}", case["title"]));
            for (field, value) in expected.as_object().unwrap() {
                assert_eq!(&result[field], value, "{field} for {}", case["title"]);
            }
            assert_eq!(
                result.as_object().unwrap().len(),
                expected.as_object().unwrap().len()
            );
        }
    }
}
