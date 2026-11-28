use super::{
    opening_attic_rest, opening_content, opening_crossings, opening_full_wait,
    opening_hub_residents, opening_mirror_move, opening_place_cards::Deck, opening_pond_ask,
    opening_quiet_life, opening_roster, opening_settlement, opening_visitor_routes, opening_wants,
    pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

fn quiet_ways(before: &Value, world: &Value, geo: &Geography<'_>) -> Option<()> {
    if before["crossings"] != world["crossings"] {
        return None;
    }
    for pack in geo.packs() {
        let pack_id = pack["id"].as_str()?;
        for crossing in pack["crossings"]
            .as_array()?
            .iter()
            .filter(|entry| entry["from"] == "pond")
        {
            if ["opened", "closed"]
                .iter()
                .any(|key| crossing[*key].as_str().is_some_and(|text| !text.is_empty()))
                && opening_visitor_routes::crossing_open(before, geo, "vale", pack_id, crossing)?
                    != opening_visitor_routes::crossing_open(world, geo, "vale", pack_id, crossing)?
            {
                return None;
            }
        }
    }
    let forest = &geo.files()["v2/card-game/forest.json"];
    let mirror = forest["reflectionRoutes"]
        .as_array()?
        .iter()
        .find(|route| route["from"] == "attic")?;
    if geo.reflection_open(before, mirror)? != geo.reflection_open(world, mirror)? {
        return None;
    }
    opening_crossings::no_crossing_unlocks(world, geo)
}

pub(super) fn progress(
    request: &Value,
    finish: impl FnOnce(Value, &Geography<'_>, u64) -> Option<Value>,
) -> Option<Value> {
    let (before, carry) = opening_mirror_move::move_world(request)?;
    if before["turn"] != 0 {
        return None;
    }
    opening_full_wait::quiet_opening(before)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (mut world, (known, residents)) = opening_mirror_move::begin_with(
        before,
        &geo,
        &authored,
        &order,
        &evidence,
        carry,
        |world| {
            let known = opening_roster::known_actors(world, &geo, &order, None)?;
            let residents = opening_roster::residents(world, &geo, &known, "vale")?;
            Some((known, residents))
        },
    )?;
    let deck = Deck::new(&world, &geo)?;
    opening_pond_ask::settle(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    opening_hub_residents::keeper_idle_after_move(&world, &geo)?;
    opening_full_wait::pickups(&mut world, &geo, &evidence, &deck, &known, &residents)?;
    opening_settlement::decay_bell(&mut world)?;
    opening_full_wait::roam(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    opening_quiet_life::verify(&mut world, &geo)?;
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    quiet_ways(before, &world, &geo)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_first_wait(&mut world, &geo)?;
    opening_attic_rest::settle_visit_speech(before, &mut world, false)?;
    finish(world, &geo, before["eventSeq"].as_u64()?)
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    progress(request, |world, geo, before_seq| {
        super::opening_pond_view::completed_move_response(world, geo, before_seq, &["vale"])
    })
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    progress(request, |world, _, _| {
        let mut response = json!({"ok":true});
        response["world"] = world;
        Some(response)
    })
}
