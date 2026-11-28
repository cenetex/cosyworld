use super::{
    authored_order::Order,
    opening::{self, MAX_REVISION},
    opening_full_wait::visible_items,
    opening_reflection::valid_text,
    opening_roster::known_actors,
    opening_station_view::settled_first_arrival,
    opening_wait_response::vale_action,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const KEEPER: &str = "keeper";
const STATION: &str = "station";
const BOOK: &str = "keeper-log";
const QUEST: &str = "quest:keeper:pond";
pub(super) const KEY: &str = "read:vale:keeper-log:";
pub(super) const PROTECTED_FACT_LIMIT: usize = 128;

pub(super) fn read_world(request: &Value) -> Option<&Value> {
    let world = request.get("world")?;
    let action = &request["action"];
    (request["op"] == "play"
        && request["actor"] == VALE
        && opening::seats(&request["claimed"])? == [VALE]
        && opening::seats(&request["present"])? == [VALE]
        && action.as_str().or_else(|| action["key"].as_str())? == KEY
        && action["kind"] != "pack"
        && request["selectedIds"].is_null()
        && (request["revision"].is_null() || request["revision"] == world["revision"])
        && (request["elysiumPortraits"].is_null()
            || request["elysiumPortraits"]
                .as_array()
                .is_some_and(Vec::is_empty))
        && world["speechVoices"][VALE] == json!([VALE, KEEPER])
        && world["stationExitOrder"] == json!([])
        && world["actors"].as_object()?.iter().all(|(id, actor)| {
            actor["place"] != STATION || [VALE, "moth", KEEPER].contains(&id.as_str())
        }))
    .then_some(world)
}

pub(super) fn after_first_log(world: &Value) -> Option<u64> {
    if world["turn"] != 3
        || world.get("began").is_some()
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["actors"][VALE]["place"] != STATION
        || world["items"][BOOK]["holder"] != STATION
        || world["opening"]["met"]["moth"] != 1
        || world["opening"]["met"][KEEPER] != 2
    {
        return None;
    }
    let log = world["log"].as_array()?;
    let moves = |event: &Value, from: &str, to: &str, turn: u64| {
        event["verb"] == "move"
            && event["turn"] == turn
            && event["fromLocationId"] == from
            && event["locationId"] == to
            && event["targetId"] == to
    };
    let mut actions = log.iter().filter(|event| vale_action(event));
    let pond = actions.next()?;
    let station = actions.next()?;
    let station_seq = station["seq"].as_u64()?;
    let read = actions.next()?;
    let read_seq = read["seq"].as_u64()?;
    (actions.next().is_none()
        && moves(pond, "attic", "pond", 1)
        && pond["seq"].as_u64()? < station_seq
        && moves(station, "pond", STATION, 2)
        && world["arrival"]
            == json!({"seq":station_seq,"fromLocationId":"pond","locationId":STATION})
        && read_seq > station_seq
        && read["turn"] == 3
        && read["locationId"] == STATION
        && read["verb"] == "read"
        && read["itemId"] == BOOK
        && read["text"] == "Vale reads The keeper’s log."
        && read["witnesses"].as_array()?.iter().any(|id| id == BOOK)
        && log.iter().any(|event| {
            event["seq"].as_u64() == station_seq.checked_add(1)
                && event["actorId"] == "moth"
                && event["kind"] == "action"
                && event["generated"] != true
                && moves(event, "pond", STATION, 2)
        }))
    .then_some(read_seq)
}

pub(super) fn keeper_book_claim<'a>(world: &Value, geo: &Geography<'a>) -> Option<&'a Value> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    let book = &forest["things"][BOOK];
    let [claim] = book["claims"].as_array()?.as_slice() else {
        return None;
    };
    let want = json!({
        "kind":"place","target":"pond","step":{"verb":"call","crossing":"pond-greek-harbor"}
    });
    let mut live = want.clone();
    live["since"] = json!(0);
    live["refusals"] = json!(0);
    let text = claim["text"].as_str()?;
    let sentence = text.trim().strip_suffix('.')?;
    (forest["people"][VALE]["name"] == "Vale"
        && book["name"] == "The keeper’s log"
        && book["author"] == KEEPER
        && book["lifecycle"] == "fixed"
        && book["teachesQuest"] == "pond"
        && claim["id"] == "pond-signal"
        && claim["about"] == "pond"
        && valid_text(text, 180)
        && !sentence.contains(['.', '!', '?', '。', '！', '？'])
        && sentence
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .take(3)
            .count()
            == 3
        && forest["people"][KEEPER]["want"] == want
        && world["actors"][KEEPER]["want"] == live
        && geo.entity_active(world, "pond")?)
    .then_some(claim)
}

