use super::{
    create,
    create_geography::Geography,
    initial_wants::{self, People, Person},
    opening_rumours, opening_visitor_routes,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

struct Context<'a> {
    pub active: BTreeSet<&'a str>,
    pub regions: BTreeMap<&'a str, &'a str>,
    items: BTreeMap<&'a str, Item<'a>>,
    hands: BTreeMap<String, Vec<&'a str>>,
    pack_values: BTreeMap<&'a str, &'a Value>,
    authored: BTreeMap<&'a str, Vec<(&'a str, bool)>>,
    active_people: Vec<(&'a str, Option<String>)>,
    carried_items: Vec<&'a str>,
    current_places: BTreeMap<&'a str, String>,
}

struct Item<'a> {
    root: String,
    rules: &'a Value,
    reserved: Option<bool>,
}

type Pool<'a> = Vec<(&'static str, &'a str)>;

enum Draw<'a> {
    Opening,
    Due,
    Stalled(&'a BTreeSet<&'a str>),
}

fn member(array: &Value, key: &str) -> bool {
    array
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value == key))
}

pub(super) fn fill(world: &mut Value, geo: &Geography, people: &People) -> Option<()> {
    let context = prepare(world, geo, people)?;
    choose(world, geo, people, &context, Draw::Opening)
}

#[derive(Default)]
pub(super) struct RoundDraws<'a>(Option<Context<'a>>);

impl<'a> RoundDraws<'a> {
    pub(super) fn replace(
        &mut self,
        world: &mut Value,
        geo: &Geography<'a>,
        people: &People<'a>,
        stalled: &BTreeSet<&str>,
    ) -> Option<()> {
        let context = self.context(world, geo, people)?;
        choose(world, geo, people, context, Draw::Stalled(stalled))
    }

    pub(super) fn fill_due(
        &mut self,
        world: &mut Value,
        geo: &Geography<'a>,
        people: &People<'a>,
    ) -> Option<()> {
        let context = self.context(world, geo, people)?;
        choose(world, geo, people, context, Draw::Due)
    }

    fn context(
        &mut self,
        world: &Value,
        geo: &Geography<'a>,
        people: &People<'a>,
    ) -> Option<&Context<'a>> {
        if self.0.is_none() {
            self.0 = Some(prepare(world, geo, people)?);
        }
        self.0.as_ref()
    }
}

fn prepare<'a>(world: &Value, geo: &Geography<'a>, people: &People<'a>) -> Option<Context<'a>> {
    let forest = geo.files().get("v2/card-game/forest.json")?;
    let mut authored = BTreeMap::<_, Vec<_>>::new();
    for ((from, to), retired) in create::authored_edges(forest, geo.packs())? {
        authored.entry(from).or_default().push((to, retired));
    }
    let mut context = Context {
        active: BTreeSet::new(),
        regions: people
            .people
            .iter()
            .map(|(&id, person)| (id, person.pack))
            .collect(),
        authored,
        items: BTreeMap::new(),
        hands: BTreeMap::new(),
        pack_values: BTreeMap::new(),
        active_people: Vec::new(),
        carried_items: Vec::new(),
        current_places: BTreeMap::new(),
    };
    let actors = world["actors"].as_object()?;
    for &id in people.people.keys() {
        if let Some(place) = actors.get(id).and_then(|actor| actor["place"].as_str()) {
            context.current_places.insert(id, place.to_owned());
        }
        if geo.entity_active(world, id)? {
            context.active.insert(id);
        }
    }
    for region in std::iter::once(forest).chain(geo.packs()) {
        let pack = region["id"].as_str().unwrap_or("hub");
        context.pack_values.insert(pack, &region["values"]);
        for field in ["things", "items", "places"] {
            for (id, definition) in region[field].as_object().into_iter().flatten() {
                let active = if field == "places" {
                    geo.entity_active(world, id)?
                } else {
                    let root = initial_wants::root(world, id)?;
                    let active = geo.item_active_at_root(world, id, root)?;
                    if context.regions.contains_key(root) {
                        context.hands.entry(root.to_owned()).or_default().push(id);
                    }
                    let reserved = &definition["reservedUntil"];
                    let reserved = if reserved.as_array().is_some_and(|terms| !terms.is_empty()) {
                        geo.conditions_met(world, pack, reserved, None)
                            .map(|open| !open)
                    } else {
                        Some(false)
                    };
                    let rules = if field == "things" {
                        &definition["valueRules"]
                    } else {
                        &Value::Null
                    };
                    context.items.insert(
                        id,
                        Item {
                            root: root.to_owned(),
                            rules,
                            reserved,
                        },
                    );
                    active
                };
                if active {
                    context.active.insert(id);
                }
            }
        }
    }
    context.active_people = context
        .regions
        .keys()
        .copied()
        .filter(|id| context.active.contains(id))
        .map(|id| (id, context.current_places.get(id).cloned()))
        .collect();
    context.carried_items = context
        .items
        .iter()
        .filter_map(|(&id, item)| {
            (context.active.contains(id) && context.regions.contains_key(item.root.as_str()))
                .then_some(id)
        })
        .collect();
    Some(context)
}

