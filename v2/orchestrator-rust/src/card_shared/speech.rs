use super::{cast, kernel::World, Result};
use serde_json::{json, Value};

fn payload(actor: i32, context: &Value) -> Result<Value> {
    let w: World = serde_json::from_value(context["world"].clone())
        .map_err(|_| "The scene is taking a moment.".to_string())?;
    let room = context["room"].as_i64().ok_or("Choose a place.")? as usize;
    let roster = &cast()["avatars"];
    let place = if room == 0 {
        &cast()["hub"]
    } else {
        &roster[room - 1]["home"]
    };
    let people: Vec<_> = (0..8)
        .filter(|&i| w.present[i] == 1 && w.places[i] == room as i32)
        .map(|i| roster[i]["name"].clone())
        .collect();
    let items: Vec<_> = (0..8)
        .filter_map(|i| {
            let h = w.holders[i];
            let holder = if (0..8).contains(&h)
                && w.present[h as usize] == 1
                && w.places[h as usize] == room as i32
            {
                roster[h as usize]["name"].clone()
            } else if h == 8 + room as i32 {
                json!("on the ground")
            } else {
                return None;
            };
            Some(json!({"name":roster[i]["item"]["name"], "holder":holder}))
        })
        .collect();
    Ok(
        json!({"speaker":{"name":roster[actor as usize]["name"],"profile":roster[actor as usize]["text"]},
        "place":{"name":place["name"],"description":place["text"]},"people":people,"items":items,"completed_play":context["action"]}),
    )
}

fn parse(text: &str, finish: &str, actor: i32) -> Result<Value> {
    let error = "The play is saved. Its words need another moment.";
    if finish != "stop" {
        return Err(error.into());
    }
    let value: Value = serde_json::from_str(text).map_err(|_| error.to_string())?;
    let lines = value["lines"].as_array().ok_or(error)?;
    if lines.len() != 2 {
        return Err(error.into());
    }
    let mut result = Vec::new();
    for (line, speaker) in lines.iter().zip(["actor", "scene"]) {
        let text = line["text"].as_str().ok_or(error)?.trim();
        // Providers may use the supplied speaker's name for the actor line.
        // Accept that exact name, then publish the server-owned display name.
        let actor_name = &cast()["avatars"][actor as usize]["name"];
        let speaker_matches =
            line["speaker"] == speaker || (speaker == "actor" && line["speaker"] == *actor_name);
        if !speaker_matches || text.is_empty() || text.chars().count() > 240 {
            return Err(error.into());
        }
        result.push(json!({"speaker":if speaker=="actor"{cast()["avatars"][actor as usize]["name"].as_str().unwrap()}else{"The shore"}, "text":text}));
    }
    Ok(json!(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_receives_only_the_approved_scene_fields() {
        let mut world = World::new();
        for i in 0..2 {
            world
                .apply(super::super::kernel::Action {
                    kind: 1,
                    actor: i,
                    item: -1,
                    target: -1,
                })
                .unwrap();
            world
                .apply(super::super::kernel::Action {
                    kind: 3,
                    actor: i,
                    item: -1,
                    target: -1,
                })
                .unwrap();
        }
        let p=payload(0,&json!({"world":world,"room":1,"action":"Vale lights the lamp.","user":"secret-account","play":"private-key"})).unwrap();
        assert_eq!(p["people"], json!(["Vale"]));
        assert_eq!(p["items"].as_array().unwrap().len(), 1);
        let text = p.to_string();
        for secret in [
            "Mara",
            "secret-account",
            "private-key",
            "holders",
            "claimed",
        ] {
            assert!(!text.contains(secret));
        }
    }
    #[test]
    fn speech_requires_two_complete_bounded_lines() {
        let good = r#"{"lines":[{"speaker":"actor","text":"A decent light."},{"speaker":"scene","text":"The flame steadies."}]}"#;
        assert_eq!(parse(good, "stop", 0).unwrap()[0]["speaker"], "Vale");
        assert!(parse(good, "length", 0).is_err());
        assert!(parse("{}", "stop", 0).is_err());
        assert!(parse(
            &good.replace("A decent light.", &"x".repeat(241)),
            "stop",
            0
        )
        .is_err());
        assert!(parse(&good.replace("actor", "Mara"), "stop", 0).is_err());
    }

    #[test]
    fn provider_can_label_the_actor_with_their_exact_name() {
        let live = r#"{"lines":[{"speaker":"Vale","text":"This doorframe in the pond looks like a secret passage. I bet it leads to a place few have seen."},{"speaker":"scene","text":"The lamp's light flickers softly, casting dancing shadows on the still water around the doorframe."}]}"#;
        let lines = parse(live, "stop", 0).unwrap();
        assert_eq!(lines[0]["speaker"], "Vale");
        assert_eq!(lines[1]["speaker"], "The shore");
        assert!(parse(live, "stop", 1).is_err());
        assert!(parse(&live.replace("\"scene\"", "\"Vale\""), "stop", 0).is_err());
        for actor in 0..8 {
            let name = cast()["avatars"][actor as usize]["name"].as_str().unwrap();
            assert_eq!(
                parse(&live.replace("Vale", name), "stop", actor).unwrap()[0]["speaker"],
                name
            );
        }
    }
}
