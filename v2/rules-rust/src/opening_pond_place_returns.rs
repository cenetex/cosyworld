use super::{
    authored_order::Order,
    opening_content, opening_mirror_move,
    opening_place_cards::{self, Deck, ReturnScene},
    opening_roster,
    pack_state::Catalog,
    resident_evidence::ResidentEvidence,
    Geography,
};
use serde_json::{json, Value};

const POND: &str = "pond";
const ATTIC: &str = "attic";
const VALE: &str = "vale";

pub(super) fn settle(
    world: &mut Value,
    geo: &Geography,
    authored: &Order,
    actor_order: &[&str],
    card_order: &[&str],
    deck: &Deck,
    evidence: &ResidentEvidence,
) -> Option<Vec<Value>> {
    let began = world["began"].as_u64()?;
    let last = world["log"].as_array()?.last()?;
    let vale = &world["actors"][VALE];
    if began == 0
        || world["turn"].as_u64()?.checked_sub(1) != Some(began)
        || vale["place"] != POND
        || !vale["want"].is_null()
        || !vale["under"].is_null()
        || last["actorId"] != VALE
        || last["verb"] != "move"
        || last["locationId"] != POND
        || last["fromLocationId"] != ATTIC
        || last["seq"] != world["arrival"]["seq"]
        || last["seq"] != world["eventSeq"]
    {
        return None;
    }

    let cast = opening_roster::known_actors(world, geo, actor_order, Some(POND))?;
    let items = opening_mirror_move::pond_items(world, geo, authored)?;
    let scene = ReturnScene {
        location: POND,
        from: ATTIC,
        cast: &cast,
        items: &items,
    };
    let vale = &mut world["actors"][VALE];
    let visited = vale["visited"].as_array_mut()?;
    if !visited.iter().any(|place| place == POND) {
        visited.push(json!(POND));
        visited.drain(..visited.len().saturating_sub(64));
    }
    if geo.files()["v2/card-game/forest.json"]["places"][POND]["sanctuary"] == true {
        vale["sanctuary"] = json!(POND);
    }
    deck.settle_returns_at(world, geo, evidence, card_order, &scene)
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (before, carry) = opening_mirror_move::move_world(request)?;
    let actor_order = opening_roster::actor_order(request, before)?;
    let card_order = opening_place_cards::saved_order(request, before)?;
    let (files, authored) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let evidence = ResidentEvidence::new(&files)?;
    let mut world =
        opening_mirror_move::begin(before, &geo, &authored, &actor_order, &evidence, carry)?;
    let deck = Deck::new(&world, &geo)?;
    settle(
        &mut world,
        &geo,
        &authored,
        &actor_order,
        &card_order,
        &deck,
        &evidence,
    )?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
