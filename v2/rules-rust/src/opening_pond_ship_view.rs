use super::{
    initial_wants::root_in,
    opening, opening_content,
    opening_pickups::item_as_named,
    opening_pond_ship_board::{arrival_event, boarding_event},
    opening_pond_view::offer,
    opening_station_move::quiet_opening,
    opening_view, opening_visitor_routes,
    opening_visitor_transport::docked_courses,
    pack_state::Catalog,
    profiles, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ADA: &str = "ada";
const SHIP: &str = "greek-ship";
const HARBOR: &str = "greek-harbor";
const CLOTH: &str = "cloth";
const LOFT: &str = "loft";

fn rows(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn room_cast(cast: &Value, ada: bool) -> Option<()> {
    let cast = cast.as_array()?;
    (cast.len() == 1 + usize::from(ada)
        && cast.iter().any(|id| id == VALE)
        && (!ada || cast.iter().any(|id| id == ADA)))
    .then_some(())
}

fn cabin(world: &Value, geo: &Geography<'_>) -> Option<bool> {
    let cast = world["actors"].as_object()?;
    let ada = cast.get(ADA)?;
    let aboard = ada["place"] == SHIP;
    for (id, actor) in cast {
        if ![VALE, ADA].contains(&id.as_str())
            && actor["place"] == SHIP
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    if aboard {
        let visit = world["log"].as_array()?.iter().rfind(|event| {
            event["actorId"] == ADA && event["kind"] == "action" && event["generated"] != true
        })?;
        if !geo.entity_active(world, ADA)?
            || !geo.visiting_resident(world, ADA)
            || ada["visited"] != json!([LOFT, SHIP])
            || ada["crossed"] != 1
            || !ada["heldItem"].is_null()
            || !ada["sleeping"].is_null()
            || world["items"]["shears"]["holder"] != LOFT
            || world["opening"]["met"][ADA] != 8
            || world["packs"]["shared-homes"]["met"][ADA] != 8
            || visit["turn"] != 7
            || visit["verb"] != "move"
            || visit["fromLocationId"] != LOFT
            || visit["locationId"] != SHIP
            || visit["targetId"] != SHIP
            || visit["witnesses"] != json!([ADA, "shears"])
        {
            return None;
        }
    } else if !world["opening"]["met"][ADA].is_null()
        || !world["packs"]["shared-homes"]["met"][ADA].is_null()
        || ada["place"] != LOFT
        || world["items"]["shears"]["holder"] != ADA
    {
        return None;
    }
    Some(aboard)
}

fn ship_paths(world: &Value, geo: &Geography<'_>, docked: bool) -> Option<()> {
    let files = geo.files();
    if !geo.base_exits(SHIP)?.is_empty()
        || rows(&files["v2/card-game/forest.json"]["reflectionRoutes"])
            .any(|route| route["from"] == SHIP)
        || rows(&files["v2/card-game/world-life.json"]["guardable"])
            .any(|route| route["from"] == SHIP || route["to"] == SHIP)
        || (docked && docked_courses(world, geo, VALE, SHIP)? != [HARBOR])
    {
        return None;
    }
    let mut loft = false;
    for pack in geo.packs() {
        let id = pack["id"].as_str()?;
        if rows(&pack["routes"]).any(|route| route["from"] == SHIP)
            || rows(&pack["choices"]).any(|choice| {
                choice["at"] == SHIP || (choice["on"] == "give" && choice["subject"] == ADA)
            })
            || pack["fixtures"]
                .as_object()
                .into_iter()
                .flat_map(|map| map.values())
                .any(|fixture| fixture["at"] == SHIP)
        {
            return None;
        }
        for path in rows(&pack["crossings"]).filter(|edge| edge["from"] == SHIP) {
            let to = path["to"].as_str()?;
            if opening_visitor_routes::crossing_open(world, geo, VALE, id, path)?
                || (id != "shared-homes" && !path["sealed"].is_null())
            {
                return None;
            }
            if id != "shared-homes" || world["doors"][to] != SHIP {
                continue;
            }
            if loft
                || to != LOFT
                || path["sealed"] != json!({})
                || path["requires"]
                    != json!([
                        {"kind":"shared_world"},
                        {"kind":"home_door","home":LOFT,"place":SHIP},
                        {"kind":"item_near","item":"shears","place":SHIP}
                    ])
                || !world["opened"][LOFT].is_null()
            {
                return None;
            }
            loft = true;
        }
    }
    loft.then_some(())
}

fn scene(world: &Value, geo: &Geography<'_>, docked: bool) -> Option<bool> {
    let vale = &world["actors"][VALE];
    let items = world["items"].as_object()?;
    let (turn, phase, destination) = if docked {
        (8, "docked", None)
    } else {
        (9, "sea", Some(HARBOR))
    };
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["turn"] != turn
        || world.get("began").is_some()
        || !quiet_opening(world)
        || !(turn + 1..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["transports"][SHIP]
            != json!({
                "version":3,"phase":phase,"dock":"pond","destination":destination,
                "riders":[],"since":turn,"recall":null,
            })
        || world["opened"][SHIP] != json!([VALE])
        || world["crossings"]["pond-greek-harbor"]
            != json!({"discovered":true,"method":"pond-lamp"})
        || world["actors"]["keeper"]["completedQuest"]["turn"] != 7
        || world["actors"]["keeper"]["completedQuest"]["by"] != VALE
        || vale["arcana"] != json!({"proved":[],"did":[],"callers":["keeper"],"calls":1})
        || ["want", "under", "sleeping", "offered", "guarding"]
            .iter()
            .any(|key| !vale[*key].is_null())
        || vale["waitSpeech"] != json!({"place":SHIP,"turn":null})
        || !vale["closed"]["quest:box:loft"].is_null()
        || vale["heldItem"] != CLOTH
        || items.get(CLOTH)?["holder"] != VALE
        || items.get("lamp")?["holder"] != "pond"
        || !geo.entity_active(world, CLOTH)?
        || world["life"]["actors"][VALE]["attachments"][CLOTH] != json!({"from":"moth","turn":5})
        || !world["placeCard"][SHIP].is_null()
        || !world["standoffs"].as_array()?.is_empty()
        || !world["conversations"].as_array()?.is_empty()
    {
        return None;
    }
    let ada = cabin(world, geo)?;
    for id in items.keys().filter(|id| id.as_str() != CLOTH) {
        let holder = root_in(items, id)?;
        if (matches!(holder, SHIP | VALE) || (holder == ADA && ada))
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    ship_paths(world, geo, docked)?;
    Some(ada)
}

fn event<'a, 'name>(
    world: &'a Value,
    ada: bool,
    name: impl Fn(&str) -> Option<&'name str>,
    docked: bool,
) -> Option<(&'a Value, &'a [Value], &'a [Value])> {
    let primary = if docked {
        arrival_event(world)?
    } else {
        boarding_event(world)?
    };
    let seq = primary["seq"].as_u64()?;
    let log = world["log"].as_array()?;
    let offset = log.iter().position(|entry| entry["seq"] == seq)?;
    let (shore, after) = log.split_at(offset);
    let (_, suffix) = after.split_first()?;
    let (speech, course) =
        suffix.split_at(suffix.iter().take_while(|event| event["turn"] == 8).count());
    let drop = shore
        .iter()
        .rfind(|entry| entry["verb"] == "drop" && entry["turn"] == 7)?;
    let vale = name(VALE)?;
    let ship = name(SHIP)?;
    let cloth = item_as_named(name(CLOTH)?);
    let text = if primary["itemId"] == CLOTH {
        format!("{vale} carries {cloth} aboard {ship}.")
    } else {
        format!("{vale} boards {ship}.")
    };
    let items = json!([{"id":CLOTH,"holder":VALE}]);
    let history = format!("Turn 8: {vale} carried it to {ship}.");
    room_cast(&primary["cast"], ada)?;
    if log.last()?["seq"] != world["eventSeq"]
        || shore.last()?["turn"] != 7
        || (docked && !course.is_empty())
        || primary["speaker"] != "World"
        || primary["text"] != text
        || primary["items"] != items
        || primary["light"] != false
        || drop["actorId"] != VALE
        || drop["locationId"] != "pond"
        || drop["itemId"] != "lamp"
        || drop["witnesses"] != primary["witnesses"]
        || world["items"][CLOTH]["history"]
            .as_array()?
            .last()?
            .as_str()?
            != history
    {
        return None;
    }
    for (i, line) in speech.iter().enumerate() {
        if line["seq"].as_u64()? != seq.checked_add(i as u64 + 1)? {
            return None;
        }
        caption(line, ada, true, &items, &name)?;
    }
    Some((primary, speech, course))
}

fn caption<'name>(
    line: &Value,
    ada: bool,
    docked: bool,
    items: &Value,
    name: impl Fn(&str) -> Option<&'name str>,
) -> Option<()> {
    let voice = match line["kind"].as_str()? {
        "dialogue" => line["actorId"].as_str()?,
        "narration" if line["actorId"].is_null() => SHIP,
        _ => return None,
    };
    room_cast(&line["cast"], ada)?;
    ((voice == VALE || voice == SHIP || (ada && docked && voice == ADA))
        && (voice != SHIP || line["kind"] == "narration")
        && line["entityId"] == voice
        && line["speaker"] == name(voice)?
        && line["locationId"] == SHIP
        && line["generated"] == true
        && &line["items"] == items
        && line["light"] == false
        && line.get("elysiumName").is_none())
    .then_some(())
}

fn course_events<'a>(
    world: &'a Value,
    ada: bool,
    profiles: &Value,
    allow_speech: bool,
) -> Option<&'a [Value]> {
    let (board, captions, suffix) = event(world, ada, |id| profiles[id]["name"].as_str(), false)?;
    let [course, cast_off, speech @ ..] = suffix else {
        return None;
    };
    let seq = captions.last().unwrap_or(board)["seq"]
        .as_u64()?
        .checked_add(1)?;
    let vale = profiles[VALE]["name"].as_str()?;
    let ship = profiles[SHIP]["name"].as_str()?;
    let harbor = profiles[HARBOR]["name"].as_str()?;
    let items = &board["items"];
    let witnesses = if ada {
        json!([VALE, ADA, CLOTH])
    } else {
        json!([VALE, CLOTH])
    };
    if course["text"] != format!("{vale} sets the ship's course for {harbor}.")
        || course["kind"] != "action"
        || course["actorId"] != VALE
        || course["verb"] != "course"
        || course["fromLocationId"] != SHIP
        || course["targetId"] != HARBOR
        || !course["itemId"].is_null()
        || course["witnesses"] != witnesses
        || cast_off["text"] != format!("{ship} casts off for {harbor}.")
        || cast_off["kind"] != "narration"
        || !cast_off["actorId"].is_null()
        || !cast_off["verb"].is_null()
        || !cast_off["witnesses"].is_null()
        || (!allow_speech && !speech.is_empty())
        || suffix.iter().enumerate().any(|(i, event)| {
            event["seq"].as_u64() != seq.checked_add(i as u64) || event["turn"] != 9
        })
    {
        return None;
    }
    room_cast(&course["cast"], ada)?;
    for event in [course, cast_off] {
        if event["locationId"] != SHIP
            || event["speaker"] != "World"
            || event["generated"] == true
            || event["light"] != false
            || &event["items"] != items
            || event["cast"] != course["cast"]
        {
            return None;
        }
    }
    for line in speech {
        caption(line, ada, false, items, |id| profiles[id]["name"].as_str())?;
    }
    suffix.get(..2)
}

fn reply(mut response: Value, profiles: Value, ada: bool, docked: bool) -> Option<Value> {
    let name = |id: &str| profiles[id]["name"].as_str();
    let vale = name(VALE)?;
    let ship = name(SHIP)?;
    let cloth = item_as_named(name(CLOTH)?);
    let mut plans = vec![offer(
        "wait",
        None,
        None,
        format!("{vale} waits one turn."),
        &[],
    )];
    if docked {
        let course_text = format!("{vale} sets the ship's course for {}.", name(HARBOR)?);
        let mut course = offer("course", None, Some(HARBOR), course_text, &[HARBOR]);
        course["label"] = json!("Set course");
        plans.push(course);
    }
    if ada {
        let sage = name(ADA)?;
        let threat = format!("{vale} threatens {sage}.");
        let talk = format!("{vale} has a conversation with {sage}.");
        plans.extend([
            offer("threaten", None, Some(ADA), threat, &[ADA]),
            offer("talk", None, Some(ADA), talk, &[ADA]),
        ]);
    }
    let drop = format!("{vale} puts {cloth} in {ship}.");
    plans.push(offer("drop", Some(CLOTH), Some(SHIP), drop, &[CLOTH]));
    if ada {
        let gift = format!("{vale} gives {cloth} to {}.", name(ADA)?);
        plans.push(offer("give", Some(CLOTH), Some(ADA), gift, &[CLOTH, ADA]));
    }
    let accept = format!("{vale} accepts the closed box's quest.");
    let mut loft = offer("accept", None, None, accept, &[]);
    loft["box"] = json!(LOFT);
    loft["key"] = json!("accept:vale::box:loft");
    plans.push(loft);
    response["actor"] = json!(VALE);
    response["room"] = json!(SHIP);
    response["exits"] = if docked { json!([HARBOR]) } else { json!([]) };
    response["actions"] = Value::Array(plans);
    response["profiles"] = profiles;
    Some(response)
}

fn voices(ada: bool) -> &'static [&'static str] {
    if ada {
        &[VALE, ADA]
    } else {
        &[VALE]
    }
}

pub(super) fn settled_speakers<'name>(
    world: &Value,
    geo: &Geography<'_>,
    name: impl Fn(&str) -> Option<&'name str>,
) -> Option<&'static [&'static str]> {
    let ada = scene(world, geo, true)?;
    let speakers = voices(ada);
    if world["speechVoices"][VALE] != json!(speakers) {
        return None;
    }
    event(world, ada, name, true)?;
    Some(speakers)
}

