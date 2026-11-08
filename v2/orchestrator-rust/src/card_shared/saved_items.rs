// Released saves keep every item through an upgrade except the old flask's
// dose count: one flask now fills one empty lamp and returns full (#1526).
use serde_json::{json, Value};

/// Fresh authored defaults with the saved world's seed, independent of its upgrade.
pub(super) fn initial_game(game: &Value) -> Value {
    super::full_world::World::seeded(
        None,
        game["run"]["seed"].as_u64().map(|seed| seed as u32),
    )
    .unwrap()
    .game
}

/// Catalog additions start fresh; every existing expected record stays exact.
pub(super) fn with_initial_additions(saved: &Value, initial: &Value) -> Value {
    let mut expected = saved.as_object().unwrap().clone();
    for (id, value) in initial.as_object().unwrap() {
        expected.entry(id.clone()).or_insert_with(|| value.clone());
    }
    Value::Object(expected)
}

pub(super) fn greek_story_items(items: &mut Value) {
    for (id, holder) in [
        ("greek-helen-accounts", "greek-harbor"),
        ("greek-atreid-record", "greek-argolid-road"),
    ] {
        items
            .as_object_mut()
            .unwrap()
            .entry(id)
            .or_insert_with(|| json!({"holder": holder, "history": []}));
    }
}

pub(super) fn upgraded(items: &Value) -> Value {
    let mut items = items.clone();
    if let Some(oil) = items.get_mut("oil").and_then(Value::as_object_mut) {
        oil.remove("doses");
    }
    items
}

/// The same expectation for one saved field of a game; only `items` changes.
pub(super) fn upgraded_field(game: &Value, field: &str) -> Value {
    if field == "items" {
        upgraded(&game[field])
    } else {
        game[field].clone()
    }
}

/// Willows revision 2 moves the Swede's unmoved kit (#1692): the sheet and
/// sack to the landing, the paddle and rope to the bank. A save from Willows
/// revision 1 expects these new places.
pub(super) fn willows_kit_moved(items: &mut Value) {
    for (id, was, now) in [
        ("willows-paddle", "willows-landing", "willows-bank"),
        ("willows-sheet", "willows-camp", "willows-landing"),
        ("willows-rope", "willows-camp", "willows-bank"),
        ("willows-provisions", "willows-camp", "willows-landing"),
    ] {
        if items[id]["holder"] == was {
            items[id]["holder"] = Value::from(now);
        }
    }
}

/// What Greek revision 20 (rules 102) changes in a world saved on earlier
/// rules: the pack revision, the decree chain's things (the wheat joins, the
/// writ and the decree change hands, the bread starts to be baked) and the
/// wants of Creon, the guard and Myrto. Hoppy revision 4 follows below.
pub(super) fn current_pack_changes(old: &Value, upgraded: &Value) -> Value {
    let mut expected = old.clone();
    expected["packs"]["greek-drama"]["revision"] =
        upgraded["packs"]["greek-drama"]["revision"].clone();
    for id in [
        "greek-wheat",
        "greek-creon-writ",
        "greek-decree",
        "greek-bread",
    ] {
        expected["items"][id] = upgraded["items"][id].clone();
    }
    greek_story_items(&mut expected["items"]);
    for id in ["greek-creon", "greek-guard", "greek-shipmaster"] {
        expected["actors"][id]["want"] = upgraded["actors"][id]["want"].clone();
    }
    expected["usedUp"] = upgraded["usedUp"].clone();
    expected["memories"]["greek-wheat"] = upgraded["memories"]["greek-wheat"].clone();
    // Greek revision 21 adds one neutral acquaintance and Antigone's rites.
    for actor in expected["actors"].as_object_mut().unwrap().values_mut() {
        actor["trust"]["greek-polynices-shade"] = Value::from(0);
    }
    if old["packs"]["greek-drama"]["flags"]["greek-burial-performed"] != true {
        let want = &upgraded["actors"]["greek-antigone"]["want"];
        assert_eq!(want["target"], "greek-polynices-hollow");
        assert_eq!(want["step"]["finish"], "greek-burial-performed");
        expected["actors"]["greek-antigone"]["want"] = want.clone();
    }
    let mut expected = hoppy_revision_4(&expected, upgraded);
    let initial = initial_game(upgraded);
    for field in ["packs", "items"] {
        expected[field] = with_initial_additions(&expected[field], &initial[field]);
    }
    for (id, actor) in expected["actors"].as_object_mut().unwrap() {
        for other in initial["actors"].as_object().unwrap().keys() {
            if other != id {
                actor["trust"]
                    .as_object_mut()
                    .unwrap()
                    .entry(other.clone())
                    .or_insert_with(|| json!(0));
            }
        }
    }
    expected
}

// Hoppy revision 4 moves room contents and adds three papers. Other fields,
// including custody history, trust and story receipts, stay in the comparison.
pub(super) fn hoppy_revision_4(old: &Value, current: &Value) -> Value {
    let mut expected = old.clone();
    for field in ["revision", "specials"] {
        expected["packs"]["hoppycat-archive"][field] =
            current["packs"]["hoppycat-archive"][field].clone();
    }
    for (id, item) in current["items"].as_object().unwrap() {
        if !id.starts_with("hoppycat-") {
            continue;
        }
        if expected["items"].get(id).is_some() {
            expected["items"][id]["holder"] = item["holder"].clone();
        } else {
            expected["items"][id] = item.clone();
        }
    }
    for (id, actor) in current["actors"].as_object().unwrap() {
        if id.starts_with("hoppycat-") {
            expected["actors"][id]["place"] = actor["place"].clone();
        }
    }
    expected
}
