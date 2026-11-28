use super::{
    opening_attic_rest, opening_company, opening_content, opening_crossings, opening_full_wait,
    opening_held_items, opening_history_walkers, opening_hub_residents, opening_mirror_move,
    opening_place_cards::{self, Deck},
    opening_pond_ask, opening_pond_place_returns, opening_pond_rumours, opening_quiet_life,
    opening_resident_sleep, opening_roaming, opening_roster, opening_second_attic_lamp,
    opening_second_attic_tail, opening_second_round, opening_settlement, opening_visitor_routes,
    opening_wants,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

fn quiet_discoveries(before: &Value, world: &Value, geo: &Geography<'_>) -> Option<()> {
    let old = before["crossings"].as_object()?;
    let new = world["crossings"].as_object()?;
    if old.len() != new.len()
        || new
            .values()
            .any(|state| !(state["phase"].is_null() || state["phase"] == 0))
    {
        return None;
    }
    for (id, state) in new {
        let prior = old.get(id)?;
        if prior == state {
            continue;
        }
        let mut confirmed = prior.clone();
        if confirmed["discovered"] != false {
            return None;
        }
        confirmed["discovered"] = json!(true);
        let crossing = geo.packs().find_map(|pack| {
            pack["crossings"]
                .as_array()?
                .iter()
                .find(|edge| edge["id"] == *id)
        })?;
        let taken = world["log"].as_array()?.iter().any(|event| {
            event["turn"] == 2
                && event["kind"] == "action"
                && event["verb"] == "move"
                && event["generated"] != true
                && event["actorId"] != "vale"
                && event["fromLocationId"] == crossing["from"]
                && event["locationId"] == crossing["to"]
        });
        if state != &confirmed || !taken {
            return None;
        }
    }
    Some(())
}

fn quiet_ways(before: &Value, world: &Value, geo: &Geography<'_>) -> Option<()> {
    if world["turn"] == 2 {
        quiet_discoveries(before, world, geo)?;
    } else if before["crossings"] != world["crossings"] {
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

fn progress(
    request: &Value,
    finish: impl FnOnce(Value, &Geography<'_>, u64, ResidentEvidence) -> Option<Value>,
) -> Option<Value> {
    let (before, carry) = opening_mirror_move::move_world(request)?;
    let second = before["turn"] == 1;
    if !second {
        opening_full_wait::quiet_opening(before)?;
    }
    let historic = before["began"] == 480;
    let before_seq = before["eventSeq"].as_u64()?;
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
    if historic {
        let cards = opening_place_cards::saved_order(request, before)?;
        opening_pond_place_returns::settle(
            &mut world, &geo, &authored, &order, &cards, &deck, &evidence,
        )?;
    }
    opening_pond_ask::settle(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    opening_hub_residents::keeper_idle_after_move(&world, &geo)?;
    if second {
        opening_second_round::settle_visitors(
            &mut world, &geo, &authored, &order, &evidence, &deck, &residents,
        )?;
    } else {
        opening_full_wait::pickups(&mut world, &geo, &evidence, &deck, &known, &residents)?;
    }
    opening_settlement::decay_bell(&mut world)?;
    if second {
        opening_roaming::settle_dwell(&mut world, &geo)?;
        opening_quiet_life::verify_second_pond(&mut world, &geo)?;
        opening_second_attic_tail::verify_stops(&world, &geo)?;
    } else {
        opening_full_wait::roam(&mut world, &geo, &authored, &order, &evidence, &deck)?;
    }
    if historic {
        let resident_catalog = opening_resident_sleep::Residents::new(&geo)?;
        opening_resident_sleep::settle_pond(
            &mut world,
            &geo,
            &resident_catalog,
            &authored,
            &order,
            &evidence,
        )?;
        let acted: Vec<_> = std::iter::once("vale").chain(residents).collect();
        opening_history_walkers::verify(&world, &geo, &acted, &resident_catalog)?;
    } else if !second {
        opening_quiet_life::verify(&mut world, &geo)?;
    }
    if !opening_settlement::sail_transports(&mut world, &catalog, None)?.is_empty() {
        return None;
    }
    if second {
        opening_held_items::settle(&mut world, &geo, Some(before))?;
        opening_second_attic_lamp::settle_pond(&mut world, &geo)?;
        opening_second_attic_tail::verify_wake(&world)?;
    }
    quiet_ways(before, &world, &geo)?;
    opening_settlement::no_item_cycle(&world)?;
    if second {
        opening_wants::settle_second_pond(&mut world, &geo)?;
        opening_second_attic_tail::verify_final(before, &world, &geo)?;
    } else if historic {
        opening_wants::settle_with(&mut world, &geo, opening_company::fade_trust)?;
    } else {
        opening_wants::settle_first_wait(&mut world, &geo)?;
    }
    opening_attic_rest::settle_visit_speech(before, &mut world, false)?;
    if second {
        opening_second_attic_tail::verify_wayfinder(&world, &geo)?;
        opening_held_items::settle(&mut world, &geo, Some(before))?;
        opening_second_attic_lamp::settle_pond(&mut world, &geo)?;
        opening_second_attic_tail::verify_station(&world, &geo)?;
    } else if historic {
        opening_pond_rumours::settle(&mut world, &geo, before_seq)?;
    }
    finish(world, &geo, before_seq, evidence)
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    progress(request, |world, geo, before_seq, evidence| {
        super::opening_pond_view::completed_move_response_with_profiles(
            world,
            geo,
            before_seq,
            &["vale"],
            || Some(evidence.into_profiles()),
        )
    })
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    progress(request, |world, _, _, _| {
        let mut response = json!({"ok":true});
        response["world"] = world;
        Some(response)
    })
}