pub(super) fn record_station_witness(
    knowledge: &mut Value,
    actor: &str,
    seq: u64,
    turn: u64,
    text: &str,
) -> Option<()> {
    let event = format!("event:{seq}");
    if knowledge["version"] != 1 || !knowledge["pending"].as_array()?.is_empty() {
        return None;
    }
    let facts = knowledge["facts"].as_object_mut()?;
    if facts.len() >= PROTECTED_FACT_LIMIT || facts.contains_key(&event) {
        return None;
    }
    let witnessed = [KEEPER, "moth", VALE];
    facts.insert(
        event.clone(),
        json!({
            "id":event,"text":text,"source":{
                "kind":"event","eventSeq":seq,"turn":turn,"actorId":actor,"locationId":STATION,
                "witnesses":witnessed,"topic":null,
            }
        }),
    );
    let known = knowledge["known"].as_object_mut()?;
    for actor in witnessed {
        known
            .entry(actor)
            .or_insert_with(|| json!({}))
            .as_object_mut()?
            .insert(
                event.clone(),
                json!({
                    "kind":"witnessed","teller":null,"eventSeq":seq,"learnedTurn":turn,
                }),
            );
    }
    Some(())
}

fn record_knowledge(world: &mut Value, claim: &Value, text: &str) -> Option<()> {
    let seq = world["eventSeq"].as_u64()?;
    let turn = world["turn"].as_u64()?;
    let claim_id = format!("claim:hub:{BOOK}:{}", claim["id"].as_str()?);
    let knowledge = &mut world["knowledge"];
    let quest = &knowledge["facts"][QUEST];
    if knowledge["version"] != 1
        || !knowledge["pending"].as_array()?.is_empty()
        || quest["id"] != QUEST
        || quest["source"]["kind"] != "quest"
        || quest["source"]["actorId"] != KEEPER
        || quest["source"]["locationId"] != STATION
        || quest["source"]["turn"] != 0
        || quest["source"]["witnesses"] != json!([])
        || knowledge["known"][VALE].get(QUEST).is_some()
        || knowledge["known"][VALE].get(&claim_id).is_some()
    {
        return None;
    }
    if knowledge["facts"].get(&claim_id).is_some() {
        return None;
    }
    record_station_witness(knowledge, VALE, seq, turn, text)?;
    let facts = knowledge["facts"].as_object_mut()?;
    facts.get_mut(QUEST)?["source"]["witnesses"] = json!([VALE]);
    facts.insert(
        claim_id.clone(),
        json!({
            "id":claim_id,"text":claim["text"],"source":{
                "kind":"claim","eventSeq":seq,"turn":turn,"actorId":VALE,"locationId":STATION,
                "witnesses":[VALE],"topic":null,"book":BOOK,"claim":claim["id"],"author":KEEPER,
                "about":claim["about"],
            }
        }),
    );
    for id in [claim_id.as_str(), QUEST] {
        knowledge["known"][VALE][id] = json!({
            "kind":"read","teller":null,"eventSeq":seq,"learnedTurn":turn,"book":BOOK,
        });
    }
    Some(())
}

pub fn begin_station_log_read(
    request: &Value,
    geo: &Geography<'_>,
    authored: &Order,
    actor_order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<Value> {
    let saved = read_world(request)?;
    settled_first_arrival(saved, geo, actor_order)?;
    let claim = keeper_book_claim(saved, geo)?;
    let next_revision = saved["revision"].as_u64()?.checked_add(1)?;
    if next_revision > MAX_REVISION {
        return None;
    }
    let mut world = saved.clone();
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("offered");
    vale.remove("guarding");
    world["turn"] = json!(3);
    world["revision"] = json!(next_revision);
    world["playerActorId"] = json!(VALE);
    for field in ["heldActors", "controlledActors", "presentActors"] {
        world[field] = json!([VALE]);
    }
    let cast = known_actors(&world, geo, actor_order, Some(STATION))?;
    let items = visible_items(&world, geo, authored, STATION)?;
    let witnesses: Vec<_> = authored
        .actors
        .iter()
        .map(String::as_str)
        .filter(|id| cast.contains(id))
        .chain(items.iter().copied())
        .collect();
    let text = "Vale reads The keeper’s log.";
    evidence.record(
        &mut world,
        &cast,
        &items,
        json!({
            "speaker":"World","text":text,"kind":"action","actorId":VALE,
            "locationId":STATION,"verb":"read","itemId":BOOK,"witnesses":witnesses,
        }),
        true,
    )?;
    record_knowledge(&mut world, claim, text)?;
    Some(world)
}

#[cfg(test)]
#[path = "opening_station_read_test.rs"]
mod tests;
