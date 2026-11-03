//! A local save imported into a shared world (#2067) is untrusted: its text
//! becomes journal state that other members' hosted prompts read. A string
//! stays only when it is a word the rules or packs use (`Vocabulary`: an id,
//! an enum or a schema field, alone or joined into a compound id, outside a
//! sentence field), a pack name, rules-built text matching its field's
//! authored catalog (`authored`), or a word the service wrote whose envelope
//! comes with the import and verifies for that kind, speaker and a local
//! save. A map key must fit its place: a map keyed by id (`ID_MAPS`) takes
//! only ids of pack or rules content, alone or joined into a compound id,
//! and any other object takes those or a name the rules give a property
//! (`Vocabulary::fields`), never just any word of the rules source. Anything
//! else is stripped
//! before the first journal row: the list entry holding it is dropped, a
//! lone field is cleared and a key is removed. A save the rules then refuse
//! loses every avatar's inner life too (`strict`).
//!
//! Envelopes are not bound to one save and do not expire, so a word the
//! service signed for one local save can be replayed into another save by
//! the same speaker. It is still a word the service wrote for that speaker.
use super::authored::{authored, name, Budget, Field};
use crate::routes::signed_envelope::{content_hash, keys, Envelope, Verdict};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Envelopes one import may carry: the browser keeps its last 800.
pub(crate) const ENVELOPES: usize = 800;
/// Matching work one import may spend: a whole save, about 40 scenes.
const IMPORT_STEPS: usize = 40 * super::authored::REQUEST_STEPS;
/// Strings and keys one import may hold. A 600-turn save holds about 20,000.
const STRINGS: usize = 100_000;
/// Log speakers that are not characters (world.mjs `addLog`).
const SPEAKERS: [&str; 2] = ["World", "You"];
const SKEW_SECS: u64 = 300;
/// Fields that always hold sentences, never an id.
const SENTENCES: [&str; 7] = [
    "text",
    "persona",
    "previousPersona",
    "thought",
    "dream",
    "history",
    "evidence",
];

fn token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"_.:/#-".contains(&b)
}

fn token(text: &str) -> bool {
    (1..=80).contains(&text.len()) && text.bytes().all(token_byte)
}

/// Save maps keyed by id, by their path from the save's root (`*` is any
/// key): actors, items, places, memories, trust, grievances and the rest.
const ID_MAPS: [&[&str]; 16] = [
    &["actors"],
    &["actors", "*", "trust"],
    &["items"],
    &["locations"],
    &["memories"],
    &["motives", "grievances"],
    &["peaceUntil"],
    &["crossings"],
    &["doors"],
    &["packs"],
    &["routeKnowledge"],
    &["transports"],
    &["knowledge", "facts"],
    &["knowledge", "known"],
    &["knowledge", "known", "*"],
    &["life", "actors"],
];

fn id_keyed(path: &[String]) -> bool {
    ID_MAPS.iter().any(|map| {
        map.len() == path.len() && map.iter().zip(path).all(|(m, p)| *m == "*" || m == p)
    })
}

/// The next byte of `bytes` from `at` that is not whitespace, either way.
fn next(bytes: &[u8], at: usize) -> Option<u8> {
    bytes[at.min(bytes.len())..]
        .iter()
        .copied()
        .find(|b| !b.is_ascii_whitespace())
}

fn prev(bytes: &[u8], at: usize) -> (Option<u8>, usize) {
    let end = bytes[..at].iter().rposition(|b| !b.is_ascii_whitespace());
    (end.map(|e| bytes[e]), end.unwrap_or(0))
}

/// The words the rules and their packs use: string literals of the rules
/// source and the keys and one-word values of the pack content (`words`),
/// the identifiers the rules use as property names (`fields`: `.place`,
/// `want:`, `{ seq }`), and the ids of pack and rules content (`ids`: an id
/// field's value, a key of a map of records, a rules `id: "…"` or the head
/// of a rules template id like `` `event:${seq}` ``).
pub(crate) struct Vocabulary {
    words: HashSet<String>,
    fields: HashSet<String>,
    ids: HashSet<String>,
}

