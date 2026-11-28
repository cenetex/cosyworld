use super::{
    create_geography::Geography, initial_wants::People, opening, opening_candidates::RoundDraws,
    opening_company, opening_content, opening_mirror_move, opening_play, opening_resident_sleep,
    opening_stale_wants, opening_station_move, opening_station_read, opening_station_view,
    opening_wait_response::vale_action, pack_state::Catalog,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

fn array(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

struct Loss<'a> {
    items: BTreeMap<&'a str, &'a Value>,
    drops: BTreeSet<&'a str>,
    gone: &'a Value,
}

impl<'a> Loss<'a> {
    fn new(world: &'a Value, geo: &Geography<'a>) -> Option<Self> {
        if world["packs"].as_object()?.values().any(|state| {
            state["receipts"]
                .as_object()
                .is_some_and(|entries| !entries.is_empty())
        }) {
            return None;
        }
        let used_up = world["usedUp"].as_array()?;
        let mut items = BTreeMap::new();
        let mut drops = BTreeSet::new();
        for pack in geo.packs() {
            for id in used_up {
                let id = id.as_str()?;
                if let Some(thing) = pack["items"].get(id) {
                    items.insert(id, thing);
                }
            }
            for choice in array(&pack["choices"]).filter(|choice| choice["archived"] != true) {
                for effect in
                    array(&choice["effects"]).filter(|effect| effect["kind"] == "drop_item")
                {
                    if used_up.contains(&effect["item"]) {
                        drops.insert(effect["item"].as_str()?);
                    }
                }
            }
        }
        Some(Self {
            items,
            drops,
            gone: &world["gone"],
        })
    }

    fn forever(&self, mut id: &'a str) -> Option<bool> {
        let mut seen = BTreeSet::new();
        while seen.insert(id) {
            if array(self.gone).any(|entry| entry == id) {
                return Some(true);
            }
            let Some(thing) = self.items.get(id) else {
                return Some(false);
            };
            if let Some(lock) = thing.get("locked") {
                id = lock["by"].as_str()?;
            } else {
                return Some(
                    !(thing["home"].is_string() && thing["regrow"].is_string())
                        && !self.drops.contains(id),
                );
            }
        }
        None
    }

    fn check(&self, want: &'a Value) -> Option<()> {
        let step = &want["step"];
        let references = [&want["target"], &step["to"], &step["with"], &step["at"]]
            .into_iter()
            .chain(array(&step["items"]))
            .filter_map(Value::as_str);
        for id in references {
            if self.forever(id)? {
                return None;
            }
        }
        Some(())
    }
}

fn player_want(want: &Value) -> Option<()> {
    let step = &want["step"];
    if step.is_null() || want["quest"] == true || want["story"] == true {
        return Some(());
    }
    let talk = (want["kind"] == "item" && step["verb"] == "give" && !step["to"].is_null())
        || (want["kind"] == "person" && (step["verb"] == "bring" || !step["to"].is_null()));
    (!talk).then_some(())
}

pub(super) fn settle_first_wait(world: &mut Value, geo: &Geography) -> Option<()> {
    settle_with(world, geo, |_| Some(()))
}

pub(super) fn settle_with(
    world: &mut Value,
    geo: &Geography,
    fade_trust: impl FnOnce(&mut Value) -> Option<()>,
) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    let first_pond_move = world["actors"]["vale"]["place"] == "pond"
        && world["arrival"]["fromLocationId"] == "attic"
        && world["arrival"]["locationId"] == "pond"
        && world["items"]["lamp"]["holder"] == "vale";
    if began.checked_add(1)? != turn
        || (began != 0 && geo.files()["v2/card-game/world-history.json"]["turns"] != began)
        || (world["actors"]["vale"]["place"] != "attic" && !first_pond_move)
        || !world["elysiumEncounters"].is_null()
        || world["sharedVersion"] != 1
        || ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .any(|key| {
                world
                    .get(key)
                    .is_some_and(|seats| seats != &json!(["vale"]))
            })
        || world
            .get("playerActorId")
            .is_some_and(|actor| actor != "vale")
    {
        return None;
    }
    settle_wants(world, geo, turn, first_pond_move, began != 0, fade_trust)
}

