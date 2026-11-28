use super::{
    authored_order::Order,
    create_geography::Geography,
    initial_wants::{People, Person},
    opening_content, opening_mirror_move, opening_roster, opening_station_move,
    opening_wait_response::vale_action,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    seed::hash,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const DAY: i64 = 48;
const SCATTER: i64 = 3;

fn entries(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn places(region: &Value) -> impl Iterator<Item = &Value> {
    region["places"]
        .as_object()
        .into_iter()
        .flat_map(|map| map.values())
}

pub(super) struct Residents<'a> {
    pub(super) people: People<'a>,
    pub(super) ships: BTreeSet<&'a str>,
}

impl<'a> Residents<'a> {
    pub(super) fn new(geo: &Geography<'a>) -> Option<Self> {
        Some(Self {
            people: People::new(geo.files(), geo.packs())?,
            ships: geo
                .packs()
                .flat_map(|pack| pack["transports"].as_object().into_iter().flatten())
                .filter_map(|(_, ship)| ship["place"].as_str())
                .collect(),
        })
    }
}

fn bedtime(seed: u64, id: &str, schedule: &Value, turn: i64) -> Option<Option<(i64, i64)>> {
    if schedule.is_null() {
        return Some(None);
    }
    let from = schedule["from"].as_i64()?;
    let to = schedule["to"].as_i64()?;
    if !(0..DAY).contains(&from) || !(0..DAY).contains(&to) {
        return None;
    }
    let scatter = |edge, day| {
        i64::from(hash(&format!("{seed}:{edge}:{id}:{day}"))) % (2 * SCATTER + 1) - SCATTER
    };
    let day = turn / DAY;
    Some([day - 1, day].into_iter().find_map(|day| {
        let start = day * DAY + from;
        let end = (day + i64::from(to <= from)) * DAY + to;
        if turn < start - SCATTER || turn >= end + SCATTER {
            return None;
        }
        let end = end + scatter("wake", day);
        if turn >= end {
            return None;
        }
        let start = start + scatter("sleep", day);
        (start <= turn).then_some((start, end))
    }))
}

pub(super) fn home<'a>(
    world: &Value,
    geo: &Geography<'a>,
    id: &str,
    person: &Person<'a>,
) -> Option<Option<&'a str>> {
    if person.pack == "hub" {
        return Some(person.data["home"].as_str());
    }
    if let Some(next) = person.data.get("homeWhen") {
        if geo.conditions_met(world, person.pack, &next["requires"], Some(id))? {
            return Some(Some(next["place"].as_str()?));
        }
    }
    Some(
        person.data["home"]
            .as_str()
            .or_else(|| person.data["place"].as_str()),
    )
}

fn seeks_home_when_tired(
    world: &Value,
    geo: &Geography<'_>,
    id: &str,
    person: &Person<'_>,
    human: bool,
) -> Option<bool> {
    if human {
        return Some(world["hidden"]["actor"] != id);
    }
    if person.pack == "hub" {
        return Some(id != "vale" && person.data["stops"].is_null());
    }
    let definition = person.data;
    let freed = definition["stayUntil"].is_array()
        && geo.conditions_met(world, person.pack, &definition["stayUntil"], Some(id))?;
    Some(
        id != "boardyai"
            && definition["journey"].is_null()
            && definition["personalQuests"] != true
            && !freed,
    )
}

fn sealed_home(world: &Value, geo: &Geography<'_>, here: &str, home: &str) -> Option<bool> {
    let forest = &geo.files()["v2/card-game/forest.json"];
    if entries(&geo.files()["v2/card-game/world-life.json"]["guardable"])
        .any(|edge| edge["from"] == home || edge["to"] == home)
        || entries(&forest["reflectionRoutes"]).any(|edge| edge["to"] == home)
        || std::iter::once(forest).chain(geo.packs()).any(|region| {
            places(region).any(|place| entries(&place["exits"]).any(|exit| exit == home))
                || entries(&region["crossings"]).any(|edge| edge["to"] == home)
                || region["transports"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, ship)| {
                        ship["place"] == home || entries(&ship["docks"]).any(|dock| dock == home)
                    })
        })
    {
        return Some(false);
    }
    for pack in geo.packs() {
        for route in entries(&pack["routes"]).filter(|route| route["to"] == home) {
            if entries(&route["requires"]).any(|condition| condition["kind"] != "flag")
                || geo.route_open(world, pack["id"].as_str()?, route)?
            {
                return Some(false);
            }
        }
    }
    let interior = geo.attic_interior()?;
    Some(!interior.contains(here) && !interior.contains(home))
}

