use super::{
    opening, opening_content, opening_crossings, opening_hub_residents, opening_pickups::Custody,
    opening_place_cards::Deck, opening_play, opening_quiet_life, opening_roaming, opening_roster,
    opening_second_attic_tail, opening_settlement, opening_take, opening_visitor_play,
    opening_wait, pack_state::Catalog, resident_evidence::ResidentEvidence, Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";

#[derive(Clone, Copy)]
enum Play {
    Wait,
    Take,
}

fn quiet_start(world: &Value) -> Option<()> {
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

pub(super) fn projection(request: &Value) -> Option<Value> {
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
        opening_visitor_play::perform(
            &mut world,
            &geo,
            &authored,
            &order,
            &evidence,
            &mut custody,
            id,
        )?;
        deck.settle(&mut world, &geo, None)?;
    }
    opening_settlement::decay_bell(&mut world)?;
    opening_roaming::settle_dwell(&mut world, &geo)?;
    opening_quiet_life::verify_second_attic(&mut world, &geo)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
