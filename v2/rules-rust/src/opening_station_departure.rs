use super::{
    opening_behind_station_view, opening_content, opening_full_move, opening_held_items,
    opening_place_cards::Deck, opening_pond_return_view, opening_quiet_life, opening_roaming,
    opening_roster, opening_second_attic_lamp, opening_second_attic_tail, opening_settlement,
    opening_station_departure_residents, opening_station_move, opening_wants, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

enum Destination {
    Behind(bool),
    Pond(bool),
    PondWithCloth(Option<opening_station_move::CarriedItem>),
}

impl Destination {
    fn room(&self) -> &'static str {
        match self {
            Self::Behind(_) => "behind-station",
            Self::Pond(_) | Self::PondWithCloth(_) => "pond",
        }
    }
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let (before, destination) = opening_station_move::behind_world(request)
        .map(|(world, carry)| (world, Destination::Behind(carry)))
        .or_else(|| {
            opening_station_move::cloth_return_world(request)
                .map(|(world, carry)| (world, Destination::PondWithCloth(carry)))
        })
        .or_else(|| {
            opening_station_move::return_world(request)
                .map(|(world, carry)| (world, Destination::Pond(carry)))
        })?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let prepare = |world: &Value| {
        let known = opening_roster::known_actors(world, &geo, &order, None)?;
        opening_roster::residents(world, &geo, &known, "vale")
    };
    let (mut world, residents) = match destination {
        Destination::Behind(carry) => opening_station_move::begin_behind_with(
            before, &geo, &authored, &order, &evidence, carry, prepare,
        ),
        Destination::Pond(carry) => opening_station_move::begin_return_with(
            before, &geo, &authored, &order, &evidence, carry, prepare,
        ),
        Destination::PondWithCloth(carry) => opening_station_move::begin_cloth_return_with(
            before, &geo, &authored, &order, &evidence, carry, prepare,
        ),
    }?;
    let room = destination.room();
    let visits = world["actors"]["vale"]["visited"].as_array_mut()?;
    if !visits.iter().any(|visited| visited == room) {
        visits.push(json!(room));
    }
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    opening_station_departure_residents::settle(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_station_departure(before, &mut world, &geo)?;
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    opening_held_items::settle(&mut world, &geo, Some(before))?;
    opening_second_attic_lamp::settle_carried_at(&mut world, &geo, room)?;
    opening_full_move::quiet_ways(before, &world, &geo, false)?;
    opening_second_attic_tail::no_sleepers(&world)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_station_departure(before, &mut world, &geo)?;
    opening_second_attic_tail::settle_station_departure_after_wants(before, &mut world, &geo)?;
    let profiles = || Some(evidence.into_profiles());
    match destination {
        Destination::Behind(_) => {
            opening_behind_station_view::completed_response(world, &geo, before_seq, profiles)
        }
        Destination::Pond(_) | Destination::PondWithCloth(_) => {
            opening_pond_return_view::completed_response(world, &geo, before_seq, profiles)
        }
    }
}
