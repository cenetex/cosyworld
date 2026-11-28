use super::{
    opening, opening_attic_rest, opening_content, opening_crossings, opening_held_items,
    opening_hub_residents, opening_pickups::Custody, opening_place_cards::Deck, opening_play,
    opening_quiet_life, opening_roaming, opening_roster, opening_second_attic_lamp,
    opening_second_attic_tail, opening_settlement, opening_take, opening_take_response,
    opening_visitor_play, opening_wait, opening_wait_response, opening_wants, pack_state::Catalog,
    resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";

#[derive(Clone, Copy)]
enum Play {
    Wait,
    Take,
}

pub(super) fn quiet_start(world: &Value) -> Option<()> {
    if [
        "absent",
        "hidden",
        "homecoming",
        "gone",
        "disabledPacks",
        "invitedPlaces",
        "sharedMigration",
        "pondLampLoan",
    ]
    .iter()
    .any(|key| !world[*key].is_null())
        || !world["conversations"].as_array()?.is_empty()
        || world["actors"].as_object()?.values().any(|actor| {
            ["sleeping", "arcana"]
                .iter()
                .any(|key| !actor[*key].is_null())
        })
    {
        return None;
    }
    opening_play::quiet_attic_scene(world)
}

pub(super) fn round(request: &Value) -> Option<Value> {
    let (before, play) = if let Some(before) = opening_wait::second_world(request) {
        (before, Play::Wait)
    } else {
        (opening_take::take_world(request)?, Play::Take)
    };
    quiet_start(before)?;
    let order = opening_roster::actor_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    opening_play::attic_content(&files)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    opening_second_attic_tail::verify_station(before, &geo)?;
    opening_crossings::no_crossing_unlocks(before, &geo)?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world = match play {
        Play::Wait => opening_wait::begin_second(before, &files)?,
        Play::Take => opening_take::begin(before, &geo, &evidence)?.0,
    };
    world["playerActorId"] = json!(VALE);
    for key in ["heldActors", "controlledActors", "presentActors"] {
        world[key] = json!([VALE]);
    }
    let known = opening_roster::known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, VALE)?;
    let deck = Deck::new(&world, &geo)?;
    deck.settle(&mut world, &geo, Some(ATTIC))?;
    opening_hub_residents::confirm_second_idle(&world, &geo)?;
    let mut custody = Custody::new(&world)?;
    for id in residents {
        if !known.contains(&id) || ["moth", "keeper"].contains(&id) {
            continue;
        }
        if !opening::is_seat(id) {
            return None;
        }
        let seq = world["eventSeq"].as_u64()?;
        opening_visitor_play::perform(
            &mut world,
            &geo,
            &authored,
            &order,
            &evidence,
            &mut custody,
            id,
        )?;
        if world["eventSeq"] != seq {
            deck.settle(&mut world, &geo, None)?;
        }
    }
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_second_attic(&mut world, &geo)?;
    if request["op"] == "opening_second_resident_round" {
        let mut response = json!({"ok":true});
        response["world"] = world;
        return Some(response);
    }

    opening_second_attic_tail::verify_stops(&world, &geo)?;
    let waited = match play {
        Play::Wait => Some(ATTIC),
        Play::Take => None,
    };
    if !opening_settlement::sail_transports(&mut world, &catalog, waited)?.is_empty() {
        return None;
    }
    opening_held_items::settle(&mut world, &geo, Some(before))?;
    opening_settlement::reset_away_signals(&mut world, &catalog)?;
    opening_second_attic_lamp::settle(before, &mut world, &geo)?;
    opening_second_attic_tail::verify_wake(&world)?;
    opening_settlement::no_item_cycle(&world)?;
    opening_wants::settle_second_attic(&mut world, &geo)?;
    opening_second_attic_tail::verify_final(before, &world, &geo)?;
    opening_attic_rest::settle_visit_speech(before, &mut world, waited.is_some())?;
    opening_second_attic_tail::verify_wayfinder(&world, &geo)?;
    opening_held_items::settle(&mut world, &geo, Some(before))?;
    opening_second_attic_lamp::settle(before, &mut world, &geo)?;
    opening_second_attic_tail::verify_station(&world, &geo)?;

    let before_seq = before["eventSeq"].as_u64()?;
    let projected = || Some(evidence.into_profiles());
    match play {
        Play::Wait => opening_wait_response::completed_second_wait_response_with_profiles(
            world,
            &files,
            before_seq,
            &[VALE],
            projected,
        ),
        Play::Take => opening_take_response::completed_take_response_with_profiles(
            world,
            &files,
            before_seq,
            &[VALE],
            projected,
        ),
    }
}