impl Vocabulary {
    pub(crate) fn new(sources: &[&str], content: &str) -> Self {
        let mut words = HashSet::new();
        let mut fields = HashSet::new();
        let mut ids = HashSet::new();
        for source in sources {
            let bytes = source.as_bytes();
            let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                if b"\"'`".contains(&b) {
                    // A quoted word: `"talk"`, never a sentence.
                    let end = (i + 1..bytes.len())
                        .find(|&j| !token_byte(bytes[j]))
                        .unwrap_or(bytes.len());
                    let word = &source[i + 1..end];
                    if end > i + 1 && bytes.get(end) == Some(&b) {
                        words.insert(word.to_string());
                        if next(bytes, end + 1) == Some(b':') {
                            fields.insert(word.to_string());
                        }
                        // `id: "shared-homes"`, `placeId: "pond"`.
                        let (colon, at) = prev(bytes, i);
                        let named = &source[..at];
                        if colon == Some(b':') && (named.ends_with("id") || named.ends_with("Id")) {
                            ids.insert(word.to_string());
                        }
                    } else if b == b'`' && bytes[end..].starts_with(b"${") {
                        let head = word.trim_end_matches([':', '-']);
                        if !head.is_empty() {
                            ids.insert(head.to_string());
                        }
                    }
                    i += 1;
                } else if ident(b) {
                    let end = (i..bytes.len())
                        .find(|&j| !ident(bytes[j]))
                        .unwrap_or(bytes.len());
                    let (before, at) = prev(bytes, i);
                    let after = next(bytes, end);
                    let member = before == Some(b'.') && (at == 0 || bytes[at - 1] != b'.');
                    let shorthand =
                        matches!(before, Some(b'{' | b',')) && matches!(after, Some(b',' | b'}'));
                    if member || shorthand || after == Some(b':') {
                        fields.insert(source[i..end].to_string());
                    }
                    i = end;
                } else {
                    i += 1;
                }
            }
        }
        fn walk(value: &Value, key: &str, words: &mut HashSet<String>, ids: &mut HashSet<String>) {
            match value {
                Value::String(s) if token(s) => {
                    words.insert(s.clone());
                    let key = key.to_ascii_lowercase();
                    if key.ends_with("id") || key.ends_with("ids") {
                        ids.insert(s.clone());
                    }
                }
                Value::Array(items) => items.iter().for_each(|v| walk(v, key, words, ids)),
                Value::Object(map) => {
                    // A map of records is keyed by id.
                    if !map.is_empty() && map.values().all(Value::is_object) {
                        ids.extend(map.keys().cloned());
                    }
                    map.iter().for_each(|(k, v)| {
                        words.insert(k.clone());
                        walk(v, k, words, ids);
                    });
                }
                _ => {}
            }
        }
        if let Ok(content) = serde_json::from_str::<Value>(content) {
            walk(&content, "", &mut words, &mut ids);
        }
        Self { words, fields, ids }
    }

    /// Whether `text` is a word, a number, or words and numbers joined by
    /// `:` and `-` (`event:67`, `pond-clearing`, `ring:vale::3:bell`).
    fn known(&self, text: &str) -> bool {
        Self::compound(text, &self.words)
    }

    fn compound(text: &str, set: &HashSet<String>) -> bool {
        let word = |s: &str| s.bytes().all(|b| b.is_ascii_digit()) || set.contains(s);
        text.split(':').all(|part| {
            if part.is_empty() || word(part) {
                return true;
            }
            // Ids hold dashes too: split `part` into words at its dashes.
            let pieces: Vec<&str> = part.split('-').collect();
            if pieces.len() > 16 {
                return false;
            }
            let mut reach = vec![false; pieces.len() + 1];
            reach[0] = true;
            for i in 0..pieces.len() {
                if reach[i] {
                    for j in i + 1..=pieces.len() {
                        reach[j] |= word(&pieces[i..j].join("-"));
                    }
                }
            }
            reach[pieces.len()]
        })
    }

    /// Whether `key` may name an entry of the object at `path`.
    fn key(&self, key: &str, path: &[String]) -> bool {
        let id = token(key) && Self::compound(key, &self.ids);
        id || (!id_keyed(path) && self.fields.contains(key))
    }
}