fn settle_wants(
    world: &mut Value,
    geo: &Geography,
    turn: u64,
    allow_lamp_refusal: bool,
    historic: bool,
    fade_trust: impl FnOnce(&mut Value) -> Option<()>,
) -> Option<()> {
    let loss = Loss::new(world, geo)?;
    let actors = world["actors"].as_object()?;
    let mut retime = Vec::new();
    let mut expired = Vec::new();
    for (id, actor) in actors {
        if let Some(from) = actor["offered"]["from"].as_str() {
            if world["actors"][from]["place"] != actor["place"] {
                expired.push(id.clone());
            }
        }
        let want = &actor["want"];
        if want.is_null() {
            continue;
        }
        want["since"].as_u64()?;
        if want["kind"] == "item"
            && want["refusals"].as_u64()? != 0
            && !(allow_lamp_refusal
                && id == "moth"
                && want["target"] == "lamp"
                && want["refusals"] == 1)
        {
            return None;
        }
        if opening::is_seat(id) {
            for held in std::iter::once(want).chain(array(&actor["under"])) {
                loss.check(held)?;
                if id == "vale" {
                    player_want(held)?;
                }
            }
        }
        if id != "vale" {
            if !geo.entity_active(world, id)? {
                retime.push(id.clone());
            } else if !opening::is_seat(id) {
                loss.check(want)?;
            }
        }
    }
    let actors = world["actors"].as_object_mut()?;
    for id in retime {
        actors.get_mut(&id)?["want"]["since"] = json!(turn);
    }
    let mut draws = RoundDraws::default();
    let people = if historic {
        let people = People::new(geo.files(), geo.packs())?;
        opening_stale_wants::revise(world, geo, &people, turn, &mut draws)?;
        Some(people)
    } else {
        None
    };
    fade_trust(world)?;
    for id in expired {
        world["actors"]
            .get_mut(&id)?
            .as_object_mut()?
            .remove("offered");
    }
    if let Some(people) = &people {
        opening_stale_wants::fill_due(world, geo, people, turn, &mut draws)?;
        let loss = Loss::new(world, geo)?;
        for (id, actor) in world["actors"].as_object()? {
            let want = &actor["want"];
            if want["since"] == turn && geo.entity_active(world, id)? {
                loss.check(want)?;
            }
        }
    }
    for actor in world["actors"].as_object_mut()?.values_mut() {
        if !actor["want"].is_null() {
            actor.as_object_mut()?.remove("content");
        }
    }
    Some(())
}

pub(super) fn settle_second_attic(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    opening_play::second_attic_plays(world)?;
    settle_wants(world, geo, 2, false, false, opening_company::fade_trust)
}

pub(super) fn settle_second_pond(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    opening_mirror_move::second_arrival(world)?;
    if world["actors"]["vale"].get("want") != Some(&Value::Null)
        || world["actors"]["moth"]["place"] != "pond"
        || world["items"]["lamp"]["holder"] != "vale"
        || !world["elysiumEncounters"].is_null()
    {
        return None;
    }
    settle_wants(world, geo, 2, true, false, opening_company::fade_trust)
}

fn pip_wants_lamp(world: &Value) -> bool {
    world["actors"]["moth"]["want"]
        == json!({"kind":"item", "target":"lamp", "since":0, "refusals":1, "lit":true})
}

pub(super) fn verify_awake_station(world: &Value, geo: &Geography<'_>) -> Option<()> {
    let follow_seq = opening_station_move::historic_follow(world)?;
    let log = world["log"].as_array()?;
    let follow_index = log.iter().position(|event| event["seq"] == follow_seq)?;
    let follow = &log[follow_index];
    let [remote @ .., wake] = log.get(follow_index + 1..)? else {
        return None;
    };
    let turn = world["turn"].as_u64()?;
    let pip = &world["actors"]["moth"];
    let keeper = &world["actors"]["keeper"];
    let name = geo.files()["v2/card-game/forest.json"]["people"]["keeper"]["name"].as_str()?;
    if !pip["sleeping"].is_null()
        || pip["visited"] != json!(["pond", "station"])
        || pip["heldItem"] != "cloth"
        || world["items"]["cloth"]["holder"] != "moth"
        || !keeper["sleeping"].is_null()
        || keeper["place"] != "station"
        || wake["seq"] != world["eventSeq"]
        || wake["seq"] != follow_seq.checked_add(remote.len() as u64 + 1)?
        || wake["turn"] != turn
        || wake["kind"] != "narration"
        || wake["generated"] == true
        || wake["actorId"] != "keeper"
        || wake["locationId"] != "station"
        || wake["text"] != format!("{name} wakes.")
        || wake["cast"] != follow["cast"]
        || wake["light"] != false
        || !wake["witnesses"].is_null()
    {
        return None;
    }
    match remote {
        [] => Some(()),
        [cass]
            if cass["seq"] == follow_seq.checked_add(1)?
                && cass["turn"] == turn
                && cass["kind"] == "action"
                && cass["generated"] != true
                && cass["actorId"] == "orin"
                && cass["verb"] == "move"
                && cass["fromLocationId"] == "pavilion"
                && cass["locationId"] == "willows-bank"
                && cass["targetId"] == "willows-bank"
                && cass["witnesses"] == json!(["orin", "board"])
                && cass["itemId"].is_null()
                && world["actors"]["orin"]["place"] == "willows-bank" =>
        {
            Some(())
        }
        _ => None,
    }
}

