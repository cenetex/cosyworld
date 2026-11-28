use super::{
    opening_attic_rest, opening_content, opening_pond_ship_board, opening_pond_ship_course,
    opening_quiet_life, opening_roaming, opening_wants, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
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

pub(super) fn settle_course_after_sailing(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    evidence: &ResidentEvidence,
) -> Option<()> {
    let boarding = opening_pond_ship_board::arrival(before)?;
    let course = opening_pond_ship_course::event(world)?;
    let log = world["log"].as_array()?;
    let [.., previous, selected, castoff] = log.as_slice() else {
        return None;
    };
    let ship = world.get("transports")?.get("greek-ship")?;
    let ship_name = evidence.profile("greek-ship")?["name"].as_str()?;
    let harbor = evidence.profile("greek-harbor")?["name"].as_str()?;
    let castoff_seq = boarding.checked_add(2)?;
    if course != selected
        || course["seq"] != boarding.checked_add(1)?
        || world["eventSeq"] != castoff["seq"]
        || previous != before["log"].as_array()?.last()?
        || world["revision"] != before["revision"].as_u64()?.checked_add(1)?
        || ["arrival", "items", "life", "crossings"]
            .iter()
            .any(|field| world[*field] != before[*field])
        || ship["phase"] != "sea"
        || ship["dock"] != "pond"
        || ship["riders"] != json!([])
        || !ship["recall"].is_null()
        || *castoff
            != json!({
                "seq":castoff_seq, "turn":9, "speaker":"World", "kind":"narration",
                "actorId":null, "locationId":"greek-ship", "cast":course["cast"],
                "items":course["items"], "light":course["light"],
                "text":format!("{ship_name} casts off for {harbor}."),
            })
    {
        return None;
    }
    opening_wants::settle_ship_wants(world, geo, 9)?;
    opening_attic_rest::settle_visit_speech(before, world, false)
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
        _ => return None,
    }
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
