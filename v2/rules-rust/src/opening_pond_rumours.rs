use super::{opening_content, pack_state::Catalog, Geography};
use serde_json::{json, Value};
use std::cmp::Reverse;

const VALE: &str = "vale";
const PIP: &str = "moth";
const POND: &str = "pond";
const TURNS_PER_DAY: u64 = 48;
const REMEMBERED: usize = 3;

fn rank(actor: &Value, rumour: &Value) -> Option<(Reverse<u8>, Reverse<u64>, u64)> {
    let trusted = |peer: &Value| {
        peer.as_str()
            .and_then(|id| actor["trust"][id].as_u64())
            .is_some_and(|trust| trust >= 2)
    };
    let weight = if actor["want"]["target"] == rumour["subject"]
        || trusted(&rumour["holder"])
        || trusted(&rumour["teller"])
    {
        3
    } else if actor["want"]["kind"] == rumour["kind"] {
        2
    } else {
        1
    };
    Some((
        Reverse(weight),
        Reverse(rumour["day"].as_u64()?),
        rumour["hops"].as_u64()?,
    ))
}

pub(super) fn settle(world: &mut Value, geo: &Geography<'_>, before_seq: u64) -> Option<()> {
    let began = world["began"].as_u64()?;
    let turn = world["turn"].as_u64()?;
    if turn != began.checked_add(1)?
        || geo.files()["v2/card-game/world-history.json"]["turns"] != began
        || world["arrival"]["seq"].as_u64()? != before_seq.checked_add(1)?
        || world["actors"][VALE]["place"] != POND
        || world["actors"][PIP]["place"] != POND
    {
        return None;
    }

    let mut returned = Vec::new();
    for entry in world["log"].as_array()?.iter().rev() {
        if entry["seq"].as_u64()? <= before_seq {
            break;
        }
        if entry["verb"] != "want_met" {
            continue;
        }
        let met = &entry["wantMet"];
        if entry["actorId"] != VALE || entry["locationId"] != POND || met["kind"] != "place" {
            return None;
        }
        let subject = met["target"].as_str()?;
        geo.base_exits(subject)?;
        returned.push(json!({
            "subject":subject,"kind":"place","at":POND,"holder":VALE,
            "teller":null,"hops":0,"day":turn / TURNS_PER_DAY,
        }));
    }
    if returned.is_empty() {
        return Some(());
    }
    if !geo.entity_active(world, PIP)? {
        return None;
    }
    for (id, actor) in world["actors"].as_object()? {
        if id != VALE && id != PIP && actor["place"] == POND && geo.entity_active(world, id)? {
            return None;
        }
    }

    let actor = &world["actors"][PIP];
    let mut heard = match actor.get("rumours") {
        None => Vec::new(),
        Some(value) => value.as_array()?.clone(),
    };
    for rumour in returned {
        heard.retain(|old| old["subject"] != rumour["subject"] || old["kind"] != rumour["kind"]);
        heard.push(rumour);
        let mut ranked = heard
            .into_iter()
            .map(|rumour| Some((rank(actor, &rumour)?, rumour)))
            .collect::<Option<Vec<_>>>()?;
        ranked.sort_by(|(a, left), (b, right)| {
            a.cmp(b)
                .then_with(|| left["subject"].as_str().cmp(&right["subject"].as_str()))
        });
        heard = ranked
            .into_iter()
            .take(REMEMBERED)
            .map(|(_, rumour)| rumour)
            .collect();
    }
    world["actors"][PIP]["rumours"] = json!(heard);
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle(&mut world, &geo, request["beforeSeq"].as_u64()?)?;
    let mut result = json!({"ok":true});
    result["world"] = world;
    Some(result)
}
