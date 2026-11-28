use super::{
    create,
    create_geography::Geography,
    initial_wants::{self, People, Person},
    opening_rumours,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

struct Context<'a> {
    pub active: BTreeSet<&'a str>,
    pub regions: BTreeMap<&'a str, &'a str>,
    forest: &'a Value,
    authored: BTreeMap<(&'a str, &'a str), bool>,
}

type Pool<'a> = BTreeSet<(&'static str, &'a str)>;

fn member(array: &Value, key: &str) -> bool {
    array
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value == key))
}

pub(super) fn fill(
    world: &mut Value,
    geo: &Geography,
    people: &People,
    files: &Value,
) -> Option<()> {
    let forest = files.get("v2/card-game/forest.json")?;
    let mut context = Context {
        active: BTreeSet::new(),
        regions: people
            .people
            .iter()
            .map(|(&id, person)| (id, person.pack))
            .collect(),
        authored: create::authored_edges(forest, geo.packs())?,
        forest,
    };
    for &id in people.people.keys() {
        if geo.entity_active(world, id)? {
            context.active.insert(id);
        }
    }
    for region in std::iter::once(forest).chain(geo.packs()) {
        for field in ["things", "items", "places"] {
            for id in region[field]
                .as_object()
                .into_iter()
                .flat_map(|entries| entries.keys())
            {
                if geo.entity_active(world, id)? {
                    context.active.insert(id);
                }
            }
        }
    }
    let turn = world["turn"].as_u64()?;
    for (&id, person) in &people.people {
        if id == "vale"
            || person.data["wants"] == false
            || !context.active.contains(id)
            || !world["actors"][id]["want"].is_null()
            || world["actors"][id]["completedQuest"].is_object()
            || model_waiting(world, id)
        {
            continue;
        }
        if let Some(staged) = person.staged(world, id, geo)? {
            world["actors"][id]["want"] = staged;
            world["actors"][id].as_object_mut()?.remove("content");
            continue;
        }
        let (range, roams) = resident_range(world, people, id, person, geo)?;
        if let Some(heard) = opening_rumours::heard(
            world,
            id,
            &context.active,
            &context.regions,
            person.data["want"]["kind"].as_str(),
            roams,
        )? {
            world["actors"][id]["heardOn"] = serde_json::json!(turn / 48);
            world["actors"][id]["want"] = heard;
            world["actors"][id].as_object_mut()?.remove("content");
            continue;
        }
        let here = world["actors"][id]["place"].as_str()?.to_owned();
        let home = person.data["home"]
            .as_str()
            .or_else(|| person.data["place"].as_str())
            .unwrap_or(&here);
        let allowed = range.map(|limit| context.places_within(home, limit));
        let reaches = if roams {
            reachable(world, geo, &context, id, &here, allowed.as_ref())?
        } else {
            BTreeSet::new()
        };
        let (pick, reset) = pick_want(
            world,
            geo,
            &context,
            id,
            person,
            &here,
            &reaches,
            allowed.as_ref(),
        )?;
        if reset {
            world["actors"][id]["visited"] = serde_json::json!([here]);
            world["actors"][id]["talked"] = serde_json::json!([]);
        }
        if let Some(want) = pick {
            world["actors"][id]["want"] = want;
            world["actors"][id].as_object_mut()?.remove("content");
        }
    }
    Some(())
}

fn model_waiting(world: &Value, id: &str) -> bool {
    matches!(
        id,
        "elysium-claude"
            | "elysium-gemini"
            | "elysium-chatgpt"
            | "elysium-grok"
            | "elysium-deepseek"
            | "elysium-qwen"
    ) && world["elysiumEncounters"][id]["portraitReady"] != true
}

fn resident_range(
    world: &Value,
    people: &People,
    id: &str,
    person: &Person,
    geo: &Geography,
) -> Option<(Option<u64>, bool)> {
    let travels = people.humans.contains(id)
        || (person.pack == "hub" && person.data["travels"] != false)
        || id == "boardyai"
        || person.data["roamingQuest"] == "latest-completion"
        || person.data["personalQuests"] == true
        || (person.data["stayUntil"].is_array()
            && geo.conditions_met(world, person.pack, &person.data["stayUntil"], Some(id))?);
    if travels || person.pack == "hub" || person.data["journey"].is_object() {
        return Some((None, travels));
    }
    let range = if person.data["travels"] == false {
        0
    } else {
        people.life["residents"][id]["range"]
            .as_u64()
            .or_else(|| people.life["defaults"]["range"].as_u64())?
    };
    Some((Some(range), range > 0))
}

impl<'a> Context<'a> {
    fn places_within(&self, from: &str, limit: u64) -> BTreeSet<String> {
        let mut found = BTreeSet::from([from.to_owned()]);
        let mut queue = VecDeque::from([(from.to_owned(), 0)]);
        while let Some((here, distance)) = queue.pop_front() {
            if distance == limit {
                continue;
            }
            for &(start, end) in self.authored.keys() {
                if start == here && found.insert(end.into()) {
                    queue.push_back((end.into(), distance + 1));
                }
            }
        }
        found
    }
}

