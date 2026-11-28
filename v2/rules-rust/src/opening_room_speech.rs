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
const POND: &str = "pond";
const STATION: &str = "station";

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let saved = request.get("world")?;
    let present = opening::seats(&request["present"])?;
    let room = saved["actors"][VALE]["place"].as_str()?;
    if !(saved["turn"] == 2 || (room == STATION && opening_station_view::historic_station(saved)))
        || request["actor"] != VALE
        || request["claimed"] != json!([VALE])
        || (!present.is_empty() && present != [VALE])
        || (!request["room"].is_null() && request["room"] != room)
        || !(request["entries"].is_null()
            || request["entries"].as_array().is_some_and(Vec::is_empty))
    {
        return None;
    }
    let lines = request["lines"].as_array()?;
    if !(1..=4).contains(&lines.len()) {
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
    let voices: &[&str] = match room {
        POND => {
            opening_pond_view::settled_second_move(&world, &geo)?;
            &[VALE, PIP]
        }
        STATION => opening_station_view::settled_speech_voices(&world, &geo, &order)?,
        _ => return None,
    };
    if lines.len() > voices.len() + 1
        || saved["speechVoices"][VALE] != json!(voices)
        || (voices.len() == 3 && present != [VALE])
    {
        return None;
    }
    let cast = opening_roster::known_actors(&world, &geo, &order, Some(room))?;
    if (room == POND && cast.len() != 2) || voices.iter().any(|id| !cast.contains(id)) {
        return None;
    }
    let items = visible_items(&world, &geo, &authored, room)?;
    let forest = &files["v2/card-game/forest.json"];
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
        } else if voices.contains(&voice) {
            let profile = evidence.profile(voice)?;
            if profile["kind"] != "avatar"
                || !(profile["expression"].is_null() || profile["expression"] == "speech")
            {
                return None;
            }
            (profile["name"].as_str()?, "dialogue", Some(voice))
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