fn station_wants_state(world: &Value, pip_place: &str, vale_want: &Value) -> Option<()> {
    if world["actors"]["vale"].get("want") != Some(vale_want)
        || world["actors"]["moth"]["place"] != pip_place
        || world["actors"]["keeper"]["place"] != "station"
        || world["items"]["lamp"]["holder"] != "vale"
        || !world["elysiumEncounters"].is_null()
        || world["playerActorId"] != "vale"
        || ["heldActors", "presentActors", "controlledActors"]
            .iter()
            .any(|key| world[*key] != json!(["vale"]))
    {
        return None;
    }
    Some(())
}

pub(super) fn settle_station(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    let historic = world.get("began").is_some();
    let pip_place = if historic {
        let seq = opening_station_move::historic_arrival(world)?;
        if geo.files()["v2/card-game/world-history.json"]["turns"] != world["began"]
            || !pip_wants_lamp(world)
        {
            return None;
        }
        if world["actors"]["moth"]["place"] == "station" {
            verify_awake_station(world, geo)?;
            "station"
        } else {
            opening_resident_sleep::sleeping_pip_at_pond(world, geo, seq)?;
            "pond"
        }
    } else {
        opening_station_move::arrival(world)
            .or_else(|| opening_station_move::abandoned_train_arrival(world))
            .or_else(|| opening_station_view::keeper_abandon_head(world))?;
        "station"
    };
    station_wants_state(world, pip_place, &Value::Null)?;
    settle_wants(
        world,
        geo,
        turn,
        true,
        historic,
        opening_company::fade_trust,
    )
}

pub(super) fn settle_station_read(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let seq = opening_station_read::after_first_log(world)?;
    let next = seq.checked_add(1)?;
    let [.., read, wait] = world["log"].as_array()?.as_slice() else {
        return None;
    };
    let cast = wait["cast"].as_array()?;
    let witnesses = wait["witnesses"].as_array()?;
    let known = &world["knowledge"]["known"]["vale"];
    let name = geo.files()["v2/card-game/forest.json"]["people"]["moth"]["name"].as_str()?;
    if world["eventSeq"] != next
        || read["seq"] != seq
        || wait["seq"] != next
        || wait["turn"] != 3
        || wait["kind"] != "action"
        || wait["generated"] == true
        || wait["actorId"] != "moth"
        || wait["verb"] != "wait"
        || wait["locationId"] != "station"
        || wait["text"] != format!("{name} waits one turn.")
        || ["sleep", "guards", "itemId", "targetId", "fromLocationId"]
            .iter()
            .any(|field| !wait[*field].is_null())
        || ["cast", "witnesses", "items", "light"]
            .iter()
            .any(|field| read[*field] != wait[*field])
        || cast.len() != 3
        || ["vale", "moth", "keeper"]
            .iter()
            .any(|id| !cast.iter().any(|actor| actor == *id))
        || ["vale", "moth", "keeper", "keeper-log"]
            .iter()
            .any(|id| !witnesses.iter().any(|witness| witness == *id))
        || ["claim:hub:keeper-log:pond-signal", "quest:keeper:pond"]
            .iter()
            .any(|id| {
                known[*id]["kind"] != "read"
                    || known[*id]["book"] != "keeper-log"
                    || known[*id]["eventSeq"] != seq
                    || known[*id]["learnedTurn"] != 3
            })
        || !world["standoffs"].as_array()?.is_empty()
        || !world["actors"]["moth"]["sleeping"].is_null()
        || !pip_wants_lamp(world)
    {
        return None;
    }
    station_wants_state(world, "station", &Value::Null)?;
    settle_wants(world, geo, 3, true, false, opening_company::fade_trust)
}

