use super::{create_geography::Geography, seed};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct People<'a> {
    pub(super) people: BTreeMap<&'a str, Person<'a>>,
    pub(super) humans: BTreeSet<&'a str>,
}

pub(super) struct Person<'a> {
    pub(super) pack: &'a str,
    pub(super) data: &'a Value,
}

impl<'a> People<'a> {
    pub(super) fn new(files: &'a Value, packs: impl Iterator<Item = &'a Value>) -> Option<Self> {
        let mut people = BTreeMap::new();
        let hub = files["v2/card-game/forest.json"]["people"].as_object()?;
        for (id, data) in hub {
            people.insert(id.as_str(), Person { pack: "hub", data });
        }
        for pack in packs {
            let name = pack["id"].as_str()?;
            for (id, data) in pack["avatars"].as_object()? {
                people.insert(id.as_str(), Person { pack: name, data });
            }
        }
        let humans = files["v2/card-game/shared-cast.json"]["avatars"]
            .as_array()?
            .iter()
            .map(|actor| actor["id"].as_str())
            .collect::<Option<_>>()?;
        Some(Self { people, humans })
    }

    pub(super) fn install(&self, world: &mut Value, geo: &Geography) -> Option<()> {
        for (&id, person) in &self.people {
            let human = self.humans.contains(id);
            let want = if human || person.data["wants"] == false {
                Value::Null
            } else {
                person
                    .staged(world, id, geo)?
                    .or_else(|| {
                        usable(world, &person.data["want"])
                            .then(|| new_want(&person.data["want"], 0))
                    })
                    .unwrap_or(Value::Null)
            };
            let rank = starting_rank(person.data["startLevel"].as_u64().unwrap_or(1));
            let actor = world["actors"].get_mut(id)?.as_object_mut()?;
            let place = actor.get("place")?.as_str()?;
            actor.insert("visited".into(), json!([place]));
            actor.insert("talked".into(), json!([]));
            actor.insert("xp".into(), json!(rank.saturating_sub(1) * rank / 2));
            actor.insert("want".into(), want);
            if person.data["levelAtHome"] == true {
                actor.insert("level".into(), json!(rank.max(1)));
            }
        }
        Some(())
    }
}

fn starting_rank(level: u64) -> u64 {
    const TIERS: [(u64, u64, u64); 6] = [
        (0, 0, 2),
        (6, 10, 4),
        (11, 20, 5),
        (15, 30, 10),
        (19, 50, 50),
        (21, 100, 2),
    ];
    let capped = level.min(21);
    let (level, rank, twice_per) = TIERS
        .iter()
        .rev()
        .find(|(level, _, _)| capped >= *level)
        .copied()
        .unwrap_or(TIERS[0]);
    rank + ((capped - level) * twice_per).div_ceil(2)
}

pub(super) fn run_hash(world: &Value, key: &str) -> u32 {
    let seed = world["run"]["seed"].as_u64().unwrap_or(0);
    seed::hash(&format!("{seed}:{key}"))
}

fn mixed(mut hash: u32) -> u32 {
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x85eb_ca6b);
    hash = (hash ^ (hash >> 13)).wrapping_mul(0xc2b2_ae35);
    hash ^ (hash >> 16)
}

impl Person<'_> {
    pub(super) fn staged(&self, world: &Value, id: &str, geo: &Geography) -> Option<Option<Value>> {
        let Some(entries) = self.data["wants"].as_array() else {
            return Some(None);
        };
        let turn = world["turn"].as_u64()?;
        let mut choices = Vec::new();
        for (index, entry) in entries.iter().enumerate() {
            let want = &entry["want"];
            let trust = want["minTrust"].as_u64().unwrap_or(0);
            if trust > 0 && world["actors"][id]["trust"]["vale"].as_u64().unwrap_or(0) < trust {
                continue;
            }
            if usable(world, want)
                && geo.conditions_met(world, self.pack, &entry["when"], None)?
                && !initial_met(world, id, want)?
            {
                let rank = mixed(run_hash(
                    world,
                    &format!("staged:{id}:{index}:{}", turn / 48),
                ));
                choices.push((rank, index, want));
            }
        }
        Some(
            choices
                .into_iter()
                .min_by_key(|(rank, index, _)| (*rank, *index))
                .map(|(_, _, want)| new_want(want, turn)),
        )
    }
}

fn initial_met(world: &Value, id: &str, want: &Value) -> Option<bool> {
    let target = want["target"].as_str()?;
    let step = &want["step"];
    Some(match step["verb"].as_str() {
        Some("lay") => {
            if let Some(finish) = step["finish"].as_str() {
                world["packs"]
                    .as_object()?
                    .values()
                    .any(|state| state["flags"][finish] == true)
            } else {
                step["items"].as_array()?.iter().all(|item| {
                    item.as_str()
                        .is_some_and(|item| world["items"][item]["holder"] == target)
                })
            }
        }
        Some("rest" | "eat" | "call" | "give") => false,
        Some(_) => return None,
        None => match want["kind"].as_str()? {
            "item" => {
                root(world, target)? == id
                    && want["lit"]
                        .as_bool()
                        .is_none_or(|lit| world["items"][target]["lit"] == lit)
            }
            "place" => world["actors"][id]["place"] == target,
            "person" | "connect" => false,
            _ => return None,
        },
    })
}

pub(super) fn root<'a>(world: &'a Value, item: &str) -> Option<&'a str> {
    let items = world["items"].as_object()?;
    let mut holder = items.get(item)?["holder"].as_str()?;
    let mut seen = BTreeSet::new();
    while let Some(container) = items.get(holder) {
        if !seen.insert(holder) {
            return None;
        }
        holder = container["holder"].as_str()?;
    }
    Some(holder)
}

fn usable(world: &Value, want: &Value) -> bool {
    let Some(target) = want["target"].as_str() else {
        return false;
    };
    match want["kind"].as_str() {
        Some("item") => world["items"].get(target).is_some(),
        Some("person") => world["actors"].get(target).is_some(),
        Some("connect") => target == "humans",
        Some("place") => true,
        _ => false,
    }
}

pub(super) fn simple_want(kind: &str, target: &str, turn: u64) -> Value {
    json!({"kind":kind, "target":target, "since":turn, "refusals":0})
}

fn new_want(source: &Value, turn: u64) -> Value {
    let mut want = simple_want(
        source["kind"].as_str().unwrap_or_default(),
        source["target"].as_str().unwrap_or_default(),
        turn,
    );
    if source["kind"] == "item" && source["lit"].is_boolean() {
        want["lit"] = source["lit"].clone();
    }
    if let Some(step) = source.get("step") {
        want["step"] = step.clone();
    }
    want
}
