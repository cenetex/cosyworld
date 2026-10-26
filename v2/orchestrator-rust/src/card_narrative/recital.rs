use serde_json::{json, Value};
use std::sync::OnceLock;

// A song is authored text earned by play. The model performs its recorded
// words; the same response gate checks local and shared conversations.
pub(crate) fn required(scene: &Value) -> Option<(String, String)> {
    let card = &scene["outcome"]["card"];
    if card["kind"] != "talk" {
        return None;
    }
    let id = card["target"].as_str()?;
    if !scene["speakers"].as_array()?.iter().any(|s| s == id) {
        return None;
    }
    static PACKS: OnceLock<Value> = OnceLock::new();
    let packs = PACKS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/packs.json")).expect("card packs")
    });
    let recital = &packs["packs"]
        .as_array()?
        .iter()
        .find(|p| p["recital"]["actor"] == id)?["recital"];
    let mut authored = Vec::new();
    for verse in recital["verses"].as_array()? {
        for lines in [&verse["lines"], &verse["after"]["lines"]] {
            if let Some(lines) = lines.as_array() {
                let lines: Option<Vec<_>> = lines.iter().map(Value::as_str).collect();
                authored.push(lines?.join(" "));
            }
        }
    }
    let entity = scene["entities"]
        .as_array()?
        .iter()
        .find(|e| e["id"] == id)?;
    let earned = entity["facts"]
        .as_array()?
        .iter()
        .filter_map(|fact| {
            let fact = fact.as_str()?;
            if !fact.starts_with("Verse ") {
                return None;
            }
            let (_, words) = fact.split_once(": ")?;
            authored.iter().any(|v| v == words).then_some(words)
        })
        .next_back()?;
    Some((id.into(), earned.into()))
}

pub(crate) fn instruction(scene: &Value) -> Value {
    required(scene).map_or(Value::Null, |(id, text)| json!({"id":id,"text":text}))
}

pub(crate) fn consistent(scene: &Value, id: &str, text: &str) -> bool {
    required(scene).is_none_or(|(singer, words)| singer != id || text.trim() == words)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scene() -> Value {
        json!({"outcome":{"card":{"kind":"talk","target":"greek-rhapsode"}},
        "speakers":["vale","greek-rhapsode"], "entities":[
            {"id":"greek-rhapsode","facts":[
                "Verse 1, Vale: I set the water by her hands. She kept a loaf of bread for me.",
                "Verse 2, Vale: I told her I would turn away. Her brother waited by the wall."
            ]}]})
    }
    #[test]
    fn recital_uses_the_latest_earned_authored_couplet() {
        let scene = scene();
        let text = "I told her I would turn away. Her brother waited by the wall.";
        assert_eq!(
            required(&scene),
            Some(("greek-rhapsode".into(), text.into()))
        );
        assert!(consistent(&scene, "greek-rhapsode", text));
        assert!(!consistent(
            &scene,
            "greek-rhapsode",
            "The dark keeps every name the waves release."
        ));
        assert!(!consistent(
            &scene,
            "greek-rhapsode",
            "I laid her brother in the earth. The king's words crossed the wind."
        ));
        assert!(consistent(&scene, "vale", "I hear you."));
    }
    #[test]
    fn unrelated_conversations_and_unearned_words_keep_their_own_voice() {
        let mut scene = scene();
        scene["outcome"]["card"]["kind"] = json!("move");
        assert!(required(&scene).is_none());
        scene["outcome"]["card"]["kind"] = json!("talk");
        scene["entities"][0]["facts"] = json!(["Verse 1, Vale: An invented sea poem."]);
        assert!(required(&scene).is_none());
    }
}
