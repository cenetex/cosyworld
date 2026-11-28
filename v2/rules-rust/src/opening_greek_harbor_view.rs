use super::{
    authored_order::Order, opening, opening_content, opening_full_wait::visible_items,
    opening_pickups::item_as_named, opening_pond_ship_disembark::arrival_event,
    opening_pond_view::offer, opening_station_move::quiet_opening, opening_view,
    opening_visitor_routes, pack_state::Catalog, profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ADA: &str = "ada";
const MYRTO: &str = "greek-shipmaster";
const HARBOR: &str = "greek-harbor";
const SHIP: &str = "greek-ship";
const CLOTH: &str = "cloth";
const ACCOUNTS: &str = "greek-helen-accounts";
const RAVEN: &str = "ratiradio-raven-figurine";
const PROVISIONS: &str = "greek-provisions";
const ROADS: [&str; 2] = ["greek-road-thebes", "greek-argolid-road"];
const EXITS: [&str; 3] = [ROADS[0], ROADS[1], SHIP];
const VOICES: [&str; 2] = [VALE, MYRTO];

fn scene(world: &Value, geo: &Geography<'_>, authored: &Order) -> Option<(bool, bool)> {
    let vale = &world["actors"][VALE];
    let ada = world["actors"][ADA]["place"] == HARBOR;
    let myrto = &world["actors"][MYRTO];
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world.get("began").is_some()
        || !quiet_opening(world)
        || !(12..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["transports"][SHIP]
            != json!({
                "version":3,"phase":"docked","dock":HARBOR,"destination":null,
                "riders":[],"since":11,"recall":null,
            })
        || world["crossings"]["greek-harbor-pond"] != json!({"discovered":true})
        || vale["visited"] != json!(["attic", "pond", "station", SHIP, HARBOR])
        || vale["waitSpeech"] != json!({"place":HARBOR,"turn":null})
        || vale["heldItem"] != CLOTH
        || world["items"][CLOTH]["holder"] != VALE
        || world["items"]["lamp"]["holder"] != "pond"
        || ["want", "under", "sleeping", "guarding", "offered"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
        || !world["placeCard"][HARBOR].is_null()
        || !world["actors"][VALE]["closed"]["quest:box:greek-provisions"].is_null()
        || world["opening"]["met"][MYRTO] != 11
        || world["packs"]["greek-drama"]["met"][MYRTO] != 11
        || myrto["place"] != HARBOR
        || !geo.entity_active(world, MYRTO)?
        || myrto["want"]
            != json!({"kind":"item","target":PROVISIONS,"since":0,"refusals":0,"step":{"verb":"eat","at":"greek-piraeus"}})
        || ["heldItem", "sleeping", "guarding", "offered"]
            .iter()
            .any(|key| !myrto[*key].is_null())
    {
        return None;
    }
    if ada {
        let visitor = &world["actors"][ADA];
        if visitor["visited"] != json!(["loft", SHIP, HARBOR])
            || visitor["crossed"] != 2
            || !geo.visiting_resident(world, ADA)
            || !geo.entity_active(world, ADA)?
            || ["heldItem", "sleeping", "guarding", "offered"]
                .iter()
                .any(|key| !visitor[*key].is_null())
        {
            return None;
        }
    }
    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] == HARBOR
            && ![VALE, ADA, MYRTO].contains(&id.as_str())
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    let provisions = geo
        .packs()
        .find(|pack| pack["id"] == "greek-drama")?
        .get("items")?
        .get(PROVISIONS)?;
    if !geo.entity_active(world, HARBOR)?
        || !geo.entity_active(world, SHIP)?
        || geo.base_exits(HARBOR)? != json!(ROADS).as_array()?.as_slice()
        || opening_visitor_routes::exits(world, geo, VALE, HARBOR)? != EXITS.into()
        || world["doors"]
            .as_object()?
            .values()
            .any(|door| door == HARBOR)
        || provisions["home"] != HARBOR
        || provisions["locked"]["by"] != MYRTO
        || world["items"][PROVISIONS]["holder"] != HARBOR
        || !world["usedUp"]
            .as_array()?
            .iter()
            .any(|id| id == PROVISIONS)
    {
        return None;
    }
    let stock = visible_items(world, geo, authored, HARBOR)?;
    match stock.as_slice() {
        [ACCOUNTS, CLOTH] => Some((ada, false)),
        [ACCOUNTS, RAVEN, CLOTH] => Some((ada, true)),
        _ => None,
    }
}

fn cast(event: &Value, ada: bool) -> Option<()> {
    let names = event["cast"].as_array()?;
    (names.len() == 2 + usize::from(ada)
        && names.iter().any(|id| id == VALE)
        && names.iter().any(|id| id == MYRTO)
        && (!ada || names.iter().any(|id| id == ADA)))
    .then_some(())
}

fn events<'a>(
    world: &'a Value,
    profiles: &Value,
    ada: bool,
    raven: bool,
    allow_speech: bool,
) -> Option<&'a [Value]> {
    let arrival = arrival_event(world)?;
    let log = world["log"].as_array()?;
    let start = log.iter().position(|entry| entry == arrival)?;
    let suffix = log.get(start..)?;
    let (travel, speech) = suffix.split_at_checked(1 + usize::from(ada))?;
    let room = profiles[HARBOR]["name"].as_str()?;
    let vale = profiles[VALE]["name"].as_str()?;
    let text = if arrival["itemId"] == CLOTH {
        format!(
            "{vale} carries {} ashore at {room}.",
            item_as_named(profiles[CLOTH]["name"].as_str()?)
        )
    } else {
        format!("{vale} disembarks at {room}.")
    };
    let witnesses = if ada {
        json!([VALE, ADA, CLOTH])
    } else {
        json!([VALE, CLOTH])
    };
    let mut items = vec![json!({"id":ACCOUNTS,"holder":HARBOR})];
    if raven {
        items.push(json!({"id":RAVEN,"holder":HARBOR}));
    }
    items.push(json!({"id":CLOTH,"holder":VALE}));
    let items = Value::Array(items);
    let seq = arrival["seq"].as_u64()?;
    cast(arrival, false)?;
    if arrival["text"] != text
        || arrival["witnesses"] != witnesses
        || log.last()?["seq"] != world["eventSeq"]
        || (!allow_speech && !speech.is_empty())
        || suffix.iter().enumerate().any(|(i, event)| {
            event["turn"] != 11
                || event["seq"].as_u64() != seq.checked_add(i as u64)
                || event["locationId"] != HARBOR
                || event["light"] != false
                || event["items"] != items
        })
        || travel
            .iter()
            .any(|event| event["speaker"] != "World" || event["generated"] == true)
    {
        return None;
    }
    if let [_, follow] = travel {
        cast(follow, true)?;
        if follow["kind"] != "action"
            || follow["actorId"] != ADA
            || follow["verb"] != "move"
            || follow["fromLocationId"] != SHIP
            || follow["targetId"] != HARBOR
            || !follow["itemId"].is_null()
            || follow["witnesses"] != json!([ADA])
            || follow["text"]
                != format!("{} disembarks at {room}.", profiles[ADA]["name"].as_str()?)
        {
            return None;
        }
    }
    for line in speech {
        cast(line, ada)?;
        let voice = match line["kind"].as_str()? {
            "dialogue" => line["actorId"].as_str()?,
            "narration" if line["actorId"].is_null() => HARBOR,
            _ => return None,
        };
        if ![VALE, MYRTO, HARBOR].contains(&voice)
            || (voice == HARBOR && line["kind"] != "narration")
            || line["entityId"] != voice
            || line["speaker"] != profiles[voice]["name"]
            || line["generated"] != true
            || line.get("elysiumName").is_some()
        {
            return None;
        }
    }
    Some(travel)
}

