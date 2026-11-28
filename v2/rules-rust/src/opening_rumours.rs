use super::seed::hash;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

const TURNS_PER_DAY: u64 = 48;
const RESTLESS_DAYS: u64 = 7;
const HEARD_FROM: &str = "quest:heard";
const CONTENT_TURNS: u64 = 24;
const WANTED: [&str; 3] = ["item", "place", "person"];

type Target<'a> = (&'a str, &'a str);

pub fn heard(
    world: &Value,
    id: &str,
    active: &BTreeSet<&str>,
    person_regions: &BTreeMap<&str, &str>,
    thick: Option<&str>,
    roams: bool,
) -> Option<Option<Value>> {
    let actors = world["actors"].as_object()?;
    let items = world["items"].as_object()?;
    let actor = actors.get(id)?;
    if !actor["trust"]
        .as_object()
        .into_iter()
        .flat_map(Map::values)
        .any(|trust| trust.as_i64().is_some_and(|trust| trust > 0))
    {
        return Some(None);
    }
    let turn = world["turn"].as_u64()?;
    let day = turn / TURNS_PER_DAY;
    let seed = world["run"]["seed"].as_u64().unwrap_or_default();
    let run_hash = |key: &str| hash(&format!("{seed}:{key}"));
    if actor["heardOn"].as_u64() == Some(day)
        || (day + u64::from(run_hash(&format!("restless:{id}")))).is_multiple_of(RESTLESS_DAYS)
    {
        return Some(None);
    }

    let controlled = world["heldActors"]
        .as_array()
        .or_else(|| world["controlledActors"].as_array());
    let current = world["playerActorId"].as_str().unwrap_or("vale");
    let player = |id| {
        id == current
            || controlled.map_or(id == "vale", |seats| seats.iter().any(|seat| seat == id))
    };
    let region = |id| person_regions.get(id).copied().unwrap_or("hub");
    let trust = |id| actor["trust"][id].as_i64().unwrap_or_default();
    let mut scores = BTreeMap::new();
    let mut near = Vec::new();
    let mut wanters = BTreeMap::new();
    let mut offer = |target, score| {
        let best = scores.entry(target).or_insert(0);
        *best = (*best).max(score);
    };
    for (peer, record) in actors {
        let peer = peer.as_str();
        if peer == id || player(peer) || !active.contains(peer) {
            continue;
        }
        let nearby = region(peer) == region(id);
        if nearby {
            near.push((peer, record));
        }
        let Some(target) = target_of(&record["want"]) else {
            continue;
        };
        let score = trust(peer);
        if score == 3 {
            offer(target, 4);
        }
        if nearby && score >= 1 {
            let count = wanters.entry(target).or_insert(0);
            *count += 1;
            if *count >= 2 || (score == 2 && target.0 == "item") {
                offer(target, 3);
            }
        }
    }

    let xp = |record: &Value| record["xp"].as_u64().unwrap_or_default();
    let highest = near.iter().map(|(_, record)| xp(record)).max().unwrap_or(0);
    let famous: Vec<_> = near
        .iter()
        .filter(|(_, record)| highest > xp(actor) && xp(record) == highest)
        .map(|(peer, _)| *peer)
        .collect();
    if let Some(rumours) = actor["rumours"].as_array() {
        for rumour in rumours {
            let (Some(kind), Some(target), Some(teller)) = (
                rumour["kind"].as_str(),
                rumour["subject"].as_str(),
                rumour["teller"].as_str(),
            ) else {
                continue;
            };
            if !WANTED.contains(&kind) || trust(teller) < 1 {
                continue;
            }
            let in_fame_tie = famous.contains(&teller);
            if in_fame_tie && famous.len() != 1 {
                return None;
            }
            if kind == "item"
                && rumour["day"].as_u64() == Some(day)
                && rumour["holder"]
                    .as_str()
                    .is_some_and(|holder| root(items, target) == Some(holder))
            {
                offer((kind, target), 3);
            }
            offer(
                (kind, target),
                2 + u8::from(thick == Some(kind)) + u8::from(in_fame_tie),
            );
        }
    }
    let cap = (near.len() + 1).div_ceil(3);
    let prev = actor["gaveUp"]["turn"].as_u64();
    let skip = prev
        .filter(|&n| turn.saturating_sub(n) < CONTENT_TURNS)
        .and_then(|_| actor["gaveUp"]["target"].as_str());
    let mut eligible = Vec::new();
    for ((kind, target), score) in scores {
        if target == id || skip == Some(target) || !active.contains(target) {
            continue;
        }
        let available = match kind {
            "item" if items.contains_key(target) => root(items, target)? != id,
            "person" => actors.contains_key(target),
            "place" => {
                roams
                    && actor["place"] != target
                    && !actors.contains_key(target)
                    && !items.contains_key(target)
            }
            _ => false,
        };
        let already = near
            .iter()
            .filter(|(_, peer)| {
                peer["want"]["from"] == HEARD_FROM
                    && target_of(&peer["want"]) == Some((kind, target))
            })
            .count();
        if available && already < cap {
            let roll = run_hash(&format!("heard:{id}:{kind}:{target}:{day}"));
            eligible.push((std::cmp::Reverse(score), roll, kind, target));
        }
    }
    eligible.sort_unstable();
    let Some((score, roll, kind, target)) = eligible.first() else {
        return Some(None);
    };
    if eligible
        .get(1)
        .is_some_and(|second| (second.0, second.1) == (*score, *roll))
    {
        return None;
    }
    Some(Some(
        json!({"kind": kind, "target": target, "since": turn, "refusals": 0, "from": HEARD_FROM}),
    ))
}

