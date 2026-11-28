use super::{
    opening::{self, MAX_REVISION},
    opening_content, opening_mirror_move, opening_pond_view,
    opening_reflection::{trim_text, valid_text},
    opening_roster,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const VALE: &str = "vale";
const PIP: &str = "moth";
const POND: &str = "pond";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let present = opening::seats(&request["present"])?;
    if saved["turn"] != 2
        || request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || (!request["room"].is_null() && request["room"] != POND)
        || !(request["entries"].is_null()
            || request["entries"].as_array().is_some_and(Vec::is_empty))
        || saved["speechVoices"][VALE] != json!([VALE, PIP])
    {
        return None;
    }
    let lines = request["lines"].as_array()?;
    if !(1..=3).contains(&lines.len()) {
        return None;
    }
    let revision = saved["revision"].as_u64()?.checked_add(1)?;
    if revision > MAX_REVISION {
        return None;
    }
    let order = opening_roster::actor_order(request, saved)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = saved.clone();
    world["playerActorId"] = json!(VALE);
    world["heldActors"] = json!([VALE]);
    world["controlledActors"] = json!(present);
    world["presentActors"] = json!(present);
    opening_pond_view::settled_second_move(&world, &geo)?;
    let cast = opening_roster::known_actors(&world, &geo, &order, Some(POND))?;
    if !cast.contains(&VALE) || !cast.contains(&PIP) || cast.len() != 2 {
        return None;
    }
    let items = opening_mirror_move::pond_items(&world, &geo, &authored)?;
    let forest = &files["v2/card-game/forest.json"];
    let profiles = &files["v2/card-game/entity-profiles.json"];
    let mut spoken = BTreeSet::new();
    let mut published = Vec::with_capacity(lines.len());
    for line in lines {
        if !line["disclosed"].is_null()
            || line.get("elysiumName").is_some()
            || !(line["actorId"].is_null() || line["actorId"].is_string())
        {
            return None;
        }
        let voice = line["actorId"].as_str().or(line["entityId"].as_str())?;
        if !spoken.insert(voice) {
            return None;
        }
        let (name, kind, actor) = match voice {
            POND if line["actorId"].is_null() => {
                (forest["places"][POND]["name"].as_str()?, "narration", None)
            }
            VALE | PIP
                if profiles[voice]["kind"] == "avatar"
                    && (profiles[voice]["expression"].is_null()
                        || profiles[voice]["expression"] == "speech") =>
            {
                (
                    forest["people"][voice]["name"].as_str()?,
                    "dialogue",
                    Some(voice),
                )
            }
            _ => return None,
        };
        let line = line["text"].as_str()?;
        if !valid_text(line, 600) || !valid_text(name, 48) {
            return None;
        }
        let detail = json!({
            "speaker":name, "text":trim_text(line), "kind":kind, "actorId":actor,
            "entityId":voice, "locationId":POND,
        });
        published.push(evidence.publish(&mut world, &cast, &items, detail)?);
    }
    world["revision"] = revision.into();
    let mut response = opening::stored_response(world)?;
    response["lines"] = json!(published);
    Some(response)
}