fn reply(mut response: Value, profiles: Value, ada: bool, raven: bool) -> Option<Value> {
    let name = |id: &str| profiles[id]["name"].as_str();
    let vale = name(VALE)?;
    let cloth = item_as_named(name(CLOTH)?);
    let company = if ada { &[ADA, MYRTO][..] } else { &[MYRTO][..] };
    let mut plans = vec![offer(
        "wait",
        None,
        None,
        format!("{vale} waits one turn."),
        &[],
    )];
    for to in EXITS {
        let place = name(to)?;
        for &actor in company {
            let mut accompany = offer(
                "accompany",
                None,
                Some(actor),
                format!("{vale} asks {} to accompany them to {place}.", name(actor)?),
                &[actor, to],
            );
            accompany["destination"] = json!(to);
            accompany["key"] = json!(format!("accompany:vale::{actor}:{to}"));
            plans.push(accompany);
        }
        let (walk, carry) = if to == SHIP {
            (
                format!("{vale} boards {place}."),
                format!("{vale} carries {cloth} aboard {place}."),
            )
        } else {
            (
                format!("{vale} goes to {place}."),
                format!("{vale} carries {cloth} to {place}."),
            )
        };
        let mut bare = offer("move", None, Some(to), walk, &[to]);
        let mut carried = offer("move", Some(CLOTH), Some(to), carry, &[CLOTH, to]);
        if to == SHIP {
            bare["label"] = json!("Board");
            carried["label"] = json!("Board");
        }
        plans.extend([bare, carried]);
    }
    for &actor in company {
        let person = name(actor)?;
        plans.push(offer(
            "threaten",
            None,
            Some(actor),
            format!("{vale} threatens {person}."),
            &[actor],
        ));
        plans.push(offer(
            "talk",
            None,
            Some(actor),
            format!("{vale} has a conversation with {person}."),
            &[actor],
        ));
    }
    let stock = if raven {
        &[ACCOUNTS, RAVEN][..]
    } else {
        &[ACCOUNTS][..]
    };
    for &item in stock {
        plans.push(offer(
            "take",
            Some(item),
            None,
            format!("{vale} takes {}.", item_as_named(name(item)?)),
            &[item],
        ));
    }
    plans.push(offer(
        "drop",
        Some(CLOTH),
        Some(HARBOR),
        format!("{vale} puts {cloth} in {}.", name(HARBOR)?),
        &[CLOTH],
    ));
    for &actor in company {
        plans.push(offer(
            "give",
            Some(CLOTH),
            Some(actor),
            format!("{vale} gives {cloth} to {}.", name(actor)?),
            &[CLOTH, actor],
        ));
    }
    let mut accept = offer(
        "accept",
        None,
        None,
        format!("{vale} accepts the closed box's quest."),
        &[],
    );
    accept["box"] = json!(PROVISIONS);
    accept["key"] = json!("accept:vale::box:greek-provisions");
    plans.push(accept);
    response["actor"] = json!(VALE);
    response["room"] = json!(HARBOR);
    response["exits"] = json!(EXITS);
    response["profiles"] = profiles;
    response["actions"] = Value::Array(plans);
    Some(response)
}

