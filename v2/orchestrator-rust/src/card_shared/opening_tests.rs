use super::full_world::World;
use serde_json::json;

#[test]
fn new_shared_world_starts_in_the_lit_attic_and_moves_after_stowing_the_lamp() {
    let mut world = World::create(None).unwrap();
    world.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    world.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_eq!(world.game["actors"]["moth"]["place"], "pond");
    assert_eq!(world.game["items"]["lamp"]["lit"], true);
    assert_eq!(
        world.game["opening"],
        json!({"version":1,"crossed":false,"met":{"vale":0}})
    );
    // Stowing the lamp opens the mirror without committing a turn.
    let turn = world.game["turn"].clone();
    let history = world.game["log"].clone();
    let stow = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    world.apply(&stow).unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_eq!(
        world.game["actors"]["vale"]["heldItem"],
        serde_json::Value::Null
    );
    assert_eq!(world.game["items"]["lamp"]["holder"], "vale");
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    assert_eq!(world.game["turn"], turn);
    assert_eq!(world.game["log"], history);
    let view = world.project(0).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "pond")
        .unwrap();
    world
        .apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    assert_eq!(world.game["actors"]["vale"]["place"], "pond");
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    assert_eq!(world.game["items"]["lamp"]["fuelRooms"], 3);
}
