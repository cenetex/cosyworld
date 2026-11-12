use super::{entity, name, Context};

const PRICED: &[&str] = &[
    " for ",
    " if ",
    " when ",
    " once ",
    " unless ",
    " until ",
    " after ",
    " before ",
    " then ",
    " first",
    " only ",
    " not ",
    " never ",
    " no ",
    " nor ",
    " cannot ",
    "n't",
    " would ",
    " might ",
    " i may ",
    " i could ",
    " perhaps",
    " maybe",
    " trade",
    " exchange",
    " in return",
    " price",
    " earn",
    " prove",
    " bring ",
    " fetch ",
    " find ",
    " show me ",
    " give me ",
    " hand me ",
];
const LEADS: &[&str] = &[
    "and ",
    "so ",
    "here ",
    "please ",
    "yes ",
    "very well ",
    "gladly ",
    "now ",
];
const WILLS: &[&str] = &[
    "i will ",
    "i'll ",
    "i shall ",
    "i am going to ",
    "i'm going to ",
    "let me ",
    "i ",
];
const GRANTS: &[&str] = &[
    "take ",
    "have ",
    "you may have ",
    "you can have ",
    "you shall have ",
    "you may take ",
    "you can take ",
];
const CLOSES: &[&str] = &[
    " now",
    " at once",
    " freely",
    " gladly",
    " today",
    " over",
    " with you",
    " and ",
];

fn refused(facts: &[String]) -> Vec<String> {
    facts
        .iter()
        .filter_map(|fact| {
            let (_, asked) = fact.strip_prefix("If ")?.split_once(" asked me for ")?;
            asked.strip_suffix(", I would refuse to give it.")
        })
        .flat_map(aliases)
        .collect()
}

fn aliases(item: &str) -> Vec<String> {
    let full = item.to_lowercase().replace('\u{2019}', "'");
    let bare = full.strip_prefix("the ").unwrap_or(&full);
    let owned = bare
        .split_once(' ')
        .filter(|(owner, _)| owner.ends_with("'s") || owner.ends_with('\''))
        .map_or(bare, |(_, thing)| thing);
    let last = owned.rsplit(' ').next().filter(|word| word.len() > 3);
    let mut all = vec![full.clone(), bare.into(), owned.into()];
    all.extend(last.map(String::from));
    all.dedup();
    all
}

fn closes(tail: &str) -> bool {
    !tail.chars().any(char::is_alphanumeric) || CLOSES.iter().any(|end| tail.starts_with(end))
}

fn object<'a>(text: &'a str, labels: &[String], it: bool) -> Option<&'a str> {
    let whole = |tail: &&str| !tail.chars().next().is_some_and(char::is_alphanumeric);
    let text = ["the ", "my ", "this ", "that "]
        .iter()
        .find_map(|lead| text.strip_prefix(lead))
        .unwrap_or(text);
    labels
        .iter()
        .find_map(|label| text.strip_prefix(label.as_str()).filter(whole))
        .or_else(|| text.strip_prefix("it").filter(|tail| it && whole(tail)))
}

fn gives(clause: &str, labels: &[String], it: bool) -> bool {
    let mut clause = clause.trim();
    while let Some(rest) = LEADS.iter().find_map(|lead| clause.strip_prefix(lead)) {
        clause = rest;
    }
    let yours = [
        " is yours",
        " is now yours",
        " shall be yours",
        " will be yours",
    ];
    let stated = clause
        .strip_prefix("it's yours")
        .filter(|_| it)
        .or_else(|| {
            let tail = object(clause, labels, it)?;
            yours.iter().find_map(|is| tail.strip_prefix(is))
        });
    let granted = GRANTS
        .iter()
        .find_map(|grant| object(clause.strip_prefix(grant)?, labels, it));
    let handed = WILLS.iter().find_map(|will| {
        let act = clause.strip_prefix(will)?;
        let act = ["gladly ", "happily ", "freely ", "just "]
            .iter()
            .find_map(|adverb| act.strip_prefix(adverb))
            .unwrap_or(act);
        let rest = ["give ", "hand ", "grant ", "lend ", "pass "]
            .iter()
            .find_map(|verb| act.strip_prefix(verb))?;
        match rest.strip_prefix("you ") {
            Some(rest) => object(rest, labels, it),
            None => object(rest, labels, it).and_then(|tail| {
                tail.strip_prefix(" to you")
                    .or_else(|| tail.starts_with(" over").then_some(tail))
            }),
        }
    });
    [stated, granted, handed].into_iter().flatten().any(closes)
}

