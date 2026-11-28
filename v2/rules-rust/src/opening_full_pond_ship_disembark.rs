use super::{
    opening_content, opening_crossings, opening_full_move, opening_greek_harbor_view,
    opening_held_items, opening_place_cards::Deck, opening_pond_ship_disembark,
    opening_pond_ship_settlement, opening_roster, opening_second_attic_tail as tail,
    opening_settlement, opening_station_departure_residents, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::Value;

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let (before, carry) = opening_pond_ship_disembark::disembark_world(request)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (mut world, residents) = opening_pond_ship_disembark::begin_with(
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
    opening_pond_ship_settlement::settle_harbor_after_residents(&mut world, &geo)?;
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    opening_held_items::settle(&mut world, &geo, Some(before))?;
    if world["items"]["lamp"] != before["items"]["lamp"] {
        return None;
    }
    opening_crossings::no_crossing_unlocks(&world, &geo)?;
    opening_full_move::quiet_discoveries(before, &world, &geo, Some("greek-harbor-pond"))?;
    opening_full_move::no_crossing_narration(before, &world, &geo)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_pond_ship_settlement::settle_harbor_tail(before, &mut world, &geo)?;
    tail::sealed_at_rest(&world, &geo)?;
    tail::guards_stable(&world, &geo)?;
    tail::verify_wayfinder_placement(&world, &geo)?;
    tail::verify_station_order(&world, &geo)?;
    tail::no_box_release(&world)?;
    opening_greek_harbor_view::completed_response(
        world,
        &geo,
        &authored,
        &order,
        before_seq,
        evidence.into_profiles(),
    )
}
