use super::{
    lamp_state, opening, opening_crossings, opening_drop, opening_pickups, opening_play,
    opening_reflection::valid_text, opening_view, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography, LampPosition,
};
use serde_json::{json, Map, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";
const LAMP: &str = "lamp";
const TAKE: &str = "take:vale:lamp:";

fn take_world(request: &Value) -> Option<&Value> {
    let world = opening::supported_after_first_turn(request)?;
    let action = &request["action"];
    if request["actor"] != VALE
        || opening::seats(&request["claimed"])? != [VALE]
        || opening::seats(&request["present"])? != [VALE]
        || !request["selectedIds"].is_null()
        || (!request["revision"].is_null() && request["revision"] != world["revision"])
        || action["kind"] == "pack"
        || action.as_str().or_else(|| action["key"].as_str()) != Some(TAKE)
    {
        return None;
    }
    Some(world)
}

fn first_drop_revision(world: &Value, drop: &Value) -> Option<()> {
    let revision = world["revision"].as_u64()?;
    let event_seq = world["eventSeq"].as_u64()?;
    let log = world["log"].as_array()?;
    let last_seq = log.iter().try_fold(0, |previous, event| {
        let seq = event["seq"].as_u64()?;
        (seq > previous && seq <= event_seq).then_some(seq)
    })?;
    let committed = log.iter().rposition(|entry| entry["generated"] != true)?;
    let published = &log[committed + 1..];
    if published.is_empty() {
        return (1..=2).contains(&revision).then_some(());
    }
    if last_seq != event_seq
        || event_seq.checked_sub(log[committed]["seq"].as_u64()?)? != published.len() as u64
        || world["speechVoices"][VALE] != json!([VALE])
    {
        return None;
    }

    let mut min_publications = 0;
    let mut unmatched = None;
    for event in published {
        let scenic = match (
            event["kind"].as_str(),
            event["entityId"].as_str(),
            &event["actorId"],
        ) {
            (Some("narration"), Some(ATTIC), Value::Null) => true,
            (Some("dialogue"), Some(VALE), actor) if actor == VALE => false,
            _ => return None,
        };
        if event["turn"] != 1
            || event["locationId"] != ATTIC
            || event["cast"] != drop["cast"]
            || event["light"] != drop["light"]
            || event["items"] != drop["items"]
            || !event["verb"].is_null()
            || !event["text"]
                .as_str()
                .is_some_and(|text| valid_text(text, 600))
        {
            return None;
        }
        if unmatched.is_some_and(|first| first != scenic) {
            unmatched = None;
        } else {
            min_publications += 1;
            unmatched = Some(scenic);
        }
    }
    (1 + min_publications..=2 + published.len() as u64)
        .contains(&revision)
        .then_some(())
}

fn after_drop(world: &Value) -> Option<()> {
    opening_play::quiet_attic_scene(world)?;
    if world["turn"] != 1
        || world["actors"][VALE].get("want") != Some(&Value::Null)
        || world["memories"][VALE]["learning"]
            .as_array()
            .is_some_and(|trials| !trials.is_empty())
    {
        return None;
    }
    let drop = opening_drop::grounding_committed(world)?;
    let custody_note = format!("Turn 1: {}", drop["text"].as_str()?);
    if world["items"][LAMP]["history"]
        .as_array()?
        .last()?
        .as_str()?
        != custody_note
    {
        return None;
    }
    first_drop_revision(world, drop)
}

pub(super) fn begin(
    before: &Value,
    geo: &Geography,
    evidence: &ResidentEvidence,
) -> Option<(Value, Value)> {
    after_drop(before)?;
    let files = geo.files();
    if opening_view::other_attic_content(files)?
        || !geo.entity_active(before, LAMP)?
        || geo.packs().any(|pack| {
            pack["choices"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|choice| {
                    (choice["on"] == "meet" && choice["at"] == ATTIC)
                        || (choice["on"] == "hold" && choice["subject"] == LAMP)
                })
        })
    {
        return None;
    }
    opening_crossings::no_crossing_unlocks(before, geo)?;
    let forest = &files["v2/card-game/forest.json"];
    let name = forest["people"][VALE]["name"].as_str()?;
    let item = opening_pickups::item_as_named(forest["things"][LAMP]["name"].as_str()?);
    let text = format!("{name} takes {item}.");
    let turn = before["turn"].as_u64()?.checked_add(1)?;
    let revision = before["revision"].as_u64()?.checked_add(1)?;
    let mut world = before.clone();
    world["turn"] = turn.into();
    world["revision"] = revision.into();
    let vale = world["actors"][VALE].as_object_mut()?;
    vale.remove("offered");
    vale.remove("guarding");
    vale.insert("heldItem".into(), json!(LAMP));
    let lamp = &mut world["items"][LAMP];
    lamp["holder"] = json!(VALE);
    let history = lamp["history"].as_array_mut()?;
    history.push(json!(format!("Turn {turn}: {text}")));
    history.drain(..history.len().saturating_sub(12));
    lamp_state(lamp)
        .ok()?
        .settle(LampPosition {
            place: ATTIC.into(),
            held: true,
            grounded: false,
        })
        .write(lamp);
    opening_crossings::no_crossing_unlocks(&world, geo)?;
    let detail = json!({
        "speaker":"World", "text":text, "kind":"action", "verb":"take", "actorId":VALE,
        "locationId":ATTIC, "fromLocationId":ATTIC, "itemId":LAMP, "targetId":null,
        "witnesses":[VALE,LAMP],
    });
    evidence.record(&mut world, &[VALE], &[LAMP], detail, true)?;
    let event = world["log"].as_array()?.last()?.clone();
    Some((world, event))
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = take_world(request)?;
    let files = opening_play::attic_content_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (world, event) = begin(before, &geo, &evidence)?;
    let memories: Map<_, _> = [VALE, ATTIC, LAMP]
        .into_iter()
        .map(|id| (id.to_owned(), world["memories"][id].clone()))
        .collect();
    Some(json!({
        "ok":true, "turn":world["turn"], "revision":world["revision"], "event":event,
        "lamp":world["items"][LAMP], "heldItem":world["actors"][VALE]["heldItem"], "memories":memories,
    }))
}
