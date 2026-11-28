use super::{
    authored_order::Order, initial_wants, opening, opening_attic_rest, opening_company,
    opening_crossings, opening_drop, opening_grounded_lamp, opening_history_walkers,
    opening_hub_residents, opening_pickups, opening_place_cards, opening_quiet_life,
    opening_resident_sleep, opening_roaming, opening_roster, opening_settlement, opening_wait,
    opening_wait_response, opening_wants, pack_state::Catalog, resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const VALE: &str = "vale";

fn quiet_opening(world: &Value) -> Option<()> {
    let began = opening::unplayed_turn(world)?;
    if !matches!(began, 0 | 480)
        || world["revision"].as_u64()?.checked_sub(began)? > 2
        || world["log"].as_array()?.len() != 2
        || world["actors"][VALE].get("want") != Some(&Value::Null)
        || !world["stationExitOrder"].as_array()?.is_empty()
        || [
            "hidden",
            "absent",
            "homecoming",
            "gone",
            "disabledPacks",
            "sharedMigration",
            "invitedPlaces",
            "pondLampLoan",
        ]
        .iter()
        .any(|key| !world[*key].is_null())
        || world["actors"].as_object()?.values().any(|actor| {
            ["arcana", "sleeping", "homeward"]
                .iter()
                .any(|key| !actor[*key].is_null())
                || (began == 0 && !actor["contact"].is_null())
        })
    {
        return None;
    }
    Some(())
}

fn visible_items<'a>(
    world: &Value,
    geo: &Geography,
    authored: &'a Order,
    room: &str,
) -> Option<Vec<&'a str>> {
    let mut items = Vec::new();
    for id in &authored.items {
        let holder = initial_wants::root(world, id)?;
        let place = world["actors"][holder]["place"].as_str().unwrap_or(holder);
        if place == room && geo.entity_active(world, id)? {
            items.push(id.as_str());
        }
    }
    Some(items)
}

fn roam(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    saved_order: &[&str],
    evidence: &ResidentEvidence,
    deck: &opening_place_cards::Deck,
) -> Option<()> {
    let from = world["actors"]["greek-rhapsode"]["place"].as_str()?;
    let mut witnesses = Vec::new();
    for id in &authored.actors {
        if world["actors"][id]["place"] == from && geo.entity_active(world, id)? {
            witnesses.push(id.as_str());
        }
    }
    witnesses.extend(visible_items(world, geo, authored, from)?);
    let mut detail = opening_roaming::bard_move(world, geo)?;
    let room = detail["locationId"].as_str()?;
    let cast = opening_roster::known_actors(world, geo, saved_order, Some(room))?;
    let items = visible_items(world, geo, authored, room)?;
    detail["witnesses"] = json!(witnesses);
    evidence.record(world, &cast, &items, detail, true)?;
    deck.settle(world, geo, None)
}

#[derive(PartialEq, Eq)]
enum RoundPlay {
    Wait,
    DropLamp,
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    round(request, RoundPlay::Wait)
}

pub(super) fn reduce_drop(request: &Value) -> Option<Value> {
    round(request, RoundPlay::DropLamp)
}

fn round(request: &Value, play: RoundPlay) -> Option<Value> {
    let before = match play {
        RoundPlay::Wait => opening_wait::wait_world(request)?,
        RoundPlay::DropLamp => opening_drop::drop_world(request)?,
    };
    quiet_opening(before)?;
    let historic = before["began"] == 480;
    let claimed = opening::seats(&request["claimed"])?;
    let present = opening::seats(&request["present"])?;
    if claimed != [VALE] || present != [VALE] {
        return None;
    }
    let order = opening_roster::actor_order(request, before)?;
    super::opening_play::attic_state(before)?;
    let (files, authored) = super::opening_content::wait_files(request)?;
    super::opening_play::attic_content(&files)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let (mut world, _) = match play {
        RoundPlay::Wait => opening_wait::begin_with_files(before, &files)?,
        RoundPlay::DropLamp => opening_drop::begin(before, &geo, &evidence)?,
    };
    let deck = opening_place_cards::Deck::new(&world, &geo)?;
    world["playerActorId"] = json!(VALE);
    for field in ["presentActors", "controlledActors", "heldActors"] {
        world[field] = json!([VALE]);
    }
    let known = opening_roster::known_actors(&world, &geo, &order, None)?;
    let residents = opening_roster::residents(&world, &geo, &known, VALE)?;
    if play == RoundPlay::Wait {
        opening_attic_rest::rest_vale(&mut world, &files)?;
    }
    opening_crossings::no_crossing_unlocks(&world, &geo)?;
    if historic {
        let order = opening_place_cards::saved_order(request, before)?;
        deck.settle_returns(&mut world, &geo, &evidence, &order)?;
    } else {
        deck.settle(&mut world, &geo, Some("attic"))?;
    }
    opening_attic_rest::settle_vale_wants(&mut world, &files)?;
    opening_hub_residents::confirm_idle(&world, &geo)?;
    let mut custody = opening_pickups::Custody::new(&world)?;
    for &id in &residents {
        if !known.contains(&id) || ["moth", "keeper"].contains(&id) {
            continue;
        }
        if !opening::is_seat(id) {
            return None;
        }
        opening_pickups::take(
            &mut world,
            &geo,
            &evidence,
            &claimed,
            &present,
            id,
            &mut custody,
        )??;
        deck.settle(&mut world, &geo, None)?;
    }
    opening_settlement::decay_bell(&mut world)?;
    roam(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    if historic {
        let resident_catalog = opening_resident_sleep::Residents::new(&geo)?;
        opening_resident_sleep::settle(&mut world, &geo, &resident_catalog)?;
        let acted: Vec<_> = std::iter::once(VALE).chain(residents).collect();
        opening_history_walkers::verify(&world, &geo, &acted, &resident_catalog)?;
    } else {
        opening_quiet_life::verify(&mut world, &geo)?;
    }
    if !opening_settlement::sail_attic_transports(&mut world, &catalog)?.is_empty() {
        return None;
    }
    opening_crossings::no_crossing_unlocks(&world, &geo)?;
    opening_settlement::reset_away_signals(&mut world, &catalog)?;
    let grounded_mirror = if play == RoundPlay::DropLamp {
        Some(opening_grounded_lamp::settle(
            before, &mut world, &geo, &evidence,
        )?)
    } else {
        opening_crossings::no_attic_crossing_narration(before, &world, &geo)?;
        None
    };
    opening_settlement::no_item_cycle(&world)?;
    if historic {
        opening_wants::settle_with(&mut world, &geo, opening_company::fade_trust)?;
    } else {
        opening_wants::settle_first_wait(&mut world, &geo)?;
    }
    opening_attic_rest::settle_visit_speech(before, &mut world, play == RoundPlay::Wait)?;
    let before_seq = before["eventSeq"].as_u64()?;
    if let Some(mirror) = grounded_mirror {
        opening_drop::completed_response(world, &files, before_seq, mirror)
    } else {
        opening_wait_response::completed_wait_response(world, &files, before_seq, &present)
    }
}
