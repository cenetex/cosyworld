use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::OnceLock,
};

pub struct Geography<'a> {
    files: &'a Value,
    packs: Vec<&'a Value>,
    entities: BTreeMap<&'a str, (&'a Value, &'a Value)>,
    released: BTreeMap<&'a str, BTreeSet<&'a str>>,
    section_requirements: BTreeMap<(&'a str, &'a str), &'a Value>,
    humans: Vec<&'a str>,
    attic_interior: OnceLock<Option<BTreeSet<String>>>,
}

#[derive(Clone, Copy)]
struct ConditionContext<'a> {
    world: &'a Value,
    pack: &'a str,
    actor: Option<&'a str>,
    senses: bool,
}

const MAX_DEPTH: u8 = 32;
const DAYLIGHT_TURNS: u64 = 24;
const ARCANA_LEVEL_CAP: u64 = 21;

impl<'a> Geography<'a> {
    pub fn new(files: &'a Value, packs: impl Iterator<Item = &'a Value>) -> Option<Self> {
        let packs: Vec<_> = packs.collect();
        let mut entities = BTreeMap::new();
        let mut released = BTreeMap::new();
        let mut section_requirements = BTreeMap::new();
        for &pack in &packs {
            let pack_id = pack["id"].as_str()?;
            let release = &pack["release"];
            if release.is_object() {
                let known = ["places", "avatars", "items"]
                    .iter()
                    .flat_map(|field| array(&release[*field]))
                    .map(Value::as_str)
                    .collect::<Option<BTreeSet<_>>>()?;
                released.insert(pack_id, known);
            }
            for section in array(&pack["sections"]) {
                for place in array(&section["places"]) {
                    section_requirements
                        .entry((pack_id, place.as_str()?))
                        .or_insert(&section["requires"]);
                }
            }
            for field in ["places", "avatars", "items", "fixtures"] {
                if let Some(entries) = pack.get(field) {
                    for (id, entry) in entries.as_object()? {
                        entities.insert(id.as_str(), (pack, entry));
                    }
                }
            }
        }
        let humans = files["v2/card-game/shared-cast.json"]["avatars"]
            .as_array()?
            .iter()
            .map(|entry| entry["id"].as_str())
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            files,
            packs,
            entities,
            released,
            section_requirements,
            humans,
            attic_interior: OnceLock::new(),
        })
    }

    pub fn entity_active(&self, world: &Value, id: &str) -> Option<bool> {
        self.active(world, id, MAX_DEPTH)
    }

    pub fn entity_enabled(&self, world: &Value, id: &str) -> Option<bool> {
        self.enabled(world, id, MAX_DEPTH)
    }

    fn active(&self, world: &Value, id: &str, depth: u8) -> Option<bool> {
        let items = &world["items"];
        let root = match items.get(id) {
            Some(item) => Some(root_of(items, id, item)?),
            None => None,
        };
        self.active_with_root(world, id, root, depth)
    }

    pub(super) fn item_active_at_root(&self, world: &Value, id: &str, root: &str) -> Option<bool> {
        self.active_with_root(world, id, Some(root), MAX_DEPTH)
    }

    fn active_with_root(
        &self,
        world: &Value,
        id: &str,
        root: Option<&str>,
        depth: u8,
    ) -> Option<bool> {
        if let Some(holder) = root {
            if !coordinate_active(world, holder)
                || !self.human_available(world, holder)
                || (holder == "boardyai" && self.humans_present(world) < 2)
            {
                return Some(false);
            }
        }
        if !self.human_available(world, id) {
            return Some(false);
        }
        self.enabled(world, id, depth)
    }

    fn enabled(&self, world: &Value, id: &str, depth: u8) -> Option<bool> {
        let depth = depth.checked_sub(1)?;
        if !coordinate_active(world, id) || contains(&world["usedUp"], id) {
            return Some(false);
        }
        let Some(&(pack, entity)) = self.entities.get(id) else {
            let hub = &self.files["v2/card-game/packs.json"]["hub"];
            if !self.humans.contains(&id)
                && ["places", "avatars", "items"]
                    .iter()
                    .any(|field| contains(&hub[*field], id))
                && self.pack_disabled(world, "hub")
            {
                return Some(false);
            }
            let person = &self.files["v2/card-game/forest.json"]["people"][id];
            return self.all(
                ConditionContext {
                    world,
                    pack: "",
                    actor: None,
                    senses: false,
                },
                &person["appearsWhen"],
                depth,
            );
        };
        let pack_id = pack["id"].as_str()?;
        let state = &world["packs"][pack_id];
        if state.is_null() || self.pack_disabled(world, pack_id) || self.retired(pack, id) {
            return Some(false);
        }
        if let Some(home) = entity["home"].as_str() {
            let waits_at_home = world["items"][id]["holder"] == home
                && state["receipts"]
                    .as_object()
                    .is_some_and(|receipts| !receipts.is_empty())
                && array(&pack["choices"]).any(|choice| {
                    choice["id"]
                        .as_str()
                        .is_some_and(|key| state["receipts"].get(key).is_some())
                        && array(&choice["effects"]).any(|effect| {
                            effect["kind"] == "retire_item"
                                && effect["item"] == id
                                && effect["waitAtHome"] == true
                        })
                });
            if waits_at_home && !self.enabled(world, home, depth)? {
                return Some(false);
            }
        }
        let ctx = ConditionContext {
            world,
            pack: pack_id,
            actor: None,
            senses: false,
        };
        if !self.all(ctx, &entity["requires"], depth)?
            || !self.all(ctx, &entity["appearsWhen"], depth)?
        {
            return Some(false);
        }
        let opening_scope = state["scope"] != "full";
        let pool = &pack["specials"]["pool"];
        let place = if opening_scope || pool.is_array() {
            section_place(pack, id)
        } else {
            None
        };
        if opening_scope {
            if let Some(requires) =
                place.and_then(|place| self.section_requirements.get(&(pack_id, place)))
            {
                if !self.all(ctx, requires, depth)? {
                    return Some(false);
                }
            }
        }
        let mut covering = array(pool)
            .filter_map(|entry| {
                let entry = entry["id"].as_str()?;
                (entry == id || (Some(entry) == place && pack["places"].get(entry).is_some()))
                    .then_some(entry)
            })
            .peekable();
        if covering.peek().is_some() && !covering.any(|entry| contains(&state["specials"], entry)) {
            return Some(false);
        }
        if pack["release"].is_null() || state["scope"] == "full" {
            return Some(true);
        }
        if pack["recital"]["actor"] == id {
            let visits = state["recitals"].as_object()?.values();
            if entity["roamingQuest"] != "latest-completion"
                && !visits
                    .into_iter()
                    .any(|record| record["visit"].as_u64().unwrap_or(0) > 0)
            {
                return Some(false);
            }
            return self.enabled(world, world["actors"][id]["place"].as_str()?, depth);
        }
        Some(
            self.released
                .get(pack_id)
                .is_some_and(|release| release.contains(id)),
        )
    }

    fn retired(&self, pack: &Value, id: &str) -> bool {
        let place = &pack["places"][id];
        place["retired"] == true
            || place["road"].as_array().is_some_and(|ends| {
                ends.len() == 2
                    && ends.iter().enumerate().all(|(i, end)| {
                        end.as_str()
                            .and_then(|end| self.entities.get(end))
                            .is_some_and(|(_, place)| {
                                ends[1 - i]
                                    .as_str()
                                    .is_some_and(|other| contains(&place["exits"], other))
                            })
                    })
            })
    }

    fn pack_disabled(&self, world: &Value, pack: &str) -> bool {
        let disabled = &world["disabledPacks"];
        if disabled.as_array().is_none_or(Vec::is_empty) {
            return false;
        }
        let groups = &self.files["v2/card-game/packs.json"]["hub"]["switchable"];
        groups.as_object().into_iter().flatten().any(|(id, group)| {
            contains(&group["packs"], pack)
                && (contains(disabled, id)
                    || group["reachedBy"]
                        .as_str()
                        .is_some_and(|parent| contains(disabled, parent)))
        })
    }

    fn human_available(&self, world: &Value, id: &str) -> bool {
        !self.humans.contains(&id) || present(world, id) || self.visiting_resident(world, id)
    }

    fn humans_present(&self, world: &Value) -> usize {
        if world["sharedVersion"] != 1 {
            return 0;
        }
        self.humans.iter().filter(|id| present(world, id)).count()
    }

    pub fn conditions_met(
        &self,
        world: &Value,
        pack: &str,
        conditions: &Value,
        actor: Option<&str>,
    ) -> Option<bool> {
        self.pack_conditions(
            ConditionContext {
                world,
                pack,
                actor,
                senses: false,
            },
            conditions,
            MAX_DEPTH,
        )
    }

    pub(super) fn crossing_conditions(
        &self,
        world: &Value,
        pack: &str,
        conditions: &Value,
        actor: Option<&str>,
    ) -> Option<bool> {
        self.all(
            ConditionContext {
                world,
                pack,
                actor,
                senses: true,
            },
            conditions,
            MAX_DEPTH,
        )
    }

    pub(super) fn reflection_open(&self, world: &Value, route: &Value) -> Option<bool> {
        let ctx = ConditionContext {
            world,
            pack: "",
            actor: None,
            senses: false,
        };
        self.all(ctx, &route["requires"], MAX_DEPTH)
    }

    fn pack_conditions(
        &self,
        ctx: ConditionContext<'_>,
        conditions: &Value,
        depth: u8,
    ) -> Option<bool> {
        if ctx.world["packs"].get(ctx.pack).is_none() {
            return Some(false);
        }
        self.all(ctx, conditions, depth)
    }

    fn all(&self, ctx: ConditionContext<'_>, conditions: &Value, depth: u8) -> Option<bool> {
        for condition in array(conditions) {
            if !self.condition(ctx, condition, depth)? {
                return Some(false);
            }
        }
        Some(true)
    }

    fn condition(&self, ctx: ConditionContext<'_>, condition: &Value, depth: u8) -> Option<bool> {
        let depth = depth.checked_sub(1)?;
        let world = ctx.world;
        let state = &world["packs"][ctx.pack];
        let item = || condition["item"].as_str();
        let key = || condition["key"].as_str();
        let item_live = |id| !contains(&world["usedUp"], id);
        Some(match condition["kind"].as_str()? {
            "not" => !self.condition(ctx, &condition["condition"], depth)?,
            "sound" => ctx.senses && self.sound_at(world, &condition["at"], depth)?,
            "tag_held" => self.tag_held(world, condition, depth)?,
            "daylight" => {
                let phase = if (world["turn"].as_u64()? / DAYLIGHT_TURNS).is_multiple_of(2) {
                    "day"
                } else {
                    "night"
                };
                condition["phase"] == phase
            }
            "any" => {
                for option in array(&condition["conditions"]) {
                    if self.condition(ctx, option, depth)? {
                        return Some(true);
                    }
                }
                false
            }
            "clock" => {
                let hour = world["turn"].as_u64()? % (2 * DAYLIGHT_TURNS);
                let from = condition["from"].as_u64()?;
                let to = condition["to"].as_u64()?;
                if from < to {
                    (from..to).contains(&hour)
                } else {
                    hour >= from || hour < to
                }
            }
            "choice" => state["choices"].get(key()?) == condition.get("value"),
            "receipt" => {
                let Some(received) = state["receipts"].get(condition["choiceId"].as_str()?) else {
                    return Some(false);
                };
                if let Some(window) = condition.get("within") {
                    let window = window.as_u64()?;
                    world["turn"]
                        .as_u64()?
                        .checked_sub(received.as_u64()?)
                        .is_some_and(|elapsed| elapsed < window)
                } else {
                    true
                }
            }
            "flag" => flag(state, key()?) == condition["value"].as_bool()?,
            "drawn" => contains(&state["specials"], condition["id"].as_str()?),
            "met" => state["met"].get(condition["actor"].as_str()?).is_some(),
            "shared_world" => world["sharedVersion"] == 1,
            "home_door" => world["doors"][condition["home"].as_str()?] == condition["place"],
            "arcana_called" => self.arcana_called(world)?,
            "connected_humans" => {
                self.humans_present(world) >= condition["minimum"].as_u64()? as usize
            }
            "holding" => {
                let holder = if condition["role"] == "actor" {
                    ctx.actor
                } else {
                    condition["actor"].as_str()
                };
                let item = item()?;
                holder.is_some()
                    && world["items"][item]["holder"].as_str() == holder
                    && item_live(item)
            }
            "item_at" => {
                world["items"][item()?]["holder"] == condition["place"] && item_live(item()?)
            }
            "item_near" | "item_present" => {
                let item = item()?;
                if world["items"].get(item).is_none() || !item_live(item) {
                    return Some(false);
                }
                let holder = root_holder(world, item)?;
                let available = condition["kind"] == "item_present"
                    || !controlled(world, holder)
                    || present(world, holder);
                available && condition["place"] == item_place(world, holder)
            }
            "pack_item_present" => {
                let pack_id = condition["pack"].as_str()?;
                let place = condition["place"].as_str()?;
                let pack = self.packs().find(|pack| pack["id"] == pack_id)?;
                for id in pack["items"]
                    .as_object()
                    .into_iter()
                    .flat_map(|items| items.keys())
                {
                    if world["items"].get(id).is_some()
                        && item_place(world, root_holder(world, id)?) == place
                        && self.active(world, id, depth)?
                    {
                        return Some(true);
                    }
                }
                false
            }
            "light" => {
                let id = item()?;
                let item = &world["items"][id];
                if !self.active(world, id, depth)?
                    || item["lit"] != true
                    || item["fuel"].as_u64().unwrap_or(0) == 0
                {
                    return Some(false);
                }
                let place = item_place(world, root_holder(world, id)?);
                contains(&condition["at"], place)
                    && (condition["uncovered"] != true
                        || !world["items"]
                            .as_object()?
                            .values()
                            .any(|item| item["holder"] == id))
            }
            "ship_at" => {
                let ship = &world["transports"][condition["transport"].as_str()?];
                if condition["dock"] == "@sea" {
                    ship["phase"] == "sea"
                } else {
                    ship["phase"] != "sea" && ship["dock"] == condition["dock"]
                }
            }
            _ => return None,
        })
    }

    pub fn packs(&self) -> impl Iterator<Item = &'a Value> + Clone + '_ {
        self.packs.iter().copied()
    }

    pub(super) fn resident_pack(&self, id: &str) -> Option<&'a Value> {
        let &(pack, _) = self.entities.get(id)?;
        (!self.humans.contains(&id) && pack["avatars"].get(id).is_some()).then_some(pack)
    }

    pub(super) fn files(&self) -> &'a Value {
        self.files
    }

    pub(super) fn human_present(&self, world: &Value, id: &str) -> bool {
        self.humans.contains(&id) && present(world, id)
    }

    pub(super) fn visiting_resident(&self, world: &Value, id: &str) -> bool {
        world["sharedVersion"] == 1
            && self.humans.contains(&id)
            && !controlled(world, id)
            && !contains(&world["absent"], id)
    }

    fn sound_at(&self, world: &Value, places: &Value, depth: u8) -> Option<bool> {
        if world["items"]["bell"]["ringing"].as_u64().unwrap_or(0) > 0
            && self.active(world, "bell", depth)?
            && contains(places, item_place(world, root_holder(world, "bell")?))
        {
            return Some(true);
        }
        let turn = world["turn"].as_u64()?;
        for pack in self.packs() {
            let pack_id = pack["id"].as_str()?;
            for (id, fixture) in pack["fixtures"].as_object().into_iter().flatten() {
                if contains(places, fixture["at"].as_str()?)
                    && world["packs"][pack_id]["sounds"][id].as_u64().unwrap_or(0) > turn
                {
                    return Some(true);
                }
            }
        }
        Some(false)
    }

    fn tag_held(&self, world: &Value, condition: &Value, depth: u8) -> Option<bool> {
        let tag = condition["tag"].as_str()?;
        let here = condition["place"].as_str()?;
        let actors = world["actors"].as_object()?;
        let available = |id: &str| {
            world["actors"][id]["place"] == here && (!controlled(world, id) || present(world, id))
        };
        if actors
            .iter()
            .any(|(id, actor)| available(id) && contains(&actor["upgrades"], tag))
        {
            return Some(true);
        }
        for (id, item) in world["items"].as_object()? {
            if self
                .entities
                .get(id.as_str())
                .is_some_and(|(pack, _)| contains(&pack["items"][id]["tags"], tag))
                && available(item["holder"].as_str()?)
                && self.active(world, id, depth)?
            {
                return Some(true);
            }
        }
        Some(false)
    }

    pub(super) fn arcana_called(&self, world: &Value) -> Option<bool> {
        let arcana = &self.files["v2/card-game/arcana.json"];
        let calls = arcana["calls"].as_u64()?;
        let starter = arcana["starterId"].as_str()?;
        Some(world["actors"].as_object()?.iter().any(|(id, actor)| {
            let record = &actor["arcana"];
            let spread = &record["spread"];
            if !present(world, id) || array(spread).any(|card| card["face"] == "reward") {
                return false;
            }
            if let Some(offer) = record["offer"].as_str().filter(|offer| !offer.is_empty()) {
                return actor["place"] == offer;
            }
            let level = record["level"]
                .as_u64()
                .unwrap_or_else(|| array(&record["proved"]).count() as u64);
            let dealt_starter = level == 0
                && contains(&record["need"], starter)
                && array(spread).any(|card| card["card"] == starter && card["face"] == "down");
            record["paid"] != true
                && (record["sale"] == true
                    || (record["calls"].as_u64().unwrap_or(0) >= calls
                        && level < ARCANA_LEVEL_CAP
                        && !dealt_starter))
        }))
    }

    pub fn base_exits(&self, place: &str) -> Option<&'a [Value]> {
        let forest = &self.files["v2/card-game/forest.json"];
        let definition = self
            .entities
            .get(place)
            .map_or(&forest["places"][place], |(_, place)| place);
        Some(definition["exits"].as_array()?)
    }

    pub(super) fn attic_interior(&self) -> Option<&BTreeSet<String>> {
        self.attic_interior
            .get_or_init(|| self.find_attic_interior())
            .as_ref()
    }

    fn find_attic_interior(&self) -> Option<BTreeSet<String>> {
        let mut found = BTreeSet::from(["attic"]);
        let mut queue = VecDeque::from(["attic"]);
        while let Some(from) = queue.pop_front() {
            let mut neighbor = |to| {
                if to != "pond" && found.insert(to) {
                    queue.push_back(to);
                }
            };
            for to in self.base_exits(from)? {
                neighbor(to.as_str()?);
            }
            for pack in self.packs() {
                let land = array(&pack["crossings"]).filter(|edge| edge["transport"].is_null());
                for edge in array(&pack["routes"])
                    .chain(land)
                    .filter(|edge| edge["from"] == from)
                {
                    neighbor(edge["to"].as_str()?);
                }
            }
        }
        Some(found.into_iter().map(str::to_owned).collect())
    }

    pub fn pack_route_open(&self, world: &Value, from: &str, to: &str) -> Option<bool> {
        for pack in self.packs() {
            let pack_id = pack["id"].as_str()?;
            for route in
                array(&pack["routes"]).filter(|route| route["from"] == from && route["to"] == to)
            {
                if self.route_open(world, pack_id, route)? {
                    return Some(true);
                }
            }
        }
        Some(false)
    }

    pub fn route_open(&self, world: &Value, pack_id: &str, route: &Value) -> Option<bool> {
        let to = route["to"].as_str()?;
        if world["elysiumCoordinates"].get(to).is_some()
            && self.packs().any(|pack| {
                pack["id"] == "elysium"
                    && array(&pack["routes"]).any(|candidate| {
                        candidate["from"] == route["from"]
                            && candidate["to"] == to
                            && [
                                "elysium-ring-outer",
                                "elysium-ring-middle",
                                "elysium-ring-inner",
                            ]
                            .iter()
                            .all(|id| {
                                array(&candidate["requires"]).any(|condition| {
                                    condition["kind"] == "item_at" && condition["item"] == *id
                                })
                            })
                    })
            })
        {
            return Some(true);
        }
        self.conditions_met(world, pack_id, &route["requires"], None)
    }
}

