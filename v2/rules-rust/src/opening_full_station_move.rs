use super::{
    opening_attic_rest, opening_content, opening_full_move, opening_held_items,
    opening_place_cards::Deck, opening_quiet_life, opening_roaming, opening_roster,
    opening_second_attic_lamp, opening_second_attic_tail, opening_second_round, opening_settlement,
    opening_station_move, opening_station_residents, opening_station_view, opening_wants,
    pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let (before, carry) = opening_station_move::move_world(request)?;
    if before.get("began").is_some() {
        return None;
    }
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (mut world, residents) = opening_station_move::begin_with(
        before,
        &geo,
        &authored,
        &order,
        &evidence,
        carry,
        |world| {
            let known = opening_roster::known_actors(world, &geo, &order, None)?;
            opening_roster::residents(world, &geo, &known, "vale")
        },
    )?;
    let visits = &mut world["actors"]["vale"]["visited"];
    if *visits != json!(["attic", "pond"])
        || files["v2/card-game/forest.json"]["places"]["station"]["sanctuary"] == true
    {
        return None;
    }
    visits.as_array_mut()?.push(json!("station"));
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    opening_station_residents::settle(&mut world, &geo, &authored, &order, &evidence)?;
    opening_second_round::settle_visitors(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_station(&mut world, &geo)?;
    opening_second_attic_tail::verify_stops(&world, &geo)?;
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    let hands = opening_held_items::snapshot(before, &geo)?;
    opening_held_items::settle_from(&mut world, &geo, Some(&hands))?;
    opening_second_attic_lamp::settle_station(&mut world, &geo)?;
    opening_second_attic_tail::verify_wake(&world)?;
    opening_full_move::quiet_ways(before, &world, &geo, true)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_station(&mut world, &geo)?;
    opening_second_attic_tail::verify_final(before, &world, &geo)?;
    opening_attic_rest::settle_visit_speech(before, &mut world, false)?;
    opening_second_attic_tail::verify_wayfinder(&world, &geo)?;
    opening_held_items::settle_from(&mut world, &geo, Some(&hands))?;
    opening_second_attic_lamp::settle_station(&mut world, &geo)?;
    opening_second_attic_tail::verify_station(&world, &geo)?;
    opening_station_view::completed_station_response_with_profiles(
        world,
        &geo,
        &authored,
        before_seq,
        &order,
        &["vale"],
        || Some(evidence.into_profiles()),
    )
}