fn target_of(want: &Value) -> Option<Target<'_>> {
    let kind = want["kind"].as_str()?;
    WANTED
        .contains(&kind)
        .then_some((kind, want["target"].as_str()?))
}

fn root<'a>(items: &'a Map<String, Value>, id: &str) -> Option<&'a str> {
    let mut holder = items.get(id)?["holder"].as_str()?;
    let mut seen = BTreeSet::new();
    while let Some(item) = items.get(holder) {
        if !seen.insert(holder) {
            return None;
        }
        holder = item["holder"].as_str()?;
    }
    Some(holder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, process::Command};

    #[test]
    fn opening_heard_wants_match_javascript() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import { heardWant } from './v2/card-game/world/rumours.mjs';
const target = (kind, target, from) => ({kind, target, from});
const actors = {
  listener: {place: 'station', trust: {friend: 3, neighbour: 2, traveller: 1},
    rumours: [{kind: 'item', subject: 'lamp', holder: 'neighbour', day: 10, teller: 'neighbour'},
      {kind: 'person', subject: 'traveller', teller: 'neighbour', day: 10}]},
  friend: {want: target('place', 'pond')},
  neighbour: {want: target('item', 'lamp', 'quest:heard'), xp: 2},
  traveller: {want: target('person', 'friend')},
  vale: {want: target('place', 'clearing')},
};
const items = {lamp: {holder: 'box'}, box: {holder: 'neighbour'}};
const regions = {friend: 'distant', traveller: 'distant'};
const keys = [...Object.keys(actors), ...Object.keys(items), 'pond', 'clearing'];
const worlds = [0, 1, 11, 17, 4294967295].flatMap((seed) =>
  [true, false].flatMap((roams) => [false, true].map((giveUp) => {
    const world = {run: {seed}, turn: 480, actors: structuredClone(actors), items};
    const listener = world.actors.listener;
    if (giveUp) listener.gaveUp = {target: 'pond', turn: 457};
    const api = {
      active: id => keys.includes(id), player: id => id === 'vale',
      worldOf: id => regions[id] ?? 'hub', gone: () => false,
      thick: () => ({kind: 'person'}), kindOf: () => 'place',
    };
    const expected = heardWant(structuredClone(world), 'listener', api, giveUp ? ['pond'] : [], roams);
    return {world, roams, expected};
  })));
console.log(JSON.stringify({worlds, regions, keys}));
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let fixtures: Value = serde_json::from_slice(&output.stdout).unwrap();
        let regions = fixtures["regions"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(id, region)| (id.as_str(), region.as_str().unwrap()))
            .collect();
        let keys = fixtures["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|key| key.as_str().unwrap())
            .collect();
        let mut outcomes = BTreeSet::new();
        for case in fixtures["worlds"].as_array().unwrap() {
            let actual = heard(
                &case["world"],
                "listener",
                &keys,
                &regions,
                Some("person"),
                case["roams"].as_bool().unwrap(),
            )
            .unwrap();
            assert_eq!(actual.unwrap_or(Value::Null), case["expected"]);
            outcomes.insert(case["expected"]["target"].as_str());
        }
        assert_eq!(
            outcomes,
            BTreeSet::from([None, Some("pond"), Some("traveller")])
        );
    }
}