/// The local save words the service signed: content hash to (kind, speaker).
type Signed = HashMap<String, Vec<(String, String)>>;

fn signed_words(envelopes: &[Envelope], turn: u64) -> Signed {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut signed = Signed::new();
    for e in envelopes.iter().take(ENVELOPES).filter(|e| {
        let c = &e.claims;
        ["line", "thought", "persona", "dream"].contains(&c.kind.as_str())
            && c.world == "local"
            && c.rules.starts_with(super::untrusted::ISSUER)
            && c.turn <= turn
            && c.iat <= now + SKEW_SECS
            && keys().verify(e) == Verdict::Valid
    }) {
        let c = &e.claims;
        signed
            .entry(c.content.clone())
            .or_default()
            .push((c.kind.clone(), c.entity.clone()));
    }
    signed
}

/// Where a string sits: whose words they are, the log speaker beside it,
/// and the list holding it.
#[derive(Clone, Copy)]
struct At<'a> {
    entity: Option<&'a str>,
    speaker: Option<&'a str>,
    list: &'a str,
}

struct Strip<'v> {
    signed: Signed,
    vocabulary: &'v Vocabulary,
    budget: Budget,
    dropped: usize,
    exceeded: bool,
    strings: usize,
    /// The keys from the save's root to the object being stripped.
    path: Vec<String>,
}

/// The envelope kind that may vouch for a string in `key` of `list`.
fn kind_of(key: &str, list: &str) -> &'static str {
    match (key, list) {
        ("persona" | "previousPersona", _) => "persona",
        (_, "thoughts") => "thought",
        (_, "dreams") => "dream",
        _ => "line",
    }
}

