use super::{
    opening_content, opening_hub_residents, opening_place_cards::Deck, opening_roster,
    opening_second_attic_tail, opening_second_round, opening_station_read, opening_station_view,
    opening_wants, pack_state::Catalog, resident_evidence::ResidentEvidence,
    settle_station_read_wait, Geography,
};
use serde_json::Value;

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let before = opening_station_read::read_world(request)?;
    let before_seq = before["eventSeq"].as_u64()?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world =
        opening_station_read::begin_station_log_read(request, &geo, &authored, &order, &evidence)?;
    let known = opening_roster::known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, "vale")?;
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, None)?;
    settle_station_read_wait(&mut world, &geo, &authored, &order, &evidence)?;
    opening_hub_residents::at_home(&world, &geo, "keeper", "oil")?;
    opening_second_round::settle_visitors(
        &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
    )?;
    opening_second_attic_tail::settle_station_read_before_wants(
        before, &mut world, &geo, &catalog,
    )?;
    opening_wants::settle_station_read(&mut world, &geo)?;
    opening_second_attic_tail::settle_station_read_after_wants(before, &mut world, &geo)?;
    opening_station_view::completed_read_response(
        world,
        &geo,
        &authored,
        before_seq,
        &order,
        || Some(evidence.into_profiles()),
    )
}