pub(super) fn step_home(
    world: &Value,
    geo: &Geography<'_>,
    id: &str,
    here: &str,
    home: &str,
    residents: &Residents<'_>,
) -> Option<bool> {
    let pack = geo.resident_pack(id)?;
    if world["routeKnowledge"].get(id).is_some()
        || pack["places"].get(home).is_none()
        || pack["id"] == "elysium"
    {
        return None;
    }
    if !geo.entity_active(world, home)? {
        return Some(false);
    }
    if here == "station"
        || pack["places"].get(here).is_none()
        || !pack["avatars"][id]["journey"].is_null()
        || !entries(&pack["places"][here]["exits"]).any(|exit| exit == home)
        || residents.ships.contains(here)
        || residents.ships.contains(home)
    {
        return sealed_home(world, geo, here, home)?.then_some(false);
    }
    let guardable = &geo.files()["v2/card-game/world-life.json"]["guardable"];
    let on_lane = |edge: &&Value| edge["from"] == here && edge["to"] == home;
    if entries(guardable).any(|edge| on_lane(&edge) || (edge["from"] == home && edge["to"] == here))
        || geo.packs().any(|region| {
            entries(&region["routes"])
                .filter(on_lane)
                .any(|edge| entries(&edge["travelerRequires"]).next().is_some())
        })
    {
        return None;
    }
    Some(true)
}

fn no_seeking(world: &Value, person: &Person<'_>, id: &str, turn: i64) -> Option<()> {
    let actor = &world["actors"][id];
    if person.data["levelAtHome"] == true {
        if let Some(rank) = actor["level"].as_u64().map(u128::from) {
            if u128::from(actor["xp"].as_u64()?) >= rank * (rank + 1) / 2 {
                return None;
            }
        }
    }
    let want = &actor["want"];
    if want.is_null()
        || actor["metTurn"].as_i64().is_some_and(|met| {
            (turn - 2..=turn).contains(&met)
                && want["since"].as_i64().is_some_and(|since| since >= met)
        })
    {
        return Some(());
    }
    None
}

fn vale_only(seats: &Value) -> bool {
    seats
        .as_array()
        .is_some_and(|seats| seats.len() == 1 && seats[0] == "vale")
}

fn historic_round(world: &Value, expected: i64) -> Option<i64> {
    let turn = world["turn"].as_i64()?;
    if turn != expected
        || world["began"] != 480
        || !vale_only(&world["controlledActors"])
        || !vale_only(&world["presentActors"])
        || !world["standoffs"].as_array()?.is_empty()
    {
        return None;
    }
    Some(turn)
}

pub(super) fn historic_attic(world: &Value) -> Option<i64> {
    let turn = historic_round(world, 481)?;
    if world["actors"]["vale"]["place"] != "attic" {
        return None;
    }
    if world["items"]["lamp"]["holder"] != "vale" {
        super::opening_drop::grounding_committed(world)?;
    }
    Some(turn)
}

pub(super) fn historic_pond(world: &Value) -> Option<i64> {
    let turn = historic_round(world, 481)?;
    let arrival = &world["arrival"];
    let seq = arrival["seq"].as_u64()?;
    if world["actors"]["vale"]["place"] != "pond"
        || world["items"]["lamp"]["holder"] != "vale"
        || world["opening"]["crossed"] != true
        || arrival["locationId"] != "pond"
        || arrival["fromLocationId"] != "attic"
        || !world["log"].as_array()?.iter().any(|event| {
            event["seq"] == seq
                && event["turn"] == turn
                && event["actorId"] == "vale"
                && event["kind"] == "action"
                && event["verb"] == "move"
                && event["locationId"] == "pond"
                && event["fromLocationId"] == "attic"
        })
    {
        return None;
    }
    Some(turn)
}