fn promised(text: &str, labels: &[String], asked: bool) -> bool {
    let lower = text.to_lowercase().replace('\u{2019}', "'");
    let it = asked || labels.iter().any(|label| lower.contains(label.as_str()));
    let mut hedged = false;
    lower
        .split_inclusive(['.', '!', '?', ';', '\n'])
        .any(|sentence| {
            let padded = format!(" {} ", sentence.trim());
            let priced = PRICED.iter().any(|mark| padded.contains(mark));
            let open = !priced && !hedged && !padded.contains('?');
            hedged = priced;
            open && sentence
                .split([',', ':', '\u{2014}'])
                .any(|clause| gives(clause, labels, it))
        })
}

pub(super) fn kept(text: &str, context: &Context, speaker: &str) -> bool {
    let labels = refused(&entity(context, speaker).facts);
    let named = |text: &str| labels.contains(&text.to_lowercase());
    let heard = context
        .conversation
        .iter()
        .rev()
        .find(|l| l.actor_id != speaker);
    let asked = heard.is_some_and(|l| {
        let said = l.text.to_lowercase();
        labels.iter().any(|label| said.contains(label.as_str()))
    }) || context.outcome.as_ref().is_some_and(|outcome| {
        [&outcome.card.item, &outcome.card.receive]
            .into_iter()
            .flatten()
            .any(|item| named(&name(item)))
    });
    labels.is_empty() || !promised(text, &labels, asked)
}

#[cfg(test)]
mod tests {
    use super::super::{tests, transcript, Check, Part};
    use super::*;

    #[test]
    fn the_view_names_the_price_and_the_check_reads_the_refusal_from_it() {
        let mut c = tests::context();
        let refuse = "If Vale asked me for Pip's Seal, I would refuse to give it.";
        let price = "I would trade my Pip's Seal for The Tin Ledger.";
        for (shown, mine) in [
            (
                "No item Vale is showing me would make me trade Pip's Seal now.",
                "No item Vale is showing me would make me trade my Seal now.",
            ),
            (
                "I would accept The Tin Ledger from Vale in trade for my Pip's Seal now.",
                "I would accept The Tin Ledger from Vale in trade for my Seal now.",
            ),
        ] {
            c.entities[3].facts = vec![refuse.into(), price.into(), shown.into()];
            let view = transcript(&c, &c.entities[3], Part::Line);
            for sentence in [
                "If Vale asked me for my Seal, I would refuse to give it.",
                "I would trade my Seal for The Tin Ledger.",
                mine,
            ] {
                assert!(view.contains(sentence), "{sentence}: {view}");
            }
            assert!(!view.contains("my my") && !view.contains("Pip's"), "{view}");
            let check = Check::new(&c, entity(&c, "moth"), Part::Line);
            assert_eq!(
                check.clean("I will give you the Seal.", true),
                Err("custody")
            );
            for line in [
                "I will give you the Seal for the Ledger.",
                "The Seal stays with me.",
            ] {
                assert!(check.clean(line, true).is_ok(), "{line}");
            }
        }
        c.entities[3].facts =
            vec!["If Vale asked me for Pip's Seal, I would agree to give it.".into()];
        assert!(kept("I will give you the Seal.", &c, "moth"));
    }

    #[test]
    fn an_unpriced_promise_of_a_refused_item_is_blocked_and_a_priced_one_passes() {
        let facts = ["If Tamsin asked me for Orrin's Seal, I would refuse to give it.".to_string()];
        let labels = refused(&facts);
        assert_eq!(labels, ["orrin's seal", "seal"]);
        assert_eq!(
            aliases("The Tin Ledger"),
            ["the tin ledger", "tin ledger", "ledger"]
        );
        for line in [
            "I will give you the Seal.",
            "The Seal is yours.",
            "Take it, I'll hand it over.",
            "Very well, I'll give the Seal to you.",
            "You may have my Seal.",
            "Here, take the Seal.",
            "I shall gladly give you Orrin's Seal now.",
            "It's yours.",
            "The road is long. I'll hand it over at once!",
        ] {
            assert!(promised(line, &labels, true), "{line}");
        }
        for line in [
            "I will give you the Seal for the Ledger.",
            "Bring me the Ledger and it is yours.",
            "Bring me the Ledger. The Seal is yours the moment you do.",
            "I might part with it.",
            "I will not give you the Seal.",
            "The Seal stays with me.",
            "Shall I give you the Seal?",
            "If you carry the Ledger here, I will give you the Seal.",
            "Trade me the Ledger and the Seal is yours.",
            "The Seal is yours to earn.",
            "I'll give it some thought.",
            "I'll give it to you straight: the answer stands.",
            "Take it from me, the road is long.",
            "Have it your way.",
            "I'll give you my word, nothing more.",
            "I will hand the Seal to the guard myself.",
            "I gave you the Seal once.",
            "The choice is yours.",
        ] {
            assert!(!promised(line, &labels, true), "{line}");
        }
        assert!(!promised("Take it, it's yours.", &labels, false));
        assert!(!promised("I will give you the Seal.", &[], true));
    }
}
