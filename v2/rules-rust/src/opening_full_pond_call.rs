use super::{
    opening_content, opening_hub_residents, opening_place_cards::Deck, opening_pond_call,
    opening_pond_call_tail, opening_pond_call_view, opening_pond_lamp_drop, opening_roster,
    opening_second_round, opening_station_departure_residents, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::Value;

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let before = opening_pond_lamp_drop::drop_world(request)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    opening_station_departure_residents::pip_dwells(before, &geo, 6)?;
    opening_hub_residents::at_home(before, &geo, "keeper", "oil")?;
    if !before["conversations"].as_array()?.is_empty()
        || !before["placeCard"]["pond"].is_null()
        || !before["elysiumEncounters"].is_null()
        || !before["defeats"]["vale"].is_null()
    {
        return None;
    }
    let mut world = opening_pond_lamp_drop::ground(before, &geo, &authored)?;
    let known = opening_roster::known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, "vale")?;
    let pending = opening_pond_call::settle(&mut world, &geo, &order)?;
    opening_pond_lamp_drop::record(&mut world, &geo, &authored, &evidence)?;
    opening_pond_call::narrate(&mut world, &geo, &authored, &evidence, &pending)?;
    opening_pond_call_tail::credit(before, &mut world, &geo)?;
    let deck = Deck::new(&world, &geo)?;
    opening_second_round::settle_visitors(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    opening_pond_call_tail::finish(before, &mut world, &geo, &catalog, &authored, &evidence)?;
    if world["items"]["lamp"]["lit"] == true {
        opening_pond_call_view::completed_response(world, &geo, before_seq, || {
            Some(evidence.into_profiles())
        })
    } else {
        opening_pond_call_view::completed_dry_response(world, &geo, before_seq, || {
            Some(evidence.into_profiles())
        })
    }
}
