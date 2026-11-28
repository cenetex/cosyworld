use serde_json::{json, Map, Value};

pub(super) struct Catalog<'a> {
    compiled: &'a [Value],
    homes: Value,
    boardy: &'a Value,
}

impl<'a> Catalog<'a> {
    pub(super) fn from_files(files: &'a Value) -> Option<Self> {
        Some(Self {
            compiled: files["v2/card-game/packs.json"]["packs"].as_array()?,
            homes: home_pack(files.get("v2/card-game/shared-cast.json")?)?,
            boardy: files.get("v2/card-game/boardyai.json")?,
        })
    }

    pub(super) fn packs(&self) -> impl Iterator<Item = &Value> + Clone {
        self.compiled.iter().chain([&self.homes, self.boardy])
    }
}

#[derive(Default)]
struct Mounted {
    actors: Map<String, Value>,
    items: Map<String, Value>,
    peace: Map<String, Value>,
    packs: Map<String, Value>,
    crossings: Map<String, Value>,
    transports: Map<String, Value>,
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let mut world = request.get("world")?.clone();
    mount(&mut world, &content["files"])?;
    Some(json!({"ok": true, "world": world}))
}

pub(super) fn mount(world: &mut Value, files: &Value) -> Option<()> {
    let world = world.as_object_mut()?;
    if ["packs", "crossings", "transports"]
        .iter()
        .any(|key| world.contains_key(*key))
    {
        return None;
    }
    let mut mounted = Mounted {
        actors: world.get("actors")?.as_object()?.clone(),
        items: world.get("items")?.as_object()?.clone(),
        peace: world.get("peaceUntil")?.as_object()?.clone(),
        ..Default::default()
    };
    let forest = files.get("v2/card-game/forest.json")?;
    for (id, item) in forest["initialState"]["items"].as_object()? {
        mounted.items.entry(id).or_insert_with(|| item.clone());
    }
    for (id, actor) in forest["people"].as_object()? {
        if !mounted.actors.contains_key(id) {
            mounted.add_actor(id, actor["place"].as_str()?, None)?;
        }
    }
    let catalog = Catalog::from_files(files)?;
    for pack in catalog.packs() {
        mounted.add_pack(pack)?;
    }

    let ids: Vec<_> = mounted.actors.keys().cloned().collect();
    for (id, actor) in &mut mounted.actors {
        let trust = actor.get_mut("trust")?.as_object_mut()?;
        for other in ids.iter().filter(|other| *other != id) {
            trust.entry(other).or_insert_with(|| json!(0));
        }
    }
    for pack in catalog.packs() {
        for (id, actor) in pack["avatars"].as_object()? {
            let Some(bonds) = actor["bonds"].as_object() else {
                continue;
            };
            let trust = mounted
                .actors
                .get_mut(id)?
                .get_mut("trust")?
                .as_object_mut()?;
            for (other, bond) in bonds {
                if let Some(value) = trust.get_mut(other) {
                    *value = bond.clone();
                }
            }
        }
    }
    for (key, records) in [
        ("actors", mounted.actors),
        ("items", mounted.items),
        ("peaceUntil", mounted.peace),
        ("packs", mounted.packs),
        ("crossings", mounted.crossings),
        ("transports", mounted.transports),
    ] {
        world.insert(key.to_owned(), Value::Object(records));
    }
    Some(())
}

impl Mounted {
    fn add_actor(&mut self, id: &str, place: &str, temperament: Option<&Value>) -> Option<()> {
        let mut actor = json!({"place": place, "crossed": 0, "lastTalk": -9, "trust": {}});
        if let Some(temperament) = temperament {
            actor["awake"] = json!(temperament["asleep"] != true);
            actor["irritation"] = json!(0);
            actor["wakeCause"] = Value::Null;
        }
        self.peace.insert(id.into(), json!(0));
        insert(&mut self.actors, id, actor)
    }