pub(super) fn station_departure_turn(
    before: &Value,
    world: &Value,
    geo: &Geography<'_>,
) -> Option<u64> {
    let to = world["arrival"]["locationId"].as_str()?;
    let (turn, want) = match (before["turn"].as_u64()?, to) {
        (2, "behind-station") => {
            opening_station_move::arrival(before)?;
            (3, Value::Null)
        }
        (3, "pond") => (4, opening_station_read::keeper_want(before, geo)?),
        _ => return None,
    };
    station_wants_state(world, "station", &want)?;
    let seq = before["eventSeq"].as_u64()?.checked_add(1)?;
    let (event, earlier) = world["log"].as_array()?.split_last()?;
    if world["turn"] != turn
        || world["revision"] != before["revision"].as_u64()?.checked_add(1)?
        || world["eventSeq"] != seq
        || world["arrival"] != json!({"seq":seq,"fromLocationId":"station","locationId":to})
        || earlier != before["log"].as_array()?.as_slice()
        || event["seq"] != seq
        || event["turn"] != turn
        || !vale_action(event)
        || event["verb"] != "move"
        || event["fromLocationId"] != "station"
        || event["targetId"] != to
        || event["locationId"] != to
        || !(event["itemId"].is_null() || event["itemId"] == "lamp")
        || before["actors"]["vale"].get("want") != Some(&want)
        || before["items"]["lamp"]["holder"] != "vale"
        || world["actors"]["vale"]["place"] != to
        || !world["actors"]["moth"]["sleeping"].is_null()
        || !pip_wants_lamp(world)
        || !geo.base_exits("station")?.iter().any(|exit| exit == to)
    {
        return None;
    }
    Some(turn)
}

pub(super) fn settle_station_departure(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
) -> Option<()> {
    let turn = station_departure_turn(before, world, geo)?;
    settle_wants(world, geo, turn, true, false, opening_company::fade_trust)
}

pub(super) fn round_projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    match request["op"].as_str()? {
        "opening_second_attic_wants" => settle_second_attic(&mut world, &geo)?,
        "opening_second_pond_wants" => settle_second_pond(&mut world, &geo)?,
        "opening_station_wants" => settle_station(&mut world, &geo)?,
        "opening_station_read_wants" => settle_station_read(&mut world, &geo)?,
        "opening_station_departure_wants" => {
            settle_station_departure(request.get("before")?, &mut world, &geo)?
        }
        _ => return None,
    }
    Some(json!({"ok":true, "world":world}))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let world = opening::supported_world(request)?;
    let action = &request["action"];
    if request["actor"] != "vale"
        || opening::seats(&request["claimed"])? != ["vale"]
        || opening::seats(&request["present"])? != ["vale"]
        || opening::unplayed_turn(world)? != 0
        || action["kind"] == "pack"
        || action.as_str().or_else(|| action["key"].as_str()) != Some("wait:vale::")
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || !request["selectedIds"].is_null()
    {
        return None;
    }
    let files = opening_play::attic_files(world, request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut next = world.clone();
    next["turn"] = json!(1);
    settle_first_wait(&mut next, &geo)?;
    projected(&next, false)
}

pub(super) fn history_projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut next = request.get("world")?.clone();
    if next.get("began")?.as_u64()? == 0 {
        return None;
    }
    settle_first_wait(&mut next, &geo)?;
    projected(&next, true)
}

fn projected(world: &Value, history: bool) -> Option<Value> {
    let wants: Map<_, _> = world["actors"]
        .as_object()?
        .iter()
        .map(|(id, actor)| {
            let mut projected = Map::new();
            let fields = ["want", "under", "content", "gaveUp", "heardOn", "offered"];
            let traversal = history
                .then_some(["visited", "talked"])
                .into_iter()
                .flatten();
            for field in fields.into_iter().chain(traversal) {
                if let Some(value) = actor.get(field) {
                    projected.insert(field.to_owned(), value.clone());
                }
            }
            (id.clone(), Value::Object(projected))
        })
        .collect();
    Some(json!({"ok":true,"wants":wants}))
}