fn section_place<'a>(pack: &'a Value, id: &'a str) -> Option<&'a str> {
    if pack["places"].get(id).is_some() {
        return Some(id);
    }
    if let Some(avatar) = pack["avatars"].get(id) {
        return avatar["place"].as_str();
    }
    if let Some(fixture) = pack["fixtures"].get(id) {
        return fixture["at"].as_str();
    }
    let holder = pack["items"][id]["holder"].as_str()?;
    if pack["places"].get(holder).is_some() {
        Some(holder)
    } else {
        pack["avatars"][holder]["place"].as_str()
    }
}

fn coordinate_active(world: &Value, id: &str) -> bool {
    let number = id
        .strip_prefix("elysium-coordinate-")
        .or_else(|| id.strip_prefix("elysium-void-"));
    !number.is_some_and(|number| {
        number.len() == 3
            && number.bytes().all(|b| b.is_ascii_digit())
            && number > "007"
            && world["elysiumCoordinates"]
                .get(format!("elysium-void-{number}"))
                .is_none()
    })
}

fn controlled(world: &Value, id: &str) -> bool {
    if world["controlledActors"].is_null() {
        id == "vale"
    } else {
        contains(&world["controlledActors"], id)
    }
}

fn present(world: &Value, id: &str) -> bool {
    controlled(world, id)
        && (world["presentActors"].is_null() || contains(&world["presentActors"], id))
}

