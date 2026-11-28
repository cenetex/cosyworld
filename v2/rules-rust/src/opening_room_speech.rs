use super::{
    opening::{self, MAX_REVISION},
    opening_content,
    opening_full_wait::visible_items,
    opening_pond_view,
    opening_reflection::{trim_text, valid_text},
    opening_roster, opening_station_view,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const VALE: &str = "vale";
const PIP: &str = "moth";
const KEEPER: &str = "keeper";
const POND: &str = "pond";
const STATION: &str = "station";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let present = opening::seats(&request["present"])?;
    let (room, respondent) = match saved["actors"][VALE]["place"].as_str()? {
        POND => (POND, PIP),
        STATION => (STATION, KEEPER),
        _ => return None,
    };
    if saved["turn"] != 2
        || request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || (!request["room"].is_null() && request["room"] != room)
        || !(request["entries"].is_null()
            || request["entries"].as_array().is_some_and(Vec::is_empty))
        || saved["speechVoices"][VALE] != json!([VALE, respondent])
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
    let party: &[&str] = if room == POND {
        opening_pond_view::settled_second_move(&world, &geo)?;
        &[VALE, PIP]
    } else {
        opening_station_view::settled_first_arrival(&world, &geo, &order)?;
        &[VALE, PIP, KEEPER]
    };
    let cast = opening_roster::known_actors(&world, &geo, &order, Some(room))?;
    if cast.len() != party.len() || party.iter().any(|id| !cast.contains(id)) {
        return None;
    }
    let items = visible_items(&world, &geo, &authored, room)?;
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
        let (name, kind, actor) = if voice == room && line["actorId"].is_null() {
            (forest["places"][room]["name"].as_str()?, "narration", None)
        } else if [VALE, respondent].contains(&voice)
            && profiles[voice]["kind"] == "avatar"
            && (profiles[voice]["expression"].is_null()
                || profiles[voice]["expression"] == "speech")
        {
            (
                forest["people"][voice]["name"].as_str()?,
                "dialogue",
                Some(voice),
            )
        } else {
            return None;
        };
        let line = line["text"].as_str()?;
        if !valid_text(line, 600) || !valid_text(name, 48) {
            return None;
        }
        let detail = json!({
            "speaker":name, "text":trim_text(line), "kind":kind, "actorId":actor,
            "entityId":voice, "locationId":room,
        });
        published.push(evidence.publish(&mut world, &cast, &items, detail)?);
    }
    world["revision"] = revision.into();
    let mut response = opening::stored_response(world)?;
    response["lines"] = json!(published);
    Some(response)
}