impl Strip<'_> {
    /// Whether every string in a JSON-encoded value is a vocabulary word
    /// (adaptive-learning.mjs keys its conditions this way).
    fn encoded(&mut self, text: &str) -> bool {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return false;
        };
        let mut ok = true;
        let mut stack = vec![value];
        while let Some(value) = stack.pop() {
            self.strings += 1;
            match value {
                Value::String(s) => {
                    ok &= (token(&s) && self.vocabulary.known(&s))
                        || (s.starts_with('[') && self.encoded(&s));
                }
                Value::Array(items) => stack.extend(items),
                Value::Object(_) => ok = false,
                _ => {}
            }
        }
        ok
    }

    fn matches(&mut self, text: &str, field: Field) -> bool {
        let limit = text.chars().count() + 1;
        match authored(text, limit, field, &mut self.budget) {
            Ok(found) => found,
            Err(_) => {
                self.exceeded = true;
                false
            }
        }
    }

    /// Whether one string may stay, given its key and where it sits.
    fn trusted(&mut self, text: &str, key: &str, at: At) -> bool {
        if key == "speaker" {
            // A log names its speaker; knowledge names a speaker's id.
            return SPEAKERS.contains(&text) || name(text) || self.vocabulary.known(text);
        }
        if !SENTENCES.contains(&key) {
            if token(text) {
                return self.vocabulary.known(text);
            }
            if text.starts_with('[') && self.encoded(text) {
                return true;
            }
        }
        if name(text) {
            return true;
        }
        if let Some(entity) = at.entity {
            let kind = kind_of(key, at.list);
            // A log line's speaker must be the envelope speaker's name.
            let speaker = |id: &str| match at.speaker {
                Some(s) => s == super::name(id),
                None => at.list != "log",
            };
            let vouched = self.signed.get(&content_hash(text)).is_some_and(|found| {
                found
                    .iter()
                    .any(|(k, id)| k == kind && id == entity && speaker(id))
            });
            if vouched {
                return true;
            }
        }
        // A remembered line reads "Name: line" (memory.mjs).
        if matches!(at.list, "events" | "landmarks") {
            if let Some((who, line)) = text.split_once(": ") {
                if let Some(found) = self.signed.get(&content_hash(line)) {
                    if found
                        .iter()
                        .any(|(k, id)| k == "line" && super::name(id) == who)
                    {
                        return true;
                    }
                }
            }
        }
        match (key, at.list) {
            // motives.mjs: "Remembered grievance: {reason}" is a fact.
            ("reason", _) => self.matches(&format!("Remembered grievance: {text}"), Field::Facts),
            // world.mjs: "Turn {turn}: {event}".
            ("history", _) => {
                let event = text
                    .strip_prefix("Turn ")
                    .and_then(|t| t.split_once(": "))
                    .filter(|(turn, _)| turn.bytes().all(|b| b.is_ascii_digit()));
                event.is_some_and(|(_, event)| self.matches(event, Field::Events))
            }
            ("evidence", _) | (_, "log") => self.matches(text, Field::Events),
            (_, "events" | "landmarks" | "sources") => self.matches(text, Field::Memories),
            _ => [
                Field::Events,
                Field::Memories,
                Field::Facts,
                Field::Disclosures,
            ]
            .into_iter()
            .any(|f| self.matches(text, f)),
        }
    }

    /// Strip `value`. `true` asks the list that holds it to drop it.
    fn clean(&mut self, value: &mut Value, key: &str, at: At) -> bool {
        self.strings += 1;
        if self.strings > STRINGS {
            return true;
        }
        match value {
            Value::String(text) => !self.trusted(&text.clone(), key, at),
            Value::Array(items) => {
                let before = items.len();
                let at = At { list: key, ..at };
                items.retain_mut(|item| !self.clean(item, key, at));
                self.dropped += before - items.len();
                false
            }
            Value::Object(map) => {
                let before = map.len();
                self.strings += before;
                if self.strings > STRINGS {
                    return true;
                }
                map.retain(|k, _| self.vocabulary.key(k, &self.path));
                self.dropped += before - map.len();
                // A log entry or memory names its speaker.
                let own = ["entityId", "actorId"]
                    .iter()
                    .find_map(|k| map.get(*k).and_then(Value::as_str))
                    .map(str::to_string);
                let speaker = map
                    .get("speaker")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let entity = own.as_deref().or(at.entity);
                let in_list = !at.list.is_empty();
                let mut tainted = false;
                for (k, child) in map.iter_mut() {
                    // A memories map is keyed by whose memories they are.
                    let whose = (key == "memories").then_some(k.as_str()).or(entity);
                    let child_at = At {
                        entity: whose,
                        speaker: speaker.as_deref(),
                        list: at.list,
                    };
                    self.path.push(k.clone());
                    let refused = self.clean(child, k, child_at);
                    self.path.pop();
                    if refused {
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
/// a stripped save still loads; a refused one is stripped `strict`ly. A save
/// with nothing to strip goes to the rules once, when the world is founded.
pub(crate) fn trusted_save(
    save: &str,
    envelopes: &[Envelope],
    vocabulary: &Vocabulary,
    accepted: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let mut value: Value =
        serde_json::from_str(save).map_err(|_| "Choose a saved world.".to_string())?;
    if !value.is_object() || envelopes.len() > ENVELOPES {
        return Err("Choose a saved world.".into());
    }
    let turn = value["turn"].as_u64().unwrap_or(0);
    let mut strip = Strip {
        signed: signed_words(envelopes, turn),
        vocabulary,
        budget: Budget::with(IMPORT_STEPS),
        dropped: 0,
        exceeded: false,
        strings: 0,
        path: Vec::new(),
    };
    let root = At {
        entity: None,
        speaker: None,
        list: "",
    };
    strip.clean(&mut value, "", root);
    if strip.strings > STRINGS {
        return Err("Choose a saved world.".into());
    }
    if strip.exceeded {
        tracing::warn!(
            feature = "card_text",
            "an imported save needed more text matching than allowed; its later text was left out"
        );
    }
    let mut text = value.to_string();
    if strip.dropped > 0 {
        tracing::warn!(
            feature = "card_text",
            dropped = strip.dropped,
            "left unverified text out of an imported save"
        );
        if !accepted(&text) {
            tracing::warn!(
                feature = "card_text",
                "the rules refused a stripped imported save; its inner lives were left out"
            );
            strict(&mut value);
            text = value.to_string();
        }
    }
    Ok(text)
}
