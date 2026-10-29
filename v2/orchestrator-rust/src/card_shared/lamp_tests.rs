use super::{full_store, full_world::World, now, store};
use serde_json::{json, Value};

#[test]
fn offered_oil_recovers_the_attic_journey_through_shared_replay() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node").current_dir(root).args([
        "--input-type=module", "-e", r#"
import fs from 'node:fs';
import {createWorld,encodeSave,plan} from './v2/card-game/world.mjs';
import {dispatchShared} from './v2/card-game/shared-world.mjs';
const fixture=JSON.parse(fs.readFileSync('test/lamp-offer.fixture.json','utf8'));
const local=createWorld();
for(const field of ['actors','items','locations']) Object.assign(local[field],fixture[field]);
local.turn=fixture.turn;local.revision=fixture.revision;
const save=encodeSave(local), commands=[];
let world=dispatchShared({op:'create',save}).world;
for(let step=0;step<8&&world.actors.vale.progress.step===1;step++){
  const action=plan({...world,playerActorId:'vale',controlledActors:['vale'],presentActors:['vale']}).action;
  const command={op:'play',actor:'vale',action};
  const result=dispatchShared({...command,world,claimed:['vale'],present:['vale']});
  if(!result.ok)throw Error(result.error);
  commands.push(command);world=result.world;
}
console.log(JSON.stringify({save,commands,world}));
"#,
    ]).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut world = World::create(fixture["save"].as_str()).unwrap();
    world.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    world.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let commands = fixture["commands"].as_array().unwrap();
    assert_eq!(commands[0]["action"]["kind"], "drop");
    assert_eq!(commands[0]["action"]["item"], "oil");
    let path = std::env::temp_dir().join(format!("lamp-offer-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "stalled-oil-journey", now()).unwrap();
    for (index, command) in commands.iter().enumerate() {
        full_store::commit(&c, &id, &mut world, command.clone(), now()).unwrap();
        if index == 0 {
            assert_eq!(world.game["items"]["oil"]["holder"], "keeper");
        }
        if index == 1 {
            assert!(world.game["items"]["lamp"]["fuel"].as_u64().unwrap() > 0);
        }
    }
    assert_eq!(world.game, fixture["world"]);
    assert_eq!(world.game["actors"]["vale"]["place"], "attic");
    assert_ne!(world.game["actors"]["vale"]["progress"]["step"], 1);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    std::fs::remove_file(path).unwrap();
}