fn root_holder<'a>(world: &'a Value, id: &str) -> Option<&'a str> {
    let items = &world["items"];
    root_of(items, id, items.get(id)?)
}

fn root_of<'a>(items: &'a Value, id: &str, item: &'a Value) -> Option<&'a str> {
    let mut seen = BTreeSet::new();
    let mut holder = item["holder"].as_str()?;
    while let Some(container) = items.get(holder) {
        if holder == id || !seen.insert(holder) {
            break;
        }
        holder = container["holder"].as_str()?;
    }
    Some(holder)
}

fn item_place<'a>(world: &'a Value, holder: &'a str) -> &'a str {
    world["actors"][holder]["place"].as_str().unwrap_or(holder)
}

fn flag(state: &Value, key: &str) -> bool {
    state["flags"][key].as_bool().unwrap_or(false)
}

fn array(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn contains(value: &Value, id: &str) -> bool {
    array(value).any(|entry| entry == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn custody_walks_through_containers_and_stops_at_the_first_repeated_holder() {
        let mut world = json!({"items":{
            "note":{"holder":"case"},
            "case":{"holder":"vale"},
            "loop":{"holder":"loop"},
        }});
        assert_eq!(root_holder(&world, "case"), Some("vale"));
        assert_eq!(root_holder(&world, "note"), Some("vale"));
        assert_eq!(root_holder(&world, "loop"), Some("loop"));
        world["items"]["case"]["holder"] = json!("note");
        assert_eq!(root_holder(&world, "note"), Some("note"));
    }

    #[test]
    fn an_opening_listener_requires_a_present_traveller_who_has_called() {
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        let files = &content["files"];
        let geo = Geography::new(files, std::iter::empty()).unwrap();
        let arcana = &files["v2/card-game/arcana.json"];
        let mut world = json!({"actors": {"vale": {"place": "attic"}}});
        assert_eq!(geo.entity_active(&world, "listener"), Some(false));
        world["actors"]["vale"]["arcana"] = json!({"calls": arcana["calls"]});
        assert_eq!(geo.entity_active(&world, "listener"), Some(true));
        world["actors"]["vale"]["arcana"]["spread"] = json!([
            {"card": arcana["starterId"], "face": "reward"}
        ]);
        assert_eq!(geo.entity_active(&world, "listener"), Some(false));
        world["actors"]["vale"]["arcana"] = json!({"calls": arcana["calls"]});
        world["presentActors"] = json!([]);
        assert_eq!(geo.entity_active(&world, "listener"), Some(false));
    }

    #[test]
    fn a_choice_receipt_has_an_exclusive_age_limit() {
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        let geo = Geography::new(&content["files"], std::iter::empty()).unwrap();
        let choice = "greek-acropolis-lampito-shares-bread";
        let within = json!([{"kind":"receipt", "choiceId":choice, "within":8}]);
        let past = json!([{"kind":"receipt", "choiceId":choice}]);
        let mut world = json!({"turn":481, "packs":{"greek-drama":{}}});
        assert_eq!(
            geo.conditions_met(&world, "greek-drama", &past, None),
            Some(false)
        );
        assert_eq!(
            geo.conditions_met(&world, "greek-drama", &within, None),
            Some(false)
        );
        for (recorded, expected) in [(482, false), (481, true), (474, true), (473, false)] {
            world["packs"]["greek-drama"]["receipts"][choice] = json!(recorded);
            assert_eq!(
                geo.conditions_met(&world, "greek-drama", &within, None),
                Some(expected)
            );
            assert_eq!(
                geo.conditions_met(&world, "greek-drama", &past, None),
                Some(true)
            );
        }
    }
}
