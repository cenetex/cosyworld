use super::{
    commit_keeper_play, commit_keeper_quest_ship_docking, seated_reload, verify_opening_journal,
    Result, SHIP_CALL_VISITORS, WAIT,
};
use serde_json::{json, Value};

#[test]
fn sqlite_rules_wasm_parity_replays_the_first_ship_disembark() -> Result<()> {
    verify_keeper_quest_ship_disembark(
        "first-ship-disembark",
        Some(17),
        &[],
        "move:vale::greek-ship",
        "move:vale::greek-harbor",
        None,
    )
}

#[test]
fn sqlite_rules_wasm_parity_replays_first_ship_disembark_with_sage() -> Result<()> {
    verify_keeper_quest_ship_disembark(
        "first-ship-disembark-with-sage",
        None,
        SHIP_CALL_VISITORS,
        "move:vale:cloth:greek-ship",
        "move:vale:cloth:greek-harbor",
        Some("cloth"),
    )
}

fn verify_keeper_quest_ship_disembark(
    id: &str,
    seed: Option<u32>,
    visitors: &[(&str, &str, &str, &str)],
    board: &str,
    disembark: &str,
    carried: Option<&str>,
) -> Result<()> {
    let (mut c, mut state, mut calls, docked) =
        commit_keeper_quest_ship_docking(id, seed, visitors, board, carried)?;
    let seq = state.game["eventSeq"]
        .as_u64()
        .ok_or("Missing event sequence.")?;
    let routes = state.game["routeKnowledge"].clone();
    let mut custody = state.game["items"].clone();
    custody["cloth"]["history"]
        .as_array_mut()
        .unwrap()
        .push(json!("Turn 11: Vale carried it to The Wine-Dark Harbor."));
    let reply = commit_keeper_play(&c, id, &mut state, &mut calls, disembark, 16)?;
    let [vale, followers @ ..] = reply["events"].as_array().unwrap().as_slice() else {
        panic!("Expected Vale to disembark at The Wine-Dark Harbor");
    };
    let with_sage = !visitors.is_empty();
    assert_eq!(followers.len(), usize::from(with_sage));
    let harbor = "greek-harbor";
    let raven = "ratiradio-raven-figurine";
    let mut items = vec![json!({"id":"greek-helen-accounts","holder":harbor})];
    if !with_sage {
        items.push(json!({"id":raven,"holder":harbor}));
    }
    items.push(json!({"id":"cloth","holder":"vale"}));
    let text = if carried.is_some() {
        "Vale carries the Black cloth ashore at The Wine-Dark Harbor."
    } else {
        "Vale disembarks at The Wine-Dark Harbor."
    };
    assert_eq!(
        vale,
        &json!({
            "seq":seq+1, "turn":11, "speaker":"World", "text":text, "kind":"action",
            "actorId":"vale","verb":"move","fromLocationId":"greek-ship","locationId":harbor,
            "targetId":harbor,"witnesses":docked["events"][0]["witnesses"],"itemId":carried,
            "cast":["greek-shipmaster","vale"],"items":items,"light":false,
        })
    );
    if let [ada] = followers {
        assert_eq!(
            ada,
            &json!({
                "seq":seq+2, "turn":11, "speaker":"World", "kind":"action",
                "text":"Sage disembarks at The Wine-Dark Harbor.", "actorId":"ada","verb":"move",
                "fromLocationId":"greek-ship","locationId":harbor,"targetId":harbor,
                "witnesses":["ada"],"itemId":null,"cast":["ada","greek-shipmaster","vale"],
                "items":items,"light":false,
            })
        );
    }

    let world = &state.game;
    assert_eq!(world["turn"], 11);
    assert_eq!(world["eventSeq"], seq + 1 + followers.len() as u64);
    assert_eq!(
        world["arrival"],
        json!({"seq":seq+1,"fromLocationId":"greek-ship","locationId":harbor})
    );
    assert_eq!(
        world["crossings"]["greek-harbor-pond"],
        json!({"discovered":true})
    );
    assert_eq!(world["opening"]["met"]["greek-shipmaster"], 11);
    assert_eq!(world["packs"]["greek-drama"]["met"]["greek-shipmaster"], 11);
    assert_eq!(world["items"], custody);
    assert_eq!(world["routeKnowledge"], routes);
    assert_eq!(world["actors"]["vale"]["place"], harbor);
    assert_eq!(world["actors"]["vale"]["heldItem"], "cloth");
    assert_eq!(
        world["actors"]["vale"]["visited"],
        json!(["attic", "pond", "station", "greek-ship", harbor])
    );
    assert_eq!(
        world["actors"]["vale"]["waitSpeech"],
        json!({"place":harbor,"turn":null})
    );
    assert_eq!(
        world["actors"]["keeper"]["contact"],
        json!({"moth":[11,0],"vale":[7,0]})
    );
    if with_sage {
        assert_eq!(world["actors"]["ada"]["place"], harbor);
        assert_eq!(world["actors"]["ada"]["crossed"], 2);
        assert_eq!(world["actors"]["ada"]["dwellUntil"], 40);
        assert_eq!(
            world["actors"]["ada"]["visited"],
            json!(["loft", "greek-ship", harbor])
        );
    } else {
        assert_eq!(world["actors"]["ada"]["place"], "loft");
        assert_eq!(world["items"][raven]["holder"], harbor);
    }
    assert_eq!(world["actors"]["greek-shipmaster"]["place"], harbor);
    assert_eq!(
        world["transports"]["greek-ship"],
        json!({
            "version":3,"phase":"docked","dock":harbor,"destination":null,
            "riders":[],"since":11,"recall":null,
        })
    );
    let voices = json!(["vale", "greek-shipmaster"]);
    assert_eq!(world["speechVoices"]["vale"], voices);
    let exits = ["greek-road-thebes", "greek-argolid-road", "greek-ship"];
    assert_eq!(reply["room"], harbor);
    assert_eq!(reply["exits"], json!(exits));
    let mut keys = vec![WAIT.0.to_owned()];
    for to in exits {
        if with_sage {
            keys.push(format!("accompany:vale::ada:{to}"));
        }
        keys.extend([
            format!("accompany:vale::greek-shipmaster:{to}"),
            format!("move:vale::{to}"),
            format!("move:vale:cloth:{to}"),
        ]);
    }
    if with_sage {
        keys.extend(["threaten:vale::ada", "talk:vale::ada"].map(str::to_owned));
    }
    keys.extend(
        [
            "threaten:vale::greek-shipmaster",
            "talk:vale::greek-shipmaster",
            "take:vale:greek-helen-accounts:",
        ]
        .map(str::to_owned),
    );
    if !with_sage {
        keys.push(format!("take:vale:{raven}:"));
    }
    keys.push(format!("drop:vale:cloth:{harbor}"));
    if with_sage {
        keys.push("give:vale:cloth:ada".to_owned());
    }
    keys.extend(
        [
            "give:vale:cloth:greek-shipmaster",
            "accept:vale::box:greek-provisions",
        ]
        .map(str::to_owned),
    );
    let action_keys = reply["actions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|action| action["key"].as_str().unwrap());
    assert!(action_keys.eq(keys.iter().map(String::as_str)));

    assert_eq!(calls.len(), 15);
    verify_opening_journal(&mut c, id, &calls)?;
    let view = seated_reload(&c, id, &state, harbor, &exits, 17)?;
    assert_eq!(view["actions"], reply["actions"]);
    assert_eq!(view["world"]["routeKnowledge"], world["routeKnowledge"]);
    assert_eq!(view["world"]["transports"], world["transports"]);
    assert_eq!(view["world"]["speechVoices"]["vale"], voices);
    assert_eq!(
        view["world"]["log"].as_array().unwrap().last(),
        reply["events"].as_array().unwrap().last()
    );
    assert!(view["world"]["memories"]["ada"].get("subjects").is_none());
    Ok(())
}
