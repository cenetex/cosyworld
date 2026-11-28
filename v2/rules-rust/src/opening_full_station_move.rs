use super::{
    opening_attic_rest, opening_content, opening_full_move, opening_held_items,
    opening_history_walkers, opening_place_cards::Deck, opening_quiet_life, opening_resident_sleep,
    opening_roaming, opening_roster, opening_second_attic_lamp, opening_second_attic_tail,
    opening_second_round, opening_settlement, opening_station_move, opening_station_residents,
    opening_station_view, opening_wants, pack_state::Catalog, resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let (before, carry) = opening_station_move::move_world(request)?;
    let historic = before["began"] == 480;
    let awake = historic && before["actors"]["moth"]["sleeping"].is_null();
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
    if historic {
        if awake {
            opening_station_residents::settle(&mut world, &geo, &authored, &order, &evidence)?;
            opening_station_residents::settle_awake_visitors(
                &mut world, &geo, &authored, &order, &evidence,
            )?;
            deck.settle(&mut world, &geo, None)?;
        } else {
            opening_station_residents::confirm_historic_idle(&mut world, &geo, &order)?;
        }
        opening_settlement::decay_bell(&mut world)?;
        opening_roaming::settle_dwell(&mut world, &geo)?;
        settle_historic(
            before,
            &mut world,
            &geo,
            &catalog,
            &residents,
            awake,
            |world, residents| {
                if awake {
                    opening_resident_sleep::settle_awake_station(
                        world, &geo, residents, &authored, &order, &evidence,
                    )
                } else {
                    opening_resident_sleep::settle_station(world, &geo, residents)
                }
            },
        )?;
    } else {
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
    }
    opening_station_view::completed_arrival(
        world,
        &geo,
        &authored,
        before_seq,
        &order,
        awake,
        || Some(evidence.into_profiles()),
    )
}

fn settle_historic(
    before: &Value,
    world: &mut Value,
    geo: &Geography<'_>,
    catalog: &Catalog,
    residents: &[&str],
    awake: bool,
    settle_sleep: impl FnOnce(&mut Value, &opening_resident_sleep::Residents<'_>) -> Option<()>,
) -> Option<()> {
    let resident_catalog = opening_resident_sleep::Residents::new(geo)?;
    settle_sleep(world, &resident_catalog)?;
    let acted: Vec<_> = std::iter::once("vale")
        .chain(residents.iter().copied())
        .collect();
    opening_history_walkers::verify(world, geo, &acted, &resident_catalog)?;
    if !opening_settlement::sail_transports(world, catalog, None)?.is_empty() {
        return None;
    }
    opening_held_items::settle(world, geo, Some(before))?;
    opening_second_attic_lamp::settle_station(world, geo)?;
    opening_full_move::quiet_ways(before, world, geo, awake)?;
    if awake {
        opening_resident_sleep::verify_awake_station_wake(world, geo)?;
    } else {
        opening_resident_sleep::verify_station_wake(world)?;
    }
    opening_settlement::no_item_cycle(world)?;
    opening_wants::settle_station(world, geo)?;
    opening_second_attic_tail::settle_historic_station(before, world, geo)
}
