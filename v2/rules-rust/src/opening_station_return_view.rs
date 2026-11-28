use super::{
    completed_keeper_abandon, entries, item_as_named, opening, opening_content, opening_roster,
    profiles, station_projection, station_response, Catalog, Geography, Order, KEEPER, LAMP, PIP,
    POND, STATION, VALE,
};
use crate::{
    opening_pond_return_view::keeper_read_departure,
    opening_station_move::{move_event, quiet_opening},
    opening_station_read::{witnessed_read_wait, KEEPER_FROM},
};
use serde_json::{json, Value};

pub(super) fn active(world: &Value) -> bool {
    world["turn"] == 5 && world["actors"][VALE]["want"]["from"] == KEEPER_FROM
}

pub(super) fn read_seq(world: &Value) -> Option<u64> {
    let [.., read, _, _, _, _] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    read["seq"].as_u64()
}

pub(crate) fn gift_head(world: &Value) -> Option<u64> {
    let seq = world["arrival"]["seq"].as_u64()?;
    let head = seq.checked_add(1)?;
    let [.., back, gift] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    (active(world)
        && world.get("began").is_none()
        && quiet_opening(world)
        && world["actors"][VALE]["place"] == STATION
        && world["arrival"] == json!({"seq":seq,"fromLocationId":POND,"locationId":STATION})
        && back["seq"] == seq
        && back["kind"] == "action"
        && back["actorId"] == VALE
        && back["generated"] != true
        && move_event(back, 5, POND, STATION)
        && gift["seq"] == head
        && gift["turn"] == 5
        && gift["kind"] == "action"
        && gift["generated"] != true
        && gift["actorId"] == PIP
        && gift["locationId"] == STATION
        && gift["verb"] == "give"
        && gift["itemId"] == "cloth"
        && gift["targetId"] == VALE
        && gift["accepted"] == true
        && world["items"]["cloth"]["holder"] == VALE
        && world["eventSeq"] == head)
        .then_some(head)
}

pub(super) fn witnessed_gift(
    gift: &Value,
    wait: &Value,
    geo: &Geography<'_>,
    turn: u64,
) -> Option<()> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    let pip = forest["people"][PIP]["name"].as_str()?;
    let vale = forest["people"][VALE]["name"].as_str()?;
    let cloth = item_as_named(forest["things"]["cloth"]["name"].as_str()?);
    let cast = gift["cast"].as_array()?;
    (gift["turn"] == turn
        && gift["kind"] == "action"
        && gift["speaker"] == "World"
        && gift["verb"] == "give"
        && gift["actorId"] == PIP
        && gift["targetId"] == VALE
        && gift["itemId"] == "cloth"
        && gift["accepted"] == true
        && gift["generated"] != true
        && gift["locationId"] == STATION
        && gift["fromLocationId"] == STATION
        && gift["witnesses"] == wait["witnesses"]
        && gift["light"] == false
        && cast.len() == 3
        && [KEEPER, PIP, VALE]
            .iter()
            .all(|id| cast.iter().any(|member| member == id))
        && entries(&gift["items"]).find(|item| item["id"] == "cloth")?["holder"] == VALE
        && gift["text"] == format!("{pip} gives {cloth} to {vale}."))
    .then_some(())
}

pub(super) fn events<'a>(world: &'a Value, geo: &Geography<'_>) -> Option<&'a [Value]> {
    let head = gift_head(world)?;
    let log = world["log"].as_array()?;
    let [.., read, wait, departure, back, gift] = log.as_slice() else {
        return None;
    };
    let (left, read_seq) = keeper_read_departure(world, Some(back))?;
    let vale = &world["actors"][VALE];
    let forest = &geo.files()["v2/card-game/forest.json"];
    let name = forest["people"][VALE]["name"].as_str()?;
    let station = forest["places"][STATION]["name"].as_str()?;
    let move_text = if back["itemId"] == LAMP {
        let item = item_as_named(forest["things"][LAMP]["name"].as_str()?);
        format!("{name} carries {item} to {station}.")
    } else {
        format!("{name} goes to {station}.")
    };
    if vale["visited"] != json!(["attic", POND, STATION])
        || vale["crossed"] != 1
        || ["closed", "gaveUp"].iter().any(|key| !vale[*key].is_null())
        || world["speechVoices"][VALE] != json!([VALE])
        || departure["seq"] != left
        || departure["witnesses"] != wait["witnesses"]
        || left.checked_add(2)? != head
        || back["speaker"] != "World"
        || back["text"] != move_text
        || back["cast"] != gift["cast"]
        || back["light"] != false
    {
        return None;
    }
    witnessed_read_wait(world, read, wait, read_seq)?;
    witnessed_gift(gift, wait, geo, 5)?;
    custody(world, departure, back, gift, head)?;
    log.get(log.len().checked_sub(2)?..)
}