fn choose(
    world: &mut Value,
    geo: &Geography,
    people: &People,
    context: &Context,
    draw: Draw<'_>,
) -> Option<()> {
    let turn = world["turn"].as_u64()?;
    for (&id, person) in &people.people {
        if id == "vale" || person.data["wants"] == false || !context.active.contains(id) {
            continue;
        }
        let actor = &world["actors"][id];
        let replacing = match draw {
            Draw::Stalled(ids) if ids.contains(id) => true,
            Draw::Stalled(_) => continue,
            Draw::Opening | Draw::Due => {
                if !actor["want"].is_null()
                    || actor["completedQuest"].is_object()
                    || (matches!(draw, Draw::Due)
                        && turn.saturating_sub(actor["metTurn"].as_u64().unwrap_or(0)) < 24)
                {
                    continue;
                }
                false
            }
        };
        let previous = replacing.then(|| world["actors"][id]["want"].clone());
        if let Some(previous) = &previous {
            let target = previous["target"].as_str()?;
            world["actors"][id]["gaveUp"] = serde_json::json!({"target":target,"turn":turn});
        }
        if super::elysium::model_waiting(world, id) {
            if replacing {
                world["actors"][id]["want"] = Value::Null;
            }
            continue;
        }
        if let Some(staged) = person.staged_after(world, id, geo, previous.as_ref())? {
            world["actors"][id]["want"] = staged;
            world["actors"][id].as_object_mut()?.remove("content");
            continue;
        }
        if previous
            .as_ref()
            .is_some_and(|prior| prior["from"] == "quest:heard")
            && person.data["want"].is_object()
        {
            return None;
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
        let reaches = if world["hidden"]["actor"] == id {
            opening_visitor_routes::reachable(world, geo, id, &here)?
        } else if roams {
            reachable(world, geo, context, id, &here, allowed.as_ref())?
        } else {
            BTreeSet::new()
        };
        let (pick, reset) = pick_want(
            world,
            context,
            people,
            id,
            person,
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
        } else if replacing {
            world["actors"][id]["want"] = Value::Null;
        }
    }
    Some(())
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
    fn places_within<'b>(&'b self, from: &'b str, limit: u64) -> BTreeSet<&'b str> {
        let mut found = BTreeSet::from([from]);
        let mut queue = VecDeque::from([(from, 0)]);
        while let Some((here, distance)) = queue.pop_front() {
            if distance == limit {
                continue;
            }
            for &(end, _) in self.authored.get(here).into_iter().flatten() {
                if found.insert(end) {
                    queue.push_back((end, distance + 1));
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
    allowed: Option<&BTreeSet<&str>>,
) -> Option<BTreeSet<&'a str>> {
    let mut found = BTreeSet::new();
    let mut queue = VecDeque::from([here]);
    while let Some(from) = queue.pop_front() {
        for &(end, retired) in context.authored.get(from).into_iter().flatten() {
            if retired
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

fn pick_want<'a>(
    world: &Value,
    context: &Context<'a>,
    people: &People,
    actor: &str,
    person: &Person,
    reach: &BTreeSet<&str>,
    allowed: Option<&BTreeSet<&str>>,
) -> Option<(Option<Value>, bool)> {
    let actors = world["actors"].as_object()?;
    let me = actors.get(actor)?;
    let here = me["place"].as_str()?;
    let mut floor = i64::MAX;
    if let Some(items) = context.hands.get(actor) {
        for id in items {
            floor = floor.min(value_of(world, context, actor, person, id)?);
        }
    } else {
        floor = 1;
    }
    floor = floor.max(1);
    let turn = world["turn"].as_u64()?;
    let gave_up = &me["gaveUp"];
    let blocked = if let Some(target) = gave_up["target"].as_str() {
        (turn.saturating_sub(gave_up["turn"].as_u64()?) < 24).then_some(target)
    } else {
        None
    };
    let is_person = |id: &str| id != actor && context.regions.contains_key(id);
    let is_place = |id: &str| reach.contains(id) && context.active.contains(id);
    let mut range =
        Vec::with_capacity(context.carried_items.len() + context.active_people.len() + reach.len());
    for &id in &context.carried_items {
        let holder = context.items.get(id)?.root.as_str();
        if holder == actor || blocked == Some(id) || is_person(id) || is_place(id) {
            continue;
        }
        let other_want = &actors.get(holder)?["want"];
        if (other_want["kind"] != "item" || other_want["target"] != id)
            && value_of(world, context, actor, person, id)? > floor
        {
            range.push((
                "item",
                id,
                context.current_places.get(holder).map(String::as_str),
            ));
        }
    }
    range.extend(
        context
            .active_people
            .iter()
            .filter(|(id, _)| *id != actor && blocked != Some(*id))
            .map(|(id, place)| ("person", *id, place.as_deref())),
    );
    range.extend(
        reach
            .iter()
            .copied()
            .filter(|id| blocked != Some(*id) && !is_person(id) && context.active.contains(id))
            .map(|id| ("place", id, Some(id))),
    );
    let mut near = Pool::new();
    let mut refreshed = Pool::new();
    let mut wide = Pool::new();
    for &(kind, id, place) in &range {
        let place = place?;
        if allowed.is_some_and(|a| !a.contains(place)) {
            continue;
        }
        wide.push((kind, id));
        if place != here && !reach.contains(place) {
            continue;
        }
        if kind == "item" {
            let holder = world["items"][id]["holder"].as_str()?;
            if holder != "vale" && !member(&world["controlledActors"], holder) {
                if let Some(owner) = people.people.get(holder) {
                    if context.hands.contains_key(actor)
                        || world["items"]["cloth"]["holder"] == id
                        || (owner.pack != "hub" && owner.data["valueRules"].get(id).is_some())
                    {
                        return None;
                    }
                    let trust = world["actors"][holder]["trust"][actor]
                        .as_i64()
                        .unwrap_or(0);
                    let threshold = if trust > 0 { 6 } else { 3 };
                    if value_of(world, context, holder, owner, id)? <= threshold {
                        return None;
                    }
                    continue;
                }
            }
        }
        if kind == "place" && id == here {
            continue;
        }
        refreshed.push((kind, id));
        if !(kind == "place" && member(&me["visited"], id)
            || kind == "person" && member(&me["talked"], id))
        {
            near.push((kind, id));
        }
    }
    let reset = near.is_empty();
    let narrowed = [near, refreshed, wide]
        .into_iter()
        .find(|pool| !pool.is_empty());
    let size = narrowed.as_ref().map_or(range.len(), Vec::len);
    if size == 0 {
        return Some((None, reset));
    }
    let roll = initial_wants::run_hash(world, &format!("want:{actor}:{turn}"));
    let index = roll as usize % size;
    let (kind, target) = if let Some(pool) = narrowed {
        pool[index]
    } else {
        let (kind, target, _) = range[index];
        (kind, target)
    };
    Some((Some(initial_wants::simple_want(kind, target, turn)), reset))
}

fn value_of(
    world: &Value,
    context: &Context,
    actor: &str,
    person: &Person,
    id: &str,
) -> Option<i64> {
    let item = context.items.get(id)?;
    if item.reserved? {
        return Some(1);
    }
    let mut value = context.pack_values.get(person.pack)?[actor][id]
        .as_i64()
        .or_else(|| person.data["values"][id].as_i64())
        .unwrap_or(1);
    let rules = item.rules.as_array().into_iter().flatten().chain(
        person.data["valueRules"][id]
            .as_array()
            .into_iter()
            .flatten(),
    );
    for rule in rules {
        let mut holds = true;
        for fact in rule["when"].as_array()? {
            if let Some(held) = fact["holds"].as_str() {
                holds &= context.items.get(held)?.root == actor;
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
