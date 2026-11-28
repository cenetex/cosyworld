use super::{
    create_geography::Geography, initial_wants, opening, opening_content, pack_state::Catalog,
    resident_evidence::ResidentEvidence,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub(super) struct Custody(BTreeMap<String, usize>);

impl Custody {
    pub(super) fn new(world: &Value) -> Option<Self> {
        let mut counts = BTreeMap::new();
        for item in world["items"].as_object()?.keys() {
            let holder = initial_wants::root(world, item)?;
            *counts.entry(holder.to_owned()).or_default() += 1;
        }
        Some(Self(counts))
    }

    fn take(&mut self, home: &str, actor: &str) -> Option<()> {
        if self.0.get(home) != Some(&1) || self.0.contains_key(actor) {
            return None;
        }
        self.0.remove(home);
        self.0.insert(actor.into(), 1);
        Some(())
    }
}

fn lists(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn includes(values: &Value, id: &str) -> bool {
    lists(values).any(|value| value == id)
}

fn another_way(geo: &Geography, home: &str) -> Option<bool> {
    let files = geo.files();
    Some(
        !geo.base_exits(home)?.is_empty()
            || lists(&files["v2/card-game/forest.json"]["reflectionRoutes"])
                .any(|route| route["from"] == home)
            || lists(&files["v2/card-game/world-life.json"]["guardable"])
                .any(|route| route["from"] == home || route["to"] == home)
            || geo.packs().any(|pack| {
                pack["id"] != "shared-homes"
                    && ["routes", "crossings"]
                        .into_iter()
                        .any(|field| lists(&pack[field]).any(|route| route["from"] == home))
            }),
    )
}

fn item_as_named(name: &str) -> String {
    let possessive = name.split_once(['\'', '’']).is_some_and(|(owner, rest)| {
        !owner.is_empty()
            && owner.chars().all(char::is_alphabetic)
            && (rest.starts_with(' ') || rest.starts_with("s "))
    });
    if possessive
        || ["The ", "A ", "An "]
            .iter()
            .any(|article| name.starts_with(article))
    {
        name.into()
    } else {
        format!("the {name}")
    }
}

pub(super) fn take(
    world: &mut Value,
    geo: &Geography,
    evidence: &ResidentEvidence,
    claimed: &[&str],
    present: &[&str],
    actor: &str,
    custody: &mut Custody,
) -> Option<Option<Value>> {
    if actor == "vale"
        || present.contains(&actor)
        || includes(&world["absent"], actor)
        || world["hidden"]["actor"] == actor
    {
        return Some(None);
    }
    let avatar = lists(&geo.files()["v2/card-game/shared-cast.json"]["avatars"])
        .find(|avatar| avatar["id"] == actor)?;
    let home = avatar["home"]["id"].as_str()?;
    let item = avatar["item"]["id"].as_str()?;
    let resident = world["actors"].get(actor)?;
    let belonging = world["items"].get(item)?;
    let turn = world["turn"].as_u64()?;
    if resident["place"] != home
        || belonging["holder"] != home
        || resident["want"].is_null()
        || resident["sleeping"].get("until").is_some()
        || resident["dwellUntil"]
            .as_u64()
            .is_some_and(|until| until > turn)
        || world["peaceUntil"][actor].as_u64()? > turn
        || resting(resident, turn)
    {
        return Some(None);
    }
    let want = &resident["want"];
    if want["kind"] != "person"
        || !want["step"].is_null()
        || (claimed.contains(&actor) && !resident["under"].is_null())
        || world["actors"]
            .get(want["target"].as_str()?)?
            .get("place")?
            .as_str()?
            == home
    {
        return None;
    }
    let destination = world["doors"][home].as_str()?;
    if !includes(&avatar["home"]["doors"], destination)
        || !geo.entity_active(world, destination)?
        || !geo.entity_active(world, actor)?
        || !geo.entity_active(world, item)?
        || !geo.entity_active(world, home)?
        || another_way(geo, home)?
        || world["actors"]
            .as_object()?
            .iter()
            .any(|(other, resident)| other != actor && resident["place"] == home)
    {
        return None;
    }
    if initial_wants::root(world, item)? != home || world["items"].get(actor).is_some() {
        return None;
    }
    custody.take(home, actor)?;

    let name = avatar["name"].as_str()?;
    let item_name = item_as_named(avatar["item"]["name"].as_str()?);
    let text = format!("{name} takes {item_name}.");
    let history = world["items"][item]["history"].as_array_mut()?;
    history.push(json!(format!("Turn {turn}: {text}")));
    history.drain(..history.len().saturating_sub(12));
    world["items"][item]["holder"] = json!(actor);
    world["actors"][actor]["heldItem"] = json!(item);
    let detail = json!({
        "speaker":"World", "text":text, "kind":"action",
        "verb":"take", "actorId":actor, "locationId":home, "fromLocationId":home,
        "witnesses":[actor,item], "itemId":item, "targetId":null,
    });
    evidence.record(world, &[actor], &[item], detail, true)?;
    Some(Some(world["log"].as_array()?.last()?.clone()))
}

fn resting(resident: &Value, turn: u64) -> bool {
    resident["metTurn"].as_u64().is_some_and(|met| {
        turn.saturating_sub(met) < 3
            && resident["want"]["since"]
                .as_u64()
                .is_some_and(|since| since >= met)
    })
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let input = request.get("world")?;
    let claimed = opening::seats(&request["claimed"])?;
    let present = opening::seats(&request["present"])?;
    let roster = opening::seats(&request["residents"])?;
    let turn = input["turn"].as_u64()?;
    let began = input.get("began").map_or(Some(0), Value::as_u64)?;
    if request["actor"] != "vale"
        || !present.contains(&"vale")
        || !present.iter().all(|id| claimed.contains(id))
        || input["schema"] != 8
        || input["sharedVersion"] != 1
        || input["opening"]["crossed"] != false
        || input["actors"]["vale"]["place"] != "attic"
        || turn.checked_sub(1) != Some(began)
        || !input["standoffs"].as_array()?.is_empty()
        || !input["disabledPacks"].is_null()
        || !lists(&input["log"]).any(|event| {
            event["turn"] == turn
                && event["actorId"] == "vale"
                && event["verb"] == "wait"
                && event["locationId"] == "attic"
                && event["generated"] != true
                && event.get("sleep").is_none()
        })
    {
        return None;
    }
    let files = opening_content::files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geography = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = input.clone();
    world["heldActors"] = json!(claimed);
    world["presentActors"] = json!(present);
    world["controlledActors"] = json!(present);
    let mut events = Vec::new();
    let mut actors = Map::new();
    let mut items = Map::new();
    let mut memories = Map::new();
    let mut custody = Custody::new(&world)?;
    for actor in roster {
        if let Some(event) = take(
            &mut world,
            &geography,
            &evidence,
            &claimed,
            &present,
            actor,
            &mut custody,
        )? {
            let item = event["itemId"].as_str()?;
            let home = event["locationId"].as_str()?;
            actors.insert(actor.into(), world["actors"][actor].clone());
            items.insert(item.into(), world["items"][item].clone());
            for id in [actor, item, home] {
                memories.insert(id.into(), world["memories"][id].clone());
            }
            events.push(event);
        }
    }
    Some(json!({
        "ok":true, "eventSeq":world["eventSeq"], "events":events,
        "actors":actors, "items":items, "memories":memories,
    }))
}
