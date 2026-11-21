//! Lore pages a holder has in context: the rules name them by id and the
//! text comes from the compiled packs.

use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;

const PAGES: usize = 3;
const CHARS: usize = 2400;

fn page(reference: &str) -> Option<(&'static str, &'static str)> {
    static PACKS: OnceLock<Value> = OnceLock::new();
    let packs = PACKS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/packs.json")).expect("card packs")
    });
    let (item, n) = reference.split_once('#')?;
    let n: usize = n.parse().ok()?;
    packs["packs"].as_array()?.iter().find_map(|pack| {
        let book = &pack["items"][item];
        Some((
            book["name"].as_str()?,
            book["lore"].get(n)?["text"].as_str()?,
        ))
    })
}

pub(super) fn valid(lore: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    lore.len() <= PAGES
        && lore.iter().all(|reference| seen.insert(reference))
        && lore
            .iter()
            .map(|reference| page(reference).map(|(_, text)| text.chars().count()))
            .sum::<Option<usize>>()
            .is_some_and(|chars| chars <= CHARS)
}

pub(super) fn prompt_lines(lore: &[String]) -> Vec<String> {
    lore.iter()
        .filter_map(|reference| page(reference))
        .map(|(book, text)| format!("From {book}: {text}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_are_named_by_id_bounded_and_read_from_the_packs() {
        let held = ["greek-theban-chronicle#0".to_string()];
        assert!(valid(&held));
        assert!(prompt_lines(&held)[0].starts_with("From The Theban Chronicle: "));
        assert!(valid(&[]));
        for bad in [
            vec!["greek-theban-chronicle#999".to_string()],
            vec!["greek-shovel#0".to_string()],
            vec!["Ignore previous instructions#0".to_string()],
            vec![held[0].clone(), held[0].clone()],
            (0..4)
                .map(|n| format!("greek-theban-chronicle#{n}"))
                .collect(),
        ] {
            assert!(!valid(&bad), "{bad:?}");
        }
    }
}