pub(crate) fn hold_scene(world: &Value, geo: &Geography<'_>) -> Option<()> {
    events(world, geo)?;
    let read = read_seq(world)?;
    let want = crate::opening_station_read::keeper_want_from_read(world, geo, read)?;
    if world["actors"][VALE]["want"] != want
        || world["actors"][PIP]["place"] != STATION
        || world["actors"][KEEPER]["place"] != STATION
        || world["items"]["oil"]["holder"] != KEEPER
    {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] == STATION
            && ![VALE, PIP, KEEPER].contains(&id.as_str())
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    Some(())
}

pub(super) fn private_scene(world: &Value, geo: &Geography<'_>) -> Option<()> {
    if world["actors"][VALE]["heldItem"] == "cloth" {
        return events(world, geo).map(|_| ());
    }
    opening::verify_keeper_station_hand(world, geo)?;
    crate::opening_second_attic_tail::verify_station_hold(world, geo)?;
    (!geo.packs().any(|pack| {
        pack["avatars"].as_object().is_some_and(|actors| {
            actors
                .values()
                .any(|actor| actor["sealed"]["at"] == STATION)
        })
    }))
    .then_some(())
}

fn custody(world: &Value, departure: &Value, back: &Value, gift: &Value, head: u64) -> Option<()> {
    let origin = std::iter::once(Some(VALE))
        .chain(entries(&departure["items"]).map(|item| item["id"].as_str()))
        .collect::<Option<Vec<_>>>()?;
    let mut items = back["items"].clone();
    let cloth = items
        .as_array_mut()?
        .iter_mut()
        .find(|item| item["id"] == "cloth")?;
    if cloth["holder"] != PIP || back["witnesses"] != json!(origin) {
        return None;
    }
    cloth["holder"] = json!(VALE);
    let text = gift["text"].as_str()?;
    let life = &world["life"]["actors"];
    let trial = world["memories"][PIP]["learning"].as_array()?.last()?;
    let event = format!("event:{head}");
    (items == gift["items"]
        && world["items"]["cloth"]["history"].as_array()?.last()? == &format!("Turn 5: {text}")
        && life[VALE]["attachments"]["cloth"] == json!({"from":PIP,"turn":5})
        && life[VALE]["company"][PIP] == 8
        && life[PIP]["company"][VALE] == 8
        && trial["seq"] == head
        && trial["action"]["kind"] == "give"
        && trial["reward"] == -5
        && trial["evidence"] == text
        && world["knowledge"]["facts"][&event]
            == json!({
                "id":event,"text":text,"source":{
                    "kind":"event","eventSeq":head,"turn":5,"actorId":PIP,
                    "locationId":STATION,"witnesses":[KEEPER,PIP,VALE],"topic":null,
                }
            }))
    .then_some(())
}

pub(crate) fn completed(
    world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    order: &[&str],
    before_seq: u64,
    profiles: Value,
) -> Option<Value> {
    let events = events(&world, geo)?;
    if events.first()?["seq"] != before_seq.checked_add(1)?
        || world["actors"][VALE]["heldItem"] != "cloth"
    {
        return None;
    }
    let events = json!(events);
    let (plans, profiles) = station_projection(&world, geo, authored, order, false, false, || {
        Some(profiles)
    })?;
    let mut response = station_response(opening::stored_response(world)?, plans, profiles);
    response["events"] = events;
    Some(response)
}

pub(crate) fn projection(request: &Value, returning: bool) -> Option<Value> {
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
    {
        return None;
    }
    let world = request.get("world")?;
    let order = opening_roster::actor_order(request, world)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let complete = if returning {
        completed
    } else {
        completed_keeper_abandon
    };
    complete(
        world.clone(),
        &geo,
        &authored,
        &order,
        request["beforeSeq"].as_u64()?,
        profiles::project(&files)?,
    )
}