fn reachable<'a>(
    world: &Value,
    geo: &Geography,
    context: &Context<'a>,
    actor: &str,
    here: &str,
    allowed: Option<&BTreeSet<String>>,
) -> Option<BTreeSet<&'a str>> {
    let mut found = BTreeSet::new();
    let mut queue = VecDeque::from([here]);
    while let Some(from) = queue.pop_front() {
        for (&(start, end), &retired) in &context.authored {
            if start != from
                || retired
                || end == here
                || !context.active.contains(end)
                || allowed.is_some_and(|places| !places.contains(end))
            {
                continue;
            }
            let base = geo.base_exits(from)?.iter().any(|id| id == end);
            if !base && !geo.pack_route_open(world, from, end)? {
                for pack in geo.packs() {
                    for crossing in pack["crossings"].as_array()? {
                        if crossing["from"] == from
                            && crossing["to"] == end
                            && crossing["travelers"] != "player"
                            && geo.conditions_met(
                                world,
                                pack["id"].as_str()?,
                                &crossing["requires"],
                                Some(actor),
                            )?
                        {
                            return None;
                        }
                    }
                }
                continue;
            }
            if found.insert(end) {
                queue.push_back(end);
            }
        }
    }
    Some(found)
}

#[allow(clippy::too_many_arguments)]
fn pick_want<'a>(
    world: &Value,
    geo: &Geography,
    context: &Context<'a>,
    actor: &str,
    person: &Person,
    here: &str,
    reach: &BTreeSet<&str>,
    allowed: Option<&BTreeSet<String>>,
) -> Option<(Option<Value>, bool)> {
    let me = &world["actors"][actor];
    let items = world["items"].as_object()?;
    let mut held = Vec::new();
    let mut floor = i64::MAX;
    for id in items.keys() {
        if initial_wants::root(world, id)? == actor {
            floor = floor.min(value_of(world, geo, context, actor, person, id)?);
            held.push(id.as_str());
        }
    }
    if held.is_empty() {
        floor = 1;
    }
    let turn = world["turn"].as_u64()?;
    let mut range = Pool::new();
    for &id in &context.active {
        if me["gaveUp"]["target"] == id && turn.saturating_sub(me["gaveUp"]["turn"].as_u64()?) < 24
        {
            continue;
        }
        if context.regions.contains_key(id) && id != actor {
            range.insert(("person", id));
        } else if reach.contains(id) {
            range.insert(("place", id));
        } else if items.contains_key(id)
            && value_of(world, geo, context, actor, person, id)? > floor
        {
            let holder = initial_wants::root(world, id)?;
            let own_want = &world["actors"][holder]["want"];
            if holder != actor
                && context.regions.contains_key(holder)
                && (own_want["kind"] != "item" || own_want["target"] != id)
            {
                range.insert(("item", id));
            }
        }
    }
    let mut near = Pool::new();
    let mut refreshed = Pool::new();
    let mut wide = Pool::new();
    for &(kind, id) in &range {
        let place = match kind {
            "person" => world["actors"][id]["place"].as_str()?,
            "item" => world["actors"][initial_wants::root(world, id)?]["place"].as_str()?,
            _ => id,
        };
        if allowed.is_some_and(|a| !a.contains(place)) {
            continue;
        }
        wide.insert((kind, id));
        if place != here && !reach.contains(place) {
            continue;
        }
        if kind == "item"
            && world["items"][id]["holder"] != "vale"
            && world["actors"]
                .get(world["items"][id]["holder"].as_str()?)
                .is_some()
        {
            return None;
        }
        if kind == "place" && id == here {
            continue;
        }
        refreshed.insert((kind, id));
        if !(kind == "place" && member(&me["visited"], id)
            || kind == "person" && member(&me["talked"], id))
        {
            near.insert((kind, id));
        }
    }
    let reset = near.is_empty();
    let pool = [near, refreshed, wide, range]
        .into_iter()
        .find(|pool| !pool.is_empty());
    let Some(pool) = pool else {
        return Some((None, reset));
    };
    let roll = initial_wants::run_hash(world, &format!("want:{actor}:{turn}"));
    let index = roll as usize % pool.len();
    let (kind, target) = pool.into_iter().nth(index)?;
    Some((Some(initial_wants::simple_want(kind, target, turn)), reset))
}

fn value_of(
    world: &Value,
    geo: &Geography,
    context: &Context,
    actor: &str,
    person: &Person,
    item: &str,
) -> Option<i64> {
    let mut value = person.data["values"][item].as_i64().unwrap_or(1);
    for pack in geo.packs() {
        if pack["items"][item]["reservedUntil"].is_array()
            && !geo.conditions_met(
                world,
                pack["id"].as_str()?,
                &pack["items"][item]["reservedUntil"],
                None,
            )?
        {
            return Some(1);
        }
        if pack["id"] == person.pack {
            value = pack["values"][actor][item].as_i64().unwrap_or(value);
        }
    }
    let rules = context.forest["things"][item]["valueRules"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(
            person.data["valueRules"][item]
                .as_array()
                .into_iter()
                .flatten(),
        );
    for rule in rules {
        let mut holds = true;
        for fact in rule["when"].as_array()? {
            if let Some(held) = fact["holds"].as_str() {
                holds &= initial_wants::root(world, held)? == actor;
            } else {
                let number = world["items"][fact["item"].as_str()?][fact["field"].as_str()?]
                    .as_i64()
                    .unwrap_or(0);
                holds &= fact["min"].as_i64().is_none_or(|min| number >= min)
                    && fact["max"].as_i64().is_none_or(|max| number <= max);
            }
        }
        if holds {
            if let Some(fixed) = rule["set"].as_i64() {
                return Some(fixed);
            }
            value += rule["add"].as_i64()?;
        }
    }
    Some(value.max(1))
}