    fn add_pack(&mut self, pack: &Value) -> Option<()> {
        let id = pack["id"].as_str()?;
        insert(&mut self.packs, id, pack_record(pack)?)?;
        for (id, actor) in pack["avatars"].as_object()? {
            self.add_actor(id, actor["place"].as_str()?, actor.get("temperament"))?;
        }
        for (id, item) in pack["items"].as_object().into_iter().flatten() {
            let holder = item["holder"].as_str()?;
            insert(
                &mut self.items,
                id,
                json!({"holder": holder, "history": []}),
            )?;
        }
        for crossing in pack["crossings"].as_array()? {
            let id = crossing["id"].as_str()?;
            let state = if crossing["signal"].is_object() && crossing["unlockWhen"].is_null() {
                json!({"discovered": false,"phase": 0,"until": 0})
            } else {
                json!({"discovered": false})
            };
            insert(&mut self.crossings, id, state)?;
        }
        for (id, transport) in pack["transports"].as_object().into_iter().flatten() {
            let dock = transport["at"].as_str()?;
            insert(
                &mut self.transports,
                id,
                json!({
                    "version": 3,"phase": "docked","dock": dock,"destination": null,
                    "riders": [],"since": 0,"recall": null,
                }),
            )?;
        }
        Some(())
    }
}

fn insert(records: &mut Map<String, Value>, id: &str, value: Value) -> Option<()> {
    records.insert(id.into(), value).is_none().then_some(())
}

fn pack_record(pack: &Value) -> Option<Value> {
    let revision = pack["revision"].as_u64()?;
    let sounds: Map<String, Value> = pack["fixtures"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, _)| (id.clone(), json!(0)))
        .collect();
    let mut record = json!({"revision": revision, "sounds": sounds});
    if pack["recital"].is_object() {
        record["recitals"] = json!({});
    }
    if pack["choices"].is_array() {
        for field in ["choices", "flags", "receipts", "met"] {
            record[field] = json!({});
        }
        record["scope"] = json!(if pack["release"].is_object() {
            "opening"
        } else {
            "full"
        });
    }
    Some(record)
}

fn home_pack(cast: &Value) -> Option<Value> {
    let (mut places, mut actors, mut items) = (Map::new(), Map::new(), Map::new());
    let mut crossings = Vec::new();
    let mut entry = None;
    let gate = json!({"kind": "shared_world"});
    for avatar in cast["avatars"].as_array()? {
        let id = avatar["id"].as_str()?;
        if id == "vale" {
            continue;
        }
        let home = &avatar["home"];
        let place = home["id"].as_str()?;
        entry.get_or_insert(place);
        let item = &avatar["item"];
        let item_id = item["id"].as_str()?;
        let entrance = &home["entrance"];
        insert(
            &mut places,
            place,
            json!({
                "name": home["name"], "text": home["text"], "persona": home["text"],
                "requires": [gate], "exits": [], "backdrop": home["image"],
            }),
        )?;
        insert(
            &mut actors,
            id,
            json!({
                "name": avatar["name"], "text": avatar["text"], "place": place, "home": place,
                "seed": avatar["seed"], "requires": [gate], "portrait": avatar["image"],
                "tastes": {"likes": avatar["pleasure"], "sore": "Someone deciding for them", "reason": avatar["pleasure"]},
                "values": {item_id: 8},
            }),
        )?;
        insert(
            &mut items,
            item_id,
            json!({
                "name": item["name"], "requires": [gate], "holder": id, "art": item["image"],
                "text": format!("{}. {}", item["verb"].as_str()?, entrance["text"].as_str()?),
                "persona": format!("{}. {}.", item["name"].as_str()?, item["effect"].as_str()?),
            }),
        )?;
        for door in home["doors"].as_array()? {
            let door = door.as_str()?;
            let here = json!({"kind": "home_door", "home": place, "place": door});
            crossings.push(json!({
                "id": format!("{door}-{place}"), "from": door, "to": place, "travelers": "player",
                "requires": [gate, here, {"kind": "item_near", "item": item_id, "place": door}],
                "travel": format!("through {}", entrance["name"].as_str()?.to_lowercase()),
                "scenery": {"open": entrance["text"], "cardArt": home["image"]}, "sealed": {},
            }));
            crossings.push(json!({
                "id": format!("{place}-{door}"), "from": place, "to": door, "travelers": "player",
                "requires": [gate, here, {"kind": "item_near", "item": item_id, "place": place},
                    {"kind": "not", "condition": {"kind": "item_at", "item": item_id, "place": place}}],
                "travel": "back outside",
            }));
        }
    }
    Some(json!({
        "schemaVersion": 1, "id": "shared-homes", "packId": "cosyworld.shared-homes", "revision": 1,
        "name": "Homes beside the shore", "description": "Seven visitors bring their belongings and homes to the existing shore.",
        "entry": entry?, "bridge": {"id": "shared-homes-shore", "description": "A visitor's belonging opens the way to their home."},
        "choices": [], "places": places, "avatars": actors, "items": items, "crossings": crossings,
    }))
}
