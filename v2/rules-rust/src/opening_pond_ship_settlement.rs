use super::{
    opening_attic_rest, opening_content, opening_pond_ship_board, opening_pond_ship_course,
    opening_pond_ship_wait, opening_quiet_life, opening_roaming, opening_wants,
    pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

pub(super) fn course_before_sailing(world: &Value) -> Option<u64> {
    let event = opening_pond_ship_course::event(world)?;
    let seq = event["seq"].as_u64()?;
    (world["transports"]["greek-ship"]["phase"] == "course"
        && world["eventSeq"] == seq
        && world["log"].as_array()?.last()? == event)
        .then_some(seq)
}

fn settle_board(before: &Value, world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    let seq = opening_pond_ship_board::arrival(world)?;
    if before["turn"] != 7
        || before["eventSeq"].as_u64()?.checked_add(1)? != seq
        || world["revision"] != before["revision"].as_u64()?.checked_add(1)?
        || before["actors"]["vale"]["place"] != "pond"
        || before["items"]["lamp"] != world["items"]["lamp"]
    {
        return None;
    }
    opening_roaming::settle_dwell(world, geo)?;
    opening_quiet_life::verify_first_board(world, geo)?;
    opening_wants::settle_first_board(world, geo)?;
    opening_attic_rest::settle_visit_speech(before, world, false)
}

pub(super) fn settle_course_before_sailing(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    if world["turn"] != 9 {
        return None;
    }
    opening_roaming::settle_dwell(world, geo)?;
    opening_quiet_life::verify_ship_life(world, geo)
}

pub(super) fn settle_wait_before_docking(world: &mut Value, geo: &Geography<'_>) -> Option<()> {
    if world["turn"] != 10 {
        return None;
    }
    opening_roaming::settle_dwell(world, geo)?;
    opening_quiet_life::verify_ship_life(world, geo)
}

fn verify_voyage_suffix(
    before: &Value,
    world: &Value,
    action: &Value,
    narration: &Value,
    text: &str,
) -> Option<()> {
    let log = world["log"].as_array()?;
    let [.., previous, selected, narrated] = log.as_slice() else {
        return None;
    };
    let head = before["eventSeq"].as_u64()?;
    let seq = head.checked_add(2)?;
    (action == selected
        && action["seq"] == head.checked_add(1)?
        && narration == narrated
        && world["eventSeq"] == seq
        && previous == before["log"].as_array()?.last()?
        && previous["seq"] == head
        && world["revision"] == before["revision"].as_u64()?.checked_add(1)?
        && ["arrival", "items", "life", "crossings"]
            .iter()
            .all(|field| world[*field] == before[*field])
        && *narration
            == json!({
                "seq":seq, "turn":action["turn"], "speaker":"World", "kind":"narration",
                "actorId":null, "locationId":"greek-ship", "cast":action["cast"],
                "items":action["items"], "light":action["light"], "text":text,
            }))
    .then_some(())
}

pub(super) fn settle_course_after_sailing(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    evidence: &ResidentEvidence,
) -> Option<()> {
    let boarding = opening_pond_ship_board::arrival_event(before)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let course = opening_pond_ship_course::event(world)?;
    let castoff = world["log"].as_array()?.last()?;
    let ship = world.get("transports")?.get("greek-ship")?;
    let ship_name = evidence.profile("greek-ship")?["name"].as_str()?;
    let harbor = evidence.profile("greek-harbor")?["name"].as_str()?;
    if before_seq < boarding["seq"].as_u64()?
        || ship["phase"] != "sea"
        || ship["dock"] != "pond"
        || ship["riders"] != json!([])
        || !ship["recall"].is_null()
    {
        return None;
    }
    verify_voyage_suffix(
        before,
        world,
        course,
        castoff,
        &format!("{ship_name} casts off for {harbor}."),
    )?;
    opening_wants::settle_ship_wants(world, geo, 9)?;
    opening_attic_rest::settle_visit_speech(before, world, false)
}

pub(super) fn settle_wait_after_docking(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    evidence: &ResidentEvidence,
) -> Option<()> {
    let course = opening_pond_ship_course::event(before)?;
    let wait = opening_pond_ship_wait::wait_event(world)?;
    let docking = opening_pond_ship_wait::docking_event(world)?;
    let ship = world.get("transports")?.get("greek-ship")?;
    let riders: &[&str] = if world["actors"]["ada"]["place"] == "greek-ship" {
        &["ada", "vale"]
    } else {
        &["vale"]
    };
    let speech = json!({"place":"greek-ship","turn":null});
    let lane = json!([
        ["sea:greek-harbor", "sea:pond"],
        ["sea:pond", "sea:greek-harbor"]
    ]);
    if before["eventSeq"] != course["seq"].as_u64()?.checked_add(1)?
        || before["transports"]["greek-ship"]["phase"] != "sea"
        || before["actors"]["vale"]["waitSpeech"] != speech
        || world["actors"]["vale"]["waitSpeech"] != speech
        || ship["version"] != 3
        || !ship["destination"].is_null()
        || !ship["recall"].is_null()
        || ship["riders"] != json!(riders)
        || riders.iter().any(|id| world["routeKnowledge"][*id] != lane)
    {
        return None;
    }
    let ship_name = evidence.profile("greek-ship")?["name"].as_str()?;
    let harbor = evidence.profile("greek-harbor")?["name"].as_str()?;
    verify_voyage_suffix(
        before,
        world,
        wait,
        docking,
        &format!("{ship_name} docks at {harbor}."),
    )?;
    opening_wants::settle_ship_wants(world, geo, 10)?;
    opening_attic_rest::settle_visit_speech(before, world, true)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let mut world = request.get("world")?.clone();
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    match request["op"].as_str()? {
        "opening_pond_ship_settlement" => settle_board(request.get("before")?, &mut world, &geo)?,
        "opening_ship_course_before_sailing" => settle_course_before_sailing(&mut world, &geo)?,
        "opening_ship_course_after_sailing" => settle_course_after_sailing(
            request.get("before")?,
            &mut world,
            &geo,
            &ResidentEvidence::new(&files)?,
        )?,
        "opening_ship_wait_before_docking" => settle_wait_before_docking(&mut world, &geo)?,
        "opening_ship_wait_after_docking" => settle_wait_after_docking(
            request.get("before")?,
            &mut world,
            &geo,
            &ResidentEvidence::new(&files)?,
        )?,
        _ => return None,
    }
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
