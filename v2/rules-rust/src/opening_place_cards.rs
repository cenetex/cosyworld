use super::{
    opening, opening_wait, pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

fn includes(list: &Value, id: &str) -> bool {
    list.as_array()
        .is_some_and(|entries| entries.iter().any(|entry| entry == id))
}

pub(super) struct Deck<'a> {
    offers: Vec<(&'a str, &'a str)>,
    ships: BTreeSet<&'a str>,
}

impl<'a> Deck<'a> {
    pub(super) fn new(world: &Value, geo: &Geography<'a>) -> Option<Self> {
        let forest = &geo.files()["v2/card-game/forest.json"];
        let mut places: BTreeSet<_> = forest["places"]
            .as_object()?
            .keys()
            .map(String::as_str)
            .collect();
        let mut ships = BTreeSet::new();
        let mut things = BTreeMap::new();
        for pack in geo.packs() {
            places.extend(pack["places"].as_object()?.keys().map(String::as_str));
            for transport in pack["transports"]
                .as_object()
                .into_iter()
                .flat_map(Map::values)
            {
                ships.insert(transport["place"].as_str()?);
            }
            if let Some(items) = pack["items"].as_object() {
                things.extend(items);
            }
        }
        things.extend(forest["things"].as_object()?);
        let mut wanted = BTreeSet::new();
        for (id, actor) in world["actors"].as_object()? {
            if opening::is_seat(id) {
                continue;
            }
            let want = &actor["want"];
            wanted.extend(want["target"].as_str());
            if let Some(items) = want["step"]["items"].as_array() {
                wanted.extend(items.iter().filter_map(Value::as_str));
            }
        }
        let mut offers = Vec::new();
        for (id, definition) in things {
            if let Some(home) = definition["holder"].as_str() {
                if places.contains(home)
                    && definition["locked"].is_null()
                    && definition["sealed"].is_null()
                    && !wanted.contains(id.as_str())
                {
                    offers.push((id.as_str(), home));
                }
            }
        }
        Some(Self { offers, ships })
    }

    pub(super) fn settle(
        &self,
        world: &mut Value,
        geo: &Geography,
        observing: Option<&str>,
    ) -> Option<()> {
        let items = world["items"].as_object()?;
        let actors = world["actors"].as_object()?;
        let mut cards = match world.get("placeCard") {
            Some(cards) => cards.as_object()?.clone(),
            None => Map::new(),
        };
        for (place, item) in cards.clone() {
            let id = item.as_str()?;
            let item = items.get(id)?;
            let discarded = includes(&world["gone"], id) || includes(&world["usedUp"], id);
            if discarded || (item["holder"] == place && includes(&world["placeMet"][&place], id)) {
                cards.remove(&place);
            } else if item["holder"] == place {
                return None;
            }
        }
        for &(id, home) in &self.offers {
            let current = items.get(id)?["holder"].as_str()?;
            if current == home
                || cards.contains_key(home)
                || items.contains_key(current)
                || actors.contains_key(current)
                || self.ships.contains(current)
                || includes(&world["placeMet"][home], id)
                || includes(&world["gone"], id)
                || includes(&world["usedUp"], id)
            {
                continue;
            }
            if geo.entity_active(world, id)? {
                cards.insert(home.to_owned(), json!(id));
            }
        }
        if observing.is_some_and(|place| cards.contains_key(place)) {
            return None;
        }
        let world = world.as_object_mut()?;
        if cards.is_empty() {
            world.remove("placeCard");
        } else {
            world.insert("placeCard".to_owned(), Value::Object(cards));
        }
        Some(())
    }

    pub(super) fn settle_return(
        &self,
        world: &mut Value,
        geo: &Geography,
        evidence: &ResidentEvidence,
    ) -> Option<Option<Value>> {
        let returned =
            completed_at_home(world)?.map(|(home, item)| (home.to_owned(), item.to_owned()));
        let event = match returned {
            Some((home, item)) => Some(record_return(world, geo, evidence, &home, &item)?),
            None => None,
        };
        self.settle(world, geo, Some("attic"))?;
        Some(event)
    }
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (mut world, _, files) = opening_wait::begin(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    for field in ["presentActors", "controlledActors"] {
        world[field] = request["present"].clone();
    }
    Deck::new(&world, &geo)?.settle(&mut world, &geo, Some("attic"))?;
    Some(json!({"ok":true,"placeCard":world["placeCard"]}))
}

fn completed_at_home(world: &Value) -> Option<Option<(&str, &str)>> {
    let mut returned = None;
    for (home, card) in world["placeCard"].as_object().into_iter().flatten() {
        let item = card.as_str()?;
        if world["items"].get(item)?["holder"] == *home
            && !includes(&world["gone"], item)
            && !includes(&world["usedUp"], item)
            && !includes(&world["placeMet"][home], item)
        {
            if returned.is_some() {
                return None;
            }
            returned = Some((home.as_str(), item));
        }
    }
    Some(returned)
}

fn record_return(
    world: &mut Value,
    geo: &Geography,
    evidence: &ResidentEvidence,
    home: &str,
    item: &str,
) -> Option<Value> {
    let from = format!("quest:place:{home}");
    for actor in world["actors"].as_object()?.values() {
        let held = actor["under"].as_array().into_iter().flatten();
        if std::iter::once(&actor["want"])
            .chain(held)
            .any(|want| want["from"] == from)
        {
            return None;
        }
    }
    let files = geo.files();
    let forest = &files["v2/card-game/forest.json"];
    let place = forest["places"][home]["name"].as_str().or_else(|| {
        geo.packs()
            .find_map(|pack| pack["places"][home]["name"].as_str())
    })?;
    let belonging = forest["things"]
        .get(item)
        .or_else(|| geo.packs().find_map(|pack| pack["items"].get(item)))?;
    if belonging["holder"] != home {
        return None;
    }
    let vale = forest["people"]["vale"]["name"].as_str()?;
    let turn = world["turn"].as_u64()?;
    let terms = json!(["place", home, [["items", [item]], ["verb", "lay"]], null]);
    let key = format!("vale:place:{home}:{turn}::{terms}");
    let event = json!({
        "speaker":"World", "text":format!("{vale} reaches {place}."),
        "kind":"narration", "actorId":"vale", "locationId":"attic", "verb":"want_met", "ownerId":home,
        "wantMet":{"kind":"place","target":home}, "wantKey":key,
    });
    let fields = world.as_object_mut()?;
    let met = fields.entry("placeMet").or_insert_with(|| json!({}));
    met.as_object_mut()?
        .entry(home)
        .or_insert_with(|| json!([]))
        .as_array_mut()?
        .push(json!(item));
    evidence.record(world, &["vale"], &["lamp"], event, true)?;
    world["log"].as_array()?.last().cloned()
}

pub(super) fn returned_projection(request: &Value) -> Option<Value> {
    if request["claimed"] != json!(["vale"]) || request["present"] != json!(["vale"]) {
        return None;
    }
    let (mut world, _, files) = opening_wait::begin(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let deck = Deck::new(&world, &geo)?;
    let evidence = ResidentEvidence::new(&files)?;
    let event = deck.settle_return(&mut world, &geo, &evidence)??;
    Some(json!({
        "ok":true, "event":event, "placeCard":world["placeCard"], "placeMet":world["placeMet"],
        "memories":{
            "vale":world["memories"]["vale"], "attic":world["memories"]["attic"],
            "lamp":world["memories"]["lamp"],
        },
    }))
}
