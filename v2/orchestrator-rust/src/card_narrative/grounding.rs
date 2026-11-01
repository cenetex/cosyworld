//! Inner life stays the avatar's own first person about things the scene
//! knows (#1850): no dialogue tags, narrators, or invented items.
use super::*;

/// A closing quote after `,`, `!` or `?` and then a speaker tag:
/// `first," she called` or `back," I say`.
pub(super) fn dialogue_tag(text: &str) -> bool {
    text.match_indices(['"', '\u{201d}']).any(|(at, quote)| {
        text[..at].ends_with([',', '!', '?'])
            && text[at + quote.len()..]
                .strip_prefix(' ')
                .and_then(|rest| rest.chars().next())
                .is_some_and(|c| c.is_lowercase() || c == 'I')
    })
}

pub(super) fn first_person(text: &str) -> bool {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '\u{2019}')
        .map(|word| word.to_lowercase().replace('\u{2019}', "'"))
        .any(|word| {
            [
                "i", "i'm", "i've", "i'll", "i'd", "me", "my", "mine", "myself",
            ]
            .contains(&word.as_str())
        })
}

/// Whether a text names an item kind, by its name's last word ("the River
/// Map" is a map), that no item the scene knows shares (#1850).
pub(super) fn invents_item(text: &str, known: &BTreeSet<String>) -> bool {
    let lower = text.to_lowercase();
    let mut nouns: BTreeMap<String, bool> = BTreeMap::new();
    for (id, profile) in profiles().as_object().expect("profiles") {
        let noun = match profile["name"]
            .as_str()
            .and_then(|n| n.split_whitespace().last())
        {
            Some(noun) if profile["kind"] == "item" => noun.to_lowercase(),
            _ => continue,
        };
        if noun.len() > 2
            && !["account", "card", "list", "record", "plea", "seed"].contains(&noun.as_str())
        {
            *nouns.entry(noun).or_default() |= known.contains(id);
        }
    }
    nouns.iter().any(|(noun, seen)| {
        !seen && (mentions(&lower, noun) || mentions(&lower, &format!("{noun}s")))
    })
}

/// A kept thought or dream the prompt may carry: it names no one and no
/// item kind the scene does not know, so a retired or invented thing in an
/// old save does not return.
pub(super) fn grounded(text: &str, known: &BTreeSet<String>) -> bool {
    !invents_item(text, known)
        && profiles()
            .as_object()
            .expect("profiles")
            .iter()
            .all(|(id, p)| {
                known.contains(id) || !p["name"].as_str().is_some_and(|n| mentions(text, n))
            })
}