fn quiet_historic_station(world: &Value) -> Option<(i64, u64)> {
    let turn = historic_round(world, 482)?;
    let arrival = opening_station_move::historic_arrival(world)?;
    let actors = world["actors"].as_object()?;
    if world["playerActorId"] != "vale"
        || !vale_only(&world["heldActors"])
        || actors.get("vale")?["visited"] != json!(["attic", "pond", "station"])
        || actors.get("keeper")?["place"] != "station"
        || world["items"]["lamp"]["holder"] != "vale"
        || world["eventSeq"] != arrival
    {
        return None;
    }
    Some((turn, arrival))
}

pub(super) fn sleeping_pip_at_pond(world: &Value, geo: &Geography<'_>, arrival: u64) -> Option<()> {
    let turn = world["turn"].as_i64()?;
    let prior_turn = turn.checked_sub(1)?;
    let pip = &world["actors"]["moth"];
    if pip["place"] != "pond"
        || pip["sleeping"]["since"] != prior_turn
        || pip["sleeping"]["place"] != "pond"
        || pip["sleeping"]["until"].as_i64()? <= turn
    {
        return None;
    }
    let log = world["log"].as_array()?;
    let pond = log.iter().find(|event| {
        vale_action(event)
            && event["turn"] == prior_turn
            && event["verb"] == "move"
            && event["locationId"] == "pond"
    })?["seq"]
        .as_u64()?;
    let name = geo.files()["v2/card-game/forest.json"]["people"]["moth"]["name"].as_str()?;
    let notice = format!("{name} falls asleep.");
    log.iter()
        .any(|event| {
            event["seq"]
                .as_u64()
                .is_some_and(|seq| pond < seq && seq < arrival)
                && event["turn"] == prior_turn
                && event["kind"] == "narration"
                && event["generated"] != true
                && event["actorId"] == "moth"
                && event["locationId"] == "pond"
                && event["text"] == notice
        })
        .then_some(())
}

pub(super) fn settle_station(
    world: &mut Value,
    geo: &Geography<'_>,
    residents: &Residents<'_>,
) -> Option<()> {
    let (turn, arrival) = quiet_historic_station(world)?;
    if geo.files()["v2/card-game/world-history.json"]["turns"] != world["began"] {
        return None;
    }
    sleeping_pip_at_pond(world, geo, arrival)?;
    for (id, actor) in world["actors"].as_object()? {
        if actor["place"] == "station"
            && !matches!(id.as_str(), "vale" | "keeper")
            && geo.entity_active(world, id)?
        {
            return None;
        }
    }
    settle_at(world, geo, residents, turn, "station", |_, _| None)
}

pub(super) fn verify_station_wake(world: &Value) -> Option<()> {
    quiet_historic_station(world)?;
    world["actors"]
        .as_object()?
        .values()
        .all(|actor| actor["sleeping"].is_null() || actor["sleeping"]["until"].is_i64())
        .then_some(())
}

pub(super) fn settle(
    world: &mut Value,
    geo: &Geography<'_>,
    residents: &Residents<'_>,
) -> Option<()> {
    let turn = historic_attic(world)?;
    settle_at(world, geo, residents, turn, "attic", |_, _| None)
}

pub(super) fn settle_pond(
    world: &mut Value,
    geo: &Geography<'_>,
    residents: &Residents<'_>,
    authored: &Order,
    order: &[&str],
    evidence: &ResidentEvidence,
) -> Option<()> {
    let turn = historic_pond(world)?;
    let bard = world["log"].as_array()?.last()?;
    if bard["seq"] != world["eventSeq"]
        || bard["seq"].as_u64()? <= world["arrival"]["seq"].as_u64()?
        || bard["turn"] != turn
        || bard["actorId"] != "greek-rhapsode"
        || bard["kind"] != "action"
        || bard["verb"] != "move"
    {
        return None;
    }
    settle_at(world, geo, residents, turn, "pond", |world, id| {
        if id != "moth" {
            return None;
        }
        let name = residents.people.people.get(id)?.data["name"].as_str()?;
        let cast = opening_roster::known_actors(world, geo, order, Some("pond"))?;
        let items = opening_mirror_move::pond_items(world, geo, authored)?;
        evidence.narrate_by(
            world,
            &cast,
            &items,
            Some(id),
            "pond",
            &format!("{name} falls asleep."),
        )
    })
}

