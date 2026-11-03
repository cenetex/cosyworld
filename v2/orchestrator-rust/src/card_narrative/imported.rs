//! A local save imported into a shared world (#2067) is untrusted: its text
//! becomes journal state that other members' hosted prompts read. A string
//! stays only when it is an id or enum (a token, outside a text field), a
//! pack name, rules-built authored text (`authored`), or a word the service
//! wrote whose envelope comes with the import and verifies for that speaker
//! and a local save. Anything else is stripped before the first journal row:
//! the list entry holding it is dropped and a lone field is cleared. A save
//! the rules then refuse loses every avatar's inner life too (`strict`).
use super::authored::{authored, name, Budget, Field};
use crate::routes::signed_envelope::{content_hash, keys, Envelope, Verdict};
use serde_json::Value;
use std::collections::HashSet;

/// Envelopes one import may carry: the browser keeps its last 400.
pub(crate) const ENVELOPES: usize = 400;
/// Matching work one import may spend: a whole save, about 40 scenes.
const IMPORT_STEPS: usize = 40 * super::authored::REQUEST_STEPS;
/// Log speakers that are not characters (world.mjs `addLog`).
const SPEAKERS: [&str; 2] = ["World", "You"];
const SKEW_SECS: u64 = 300;

/// The words of a local save the service signed: (speaker, content hash).
fn signed_words(envelopes: &[Envelope], turn: u64) -> HashSet<(String, String)> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    envelopes
        .iter()
        .take(ENVELOPES)
        .filter(|e| {
            let c = &e.claims;
            ["line", "thought", "persona", "dream"].contains(&c.kind.as_str())
                && c.world == "local"
                && c.rules.starts_with(super::untrusted::ISSUER)
                && c.turn <= turn
                && c.iat <= now + SKEW_SECS
                && keys().verify(e) == Verdict::Valid
        })
        .map(|e| (e.claims.entity.clone(), e.claims.content.clone()))
        .collect()
}

struct Strip {
    signed: HashSet<(String, String)>,
    budget: Budget,
    dropped: usize,
}

fn token(text: &str) -> bool {
    (1..=80).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:/#-".contains(&b))
}

impl Strip {
    /// Whether one string may stay, given its key, its speaker and its list.
    fn trusted(&mut self, text: &str, key: &str, entity: Option<&str>, list: &str) -> bool {
        if key == "speaker" {
            return SPEAKERS.contains(&text) || name(text);
        }
        // A field that holds sentences is text even without a space.
        let sentences = matches!(
            key,
            "text" | "persona" | "previousPersona" | "thought" | "dream"
        );
        if !sentences && token(text) {
            return true;
        }
        if name(text) {
            return true;
        }
        if let Some(entity) = entity {
            if self.signed.contains(&(entity.into(), content_hash(text))) {
                return true;
            }
            // A remembered line reads "Name: line" (memory.mjs).
            if let Some((speaker, line)) = text.split_once(": ") {
                let hash = content_hash(line);
                if self
                    .signed
                    .iter()
                    .any(|(id, c)| *c == hash && super::name(id) == speaker)
                {
                    return true;
                }
            }
        }
        let fields: &[Field] = match list {
            "log" | "history" => &[Field::Events],
            "events" | "landmarks" | "sources" => &[Field::Memories],
            _ => &[Field::Events, Field::Memories, Field::Facts],
        };
        let limit = text.chars().count() + 1;
        fields
            .iter()
            .any(|f| authored(text, limit, *f, &mut self.budget).unwrap_or(false))
    }

    /// Strip `value`. `true` asks the list that holds it to drop it.
    fn clean(&mut self, value: &mut Value, key: &str, entity: Option<&str>, list: &str) -> bool {
        match value {
            Value::String(text) => !self.trusted(&text.clone(), key, entity, list),
            Value::Array(items) => {
                let before = items.len();
                items.retain_mut(|item| !self.clean(item, key, entity, key));
                self.dropped += before - items.len();
                false
            }
            Value::Object(map) => {
                // A log entry or memory names its speaker.
                let own = ["entityId", "actorId"]
                    .iter()
                    .find_map(|k| map.get(*k).and_then(Value::as_str))
                    .map(str::to_string);
                let entity = own.as_deref().or(entity);
                let in_list = !list.is_empty();
                let mut tainted = false;
                for (k, child) in map.iter_mut() {
                    // A memories map is keyed by whose memories they are.
                    let whose = (key == "memories").then_some(k.as_str()).or(entity);
                    if self.clean(child, k, whose, list) {
                        if in_list {
                            tainted = true;
                        } else {
                            *child = Value::Null;
                            self.dropped += 1;
                        }
                    }
                }
                tainted
            }
            _ => false,
        }
    }
}

/// Every avatar's private words go: inner life, reflections and summary.
fn strict(save: &mut Value) {
    for memory in save["memories"]
        .as_object_mut()
        .into_iter()
        .flat_map(|m| m.values_mut())
    {
        if let Some(memory) = memory.as_object_mut() {
            memory.remove("innerLife");
            memory.remove("reflections");
            memory.remove("model");
            if memory.contains_key("text") {
                memory.insert("text".into(), Value::Null);
            }
        }
    }
}

/// The save with untrusted text stripped. `accepted` asks the rules whether
/// a stripped save still loads; a refused one is stripped `strict`ly.
pub(crate) fn trusted_save(
    save: &str,
    envelopes: &[Envelope],
    accepted: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let mut value: Value =
        serde_json::from_str(save).map_err(|_| "Choose a saved world.".to_string())?;
    if !value.is_object() {
        return Err("Choose a saved world.".into());
    }
    let turn = value["turn"].as_u64().unwrap_or(0);
    let mut strip = Strip {
        signed: signed_words(envelopes, turn),
        budget: Budget::with(IMPORT_STEPS),
        dropped: 0,
    };
    strip.clean(&mut value, "", None, "");
    let mut text = value.to_string();
    if !accepted(&text) {
        strict(&mut value);
        text = value.to_string();
    }
    if strip.dropped > 0 {
        tracing::warn!(
            feature = "card_text",
            dropped = strip.dropped,
            "left unverified text out of an imported save"
        );
    }
    Ok(text)
}