pub(super) fn completed_response(
    mut world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let ada = scene(&world, geo, true)?;
    let profiles = profile_source()?;
    let (movement, speech, _) = event(&world, ada, |id| profiles[id]["name"].as_str(), true)?;
    if movement["seq"] != before_seq.checked_add(1)? || !speech.is_empty() {
        return None;
    }
    let movement = movement.clone();
    world["speechVoices"]
        .as_object_mut()?
        .insert(VALE.into(), json!(voices(ada)));
    let mut response = opening::stored_response(world)?;
    response["events"] = Value::Array(vec![movement]);
    reply(response, profiles, ada, true)
}

pub(super) fn completed_course_response(
    mut world: Value,
    geo: &Geography<'_>,
    before_seq: u64,
    profile_source: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    let ada = scene(&world, geo, false)?;
    let profiles = profile_source()?;
    let events = course_events(&world, ada, &profiles, false)?;
    if events.first()?["seq"] != before_seq.checked_add(1)?
        || geo.files()["v2/card-game/speech.json"]["action"] != json!(["actor"])
    {
        return None;
    }
    let events = events.to_vec();
    world["speechVoices"]
        .as_object_mut()?
        .insert(VALE.into(), json!([VALE]));
    let mut response = opening::stored_response(world)?;
    response["events"] = Value::Array(events);
    reply(response, profiles, ada, false)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    if request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || request["present"] != json!([VALE])
    {
        return None;
    }
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let world = request.get("world")?.clone();
    let before_seq = request["beforeSeq"].as_u64()?;
    let profile_source = || profiles::project(&files);
    if request["op"] == "opening_pond_ship_course_view" {
        completed_course_response(world, &geo, before_seq, profile_source)
    } else {
        completed_response(world, &geo, before_seq, profile_source)
    }
}

pub(super) fn private_view(request: &Value, present: &[&str]) -> Option<Value> {
    if request["claimed"] != json!([VALE]) || (!present.is_empty() && present != [VALE]) {
        return None;
    }
    let world = request.get("world")?;
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let docked = world["turn"] == 8;
    let profiles = profiles::project(&files)?;
    let ada = if docked {
        settled_speakers(world, &geo, |id| profiles[id]["name"].as_str())?.contains(&ADA)
    } else {
        let ada = scene(world, &geo, false)?;
        if world["speechVoices"][VALE] != json!([VALE]) {
            return None;
        }
        course_events(world, ada, &profiles, true)?;
        ada
    };
    let mut response = json!({"ok":true});
    response["world"] = opening_view::private_world(world, request)?;
    reply(response, profiles, ada, docked)
}