pub(super) fn completed_response(
    mut world: Value,
    geo: &Geography<'_>,
    authored: &Order,
    before_seq: u64,
    profiles: Value,
) -> Option<Value> {
    let (ada, raven) = scene(&world, geo, authored)?;
    let travel = events(&world, &profiles, ada, raven, false)?;
    let speech = &geo.files()["v2/card-game/speech.json"];
    if travel.first()?["seq"] != before_seq.checked_add(1)?
        || speech["action"] != json!(["actor"])
        || speech["first_meeting"] != json!(["newcomer"])
    {
        return None;
    }
    let travel = travel.to_vec();
    world["speechVoices"]
        .as_object_mut()?
        .insert(VALE.into(), json!(VOICES));
    let mut response = opening::stored_response(world)?;
    response["events"] = Value::Array(travel);
    reply(response, profiles, ada, raven)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    if request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || request["present"] != json!([VALE])
    {
        return None;
    }
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    completed_response(
        request.get("world")?.clone(),
        &geo,
        &authored,
        request["beforeSeq"].as_u64()?,
        profiles::project(&files)?,
    )
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    if request["claimed"] != json!([VALE]) || !(present.is_empty() || present == [VALE]) {
        return None;
    }
    let world = request.get("world")?;
    if world["speechVoices"][VALE] != json!(VOICES) {
        return None;
    }
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let (ada, raven) = scene(world, &geo, &authored)?;
    let profiles = profiles::project(&files)?;
    events(world, &profiles, ada, raven, true)?;
    let mut response = json!({"ok":true});
    response["world"] = opening_view::private_world(world, request)?;
    reply(response, profiles, ada, raven)
}