fn settle_at(
    world: &mut Value,
    geo: &Geography<'_>,
    residents: &Residents<'_>,
    turn: i64,
    observed: &str,
    mut narrate_sleep: impl FnMut(&mut Value, &str) -> Option<()>,
) -> Option<()> {
    opening_roster::validate_arrivals(world)?;
    if world["sharedVersion"] != 1
        || !vale_only(&world["heldActors"])
        || !world["homecoming"].is_null()
    {
        return None;
    }
    let people = &residents.people;
    let seed = world["run"]["seed"].as_u64().unwrap_or(0);
    let default_schedule = &people.life["defaults"]["sleep"];
    for (&id, person) in &people.people {
        let human = people.humans.contains(id);
        if id == "vale"
            || person.data["roamingQuest"] == "latest-completion"
            || (human && !geo.visiting_resident(world, id))
        {
            continue;
        }
        let actor = world["actors"].get(id)?;
        let here = actor["place"].as_str()?;
        let sleeping = &actor["sleeping"];
        let wake = sleeping.get("until").is_some_and(|until| {
            until.as_i64().is_none_or(|until| until <= turn) || sleeping["place"] != here
        });
        let bedtime = if sleeping.is_null() && !residents.ships.contains(here) {
            let pack_schedule = &people.life["packs"][person.pack]["sleep"];
            let fallback = if human || pack_schedule.is_null() {
                default_schedule
            } else {
                pack_schedule
            };
            let schedule = people.life["residents"][id]
                .get("sleep")
                .unwrap_or(fallback);
            bedtime(seed, id, schedule, turn)?.filter(|(start, _)| actor["slept"] != *start)
        } else {
            None
        };
        if !wake && bedtime.is_none() && actor["homeward"] != true {
            continue;
        }
        if !geo.entity_active(world, id)? {
            continue;
        }
        let home = home(world, geo, id, person)?;
        let at_home = home == Some(here);
        let clear_homeward = at_home && actor["homeward"] == true;
        if wake {
            sleeping["until"].as_i64()?;
            if here == observed {
                return None;
            }
            world["actors"][id].as_object_mut()?.remove("sleeping");
        } else if let Some((start, end)) = bedtime {
            if let Some(home) = home.filter(|_| !at_home) {
                if seeks_home_when_tired(world, geo, id, person, human)? {
                    if step_home(world, geo, id, here, home, residents)? {
                        no_seeking(world, person, id, turn)?;
                        world["actors"][id]["homeward"] = json!(true);
                    }
                    continue;
                }
            }
            let visible = here == observed;
            let sleep = json!({"since":turn,"place":here,"until":end});
            world["actors"][id]["slept"] = json!(start);
            world["actors"][id]["sleeping"] = sleep;
            if visible {
                narrate_sleep(world, id)?;
            }
        }
        if clear_homeward {
            world["actors"][id].as_object_mut()?.remove("homeward");
        }
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle(&mut world, &geo, &Residents::new(&geo)?)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}

pub(super) fn pond_projection(request: &Value) -> Option<Value> {
    let before = request.get("world")?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let residents = Residents::new(&geo)?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = before.clone();
    settle_pond(&mut world, &geo, &residents, &authored, &order, &evidence)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}

pub(super) fn station_projection(request: &Value) -> Option<Value> {
    let mut world = request.get("world")?.clone();
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    settle_station(&mut world, &geo, &Residents::new(&geo)?)?;
    Some(json!({"ok":true,"world":world}))
}

pub(super) fn station_wake_projection(request: &Value) -> Option<Value> {
    let world = request.get("world")?;
    verify_station_wake(world)?;
    Some(json!({"ok":true,"world":world}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_grounded_lamp_needs_vales_first_committed_drop() {
        let mut world = json!({
            "turn":481, "began":480, "standoffs":[],
            "controlledActors":["vale"], "presentActors":["vale"],
            "actors":{"vale":{"place":"attic","heldItem":null}},
            "items":{"lamp":{"holder":"attic"}}, "log":[]
        });
        assert_eq!(historic_attic(&world), None);
        world["log"] = json!([{
            "kind":"action", "actorId":"vale", "verb":"drop", "turn":481,
            "itemId":"lamp", "locationId":"attic",
            "fromLocationId":"attic", "targetId":"attic"
        }]);
        assert_eq!(historic_attic(&world), Some(481));
        world["actors"]["vale"]["heldItem"] = json!("lamp");
        assert_eq!(historic_attic(&world), None);
    }
}
