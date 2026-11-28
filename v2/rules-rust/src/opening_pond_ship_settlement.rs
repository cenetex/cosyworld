use super::{
    opening_attic_rest, opening_content, opening_pond_ship_board, opening_pond_ship_course,
    opening_quiet_life, opening_roaming, opening_wants, pack_state::Catalog, Geography,
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

pub(super) fn projection(request: &Value) -> Option<Value> {
    let before = request.get("before")?;
    let mut world = request.get("world")?.clone();
    let seq = opening_pond_ship_board::arrival(&world)?;
    if before["turn"] != 7
        || before["eventSeq"].as_u64()?.checked_add(1)? != seq
        || world["revision"] != before["revision"].as_u64()?.checked_add(1)?
        || before["actors"]["vale"]["place"] != "pond"
        || before["items"]["lamp"] != world["items"]["lamp"]
    {
        return None;
    }
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_first_board(&mut world, &geo)?;
    opening_wants::settle_first_board(&mut world, &geo)?;
    opening_attic_rest::settle_visit_speech(before, &mut world, false)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
