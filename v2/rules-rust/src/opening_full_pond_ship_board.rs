use super::{
    opening_attic_rest, opening_content, opening_full_move, opening_held_items,
    opening_place_cards::Deck, opening_pond_ship_board, opening_pond_ship_view, opening_quiet_life,
    opening_roaming, opening_roster, opening_second_attic_tail as tail, opening_settlement,
    opening_station_departure_residents, opening_wants, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::Value;

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let (before, carry) = opening_pond_ship_board::boarding_world(request)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (mut world, residents) = opening_pond_ship_board::begin_with(
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
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    opening_station_departure_residents::settle(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_first_board(&mut world, &geo)?;
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    opening_held_items::settle(&mut world, &geo, Some(before))?;
    if world["items"]["lamp"] != before["items"]["lamp"] {
        return None;
    }
    opening_full_move::quiet_ways(before, &world, &geo, false)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_first_board(&mut world, &geo)?;
    opening_quiet_life::verify_home_levels(&world, &geo)?;
    tail::sealed_at_rest(&world, &geo)?;
    tail::guards_stable(&world, &geo)?;
    opening_attic_rest::settle_visit_speech(before, &mut world, false)?;
    tail::verify_wayfinder_placement(&world, &geo)?;
    tail::verify_station_order(&world, &geo)?;
    tail::no_box_release(&world)?;
    opening_pond_ship_view::completed_response(world, &geo, before_seq, || {
        Some(evidence.into_profiles())
    })
}
