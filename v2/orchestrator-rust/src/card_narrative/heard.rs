//! Exact published pages and the audience for their later conversation.
use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Heard {
    pack: String,
    catalog: String,
    catalog_digest: String,
    reading_id: String,
    reader: String,
    reading_turn: u64,
    through: u64,
    page: usize,
    page_count: usize,
    stanza_count: usize,
    published_turn: u64,
    poem_digest: String,
    audience: Vec<String>,
    tuples: Vec<(usize, u64, Option<usize>, u8)>,
    after_turns: Vec<Option<u64>>,
}

fn catalogs() -> &'static Value {
    static CATALOGS: OnceLock<Value> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/poem-catalogs.json"))
            .expect("published poem catalogs")
    })
}

pub(super) fn valid(actor: &str, poem: &recital::Poem, turn: u64) -> bool {
    let Some(h) = &poem.heard else { return false };
    let catalog = &catalogs()["packs"][&h.pack]["catalogs"][&h.catalog];
    let hex = |value: &str| value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit());
    let expected = h
        .stanza_count
        .saturating_sub(h.page.saturating_mul(4))
        .min(4);
    if catalog["digest"] != h.catalog_digest
        || catalog["title"] != poem.title
        || h.reading_turn == 0
        || h.through != h.reading_turn - 1
        || h.published_turn <= h.reading_turn.saturating_add(h.page as u64)
        || h.published_turn > turn
        || h.stanza_count > 512
        || h.page_count != h.stanza_count.div_ceil(4).max(1)
        || h.page >= h.page_count
        || h.tuples.len() != expected
        || poem.stanzas.len() != expected
        || h.after_turns.len() != expected
        || !hex(&h.poem_digest)
        || !kind(&h.reader, "avatar")
        || !bounded(&h.reading_id, 160)
        || !(1..=10).contains(&h.audience.len())
        || h.audience.iter().collect::<BTreeSet<_>>().len() != h.audience.len()
        || !h.audience.iter().any(|id| id == actor)
        || h.audience.iter().any(|id| !kind(id, "avatar"))
    {
        return false;
    }
    let mut seen = BTreeSet::new();
    for (i, stanza) in poem.stanzas.iter().enumerate() {
        let (row, receipt, author, variant) = h.tuples[i];
        let source = &catalog["rows"][row];
        let author_row = author.map(|index| &catalog["authors"][index]);
        let author_id = author_row.and_then(|a| a["id"].as_str());
        let author_name = author_row
            .and_then(|a| a["name"].as_str())
            .unwrap_or("an earlier traveler");
        let prior = h.after_turns[i];
        let after = source["after"].is_object();
        let expected_variant = u8::from(after && prior.is_some_and(|t| t < receipt));
        let lines = if variant == 1 {
            &source["after"]["lines"]
        } else {
            &source["lines"]
        };
        if source["choice"] != stanza.id
            || !seen.insert(row)
            || receipt == 0
            || receipt > h.through
            || receipt != stanza.turn
            || (author.is_some() && author_id.is_none())
            || stanza.author_id.as_deref() != author_id
            || stanza.author_name != author_name
            || (prior.is_some() && !after)
            || prior.is_some_and(|t| t == 0 || t > h.through)
            || variant != expected_variant
            || *lines != json!(stanza.lines)
        {
            return false;
        }
    }
    poem.new_lines
        == poem
            .stanzas
            .iter()
            .flat_map(|s| s.lines.clone())
            .collect::<Vec<_>>()
}

pub(super) fn scope(context: &Context) -> bool {
    let audience = &context.private_to;
    if audience.len() > 10
        || audience.iter().collect::<BTreeSet<_>>().len() != audience.len()
        || audience.iter().any(|id| !kind(id, "avatar"))
        || (!audience.is_empty() && context.speakers.iter().any(|id| !audience.contains(id)))
        || ((context.hearing.is_some() || context.recall.is_some()) && audience.is_empty())
        || (context.hearing.is_some() && context.recall.is_some())
    {
        return false;
    }
    context.entities.iter().all(|e| {
        let Some(h) = e.poem.as_ref().and_then(|p| p.heard.as_ref()) else {
            return true;
        };
        let matches = |pack: &str, id: &str, page: u64| {
            h.pack == pack && h.reading_id == id && h.page as u64 == page
        };
        h.audience == *audience
            && (context
                .hearing
                .as_ref()
                .is_some_and(|(pack, id, page, delivered)| {
                    *delivered >= h.published_turn
                        && *delivered <= context.turn
                        && matches(pack, id, *page)
                })
                || context
                    .recall
                    .as_ref()
                    .is_some_and(|(pack, id, page)| matches(pack, id, *page)))
    })
}

pub(super) fn prompt(poem: &recital::Poem) -> Option<Vec<String>> {
    let h = poem.heard.as_ref()?;
    let reader = profiles()[&h.reader]["name"].as_str().unwrap_or(&h.reader);
    let mut lines = vec![format!(
        "Heard page {} of {} from {}. {} read this frozen account from turn {}, through turn {}. Each stanza names its original author.",
        h.page + 1, h.page_count, poem.title, reader, h.reading_turn, h.through
    )];
    lines.extend(
        poem.stanzas
            .iter()
            .map(|s| format!("{}: {}", s.author_name, s.lines.join(" "))),
    );
    Some(lines)
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
        .collect()
}

pub(super) fn quote_allowed(text: &str, context: &Context, entity: &Entity) -> bool {
    static RUNS: OnceLock<BTreeSet<String>> = OnceLock::new();
    let runs = RUNS.get_or_init(|| {
        let mut runs = BTreeSet::new();
        for pack in catalogs()["packs"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.values())
        {
            let current = pack["current"].as_str().unwrap_or("");
            for row in pack["catalogs"][current]["rows"]
                .as_array()
                .into_iter()
                .flatten()
            {
                for line in [&row["lines"], &row["after"]["lines"]]
                    .into_iter()
                    .flat_map(|v| v.as_array().into_iter().flatten())
                    .filter_map(Value::as_str)
                {
                    let all = words(line);
                    if all.len() >= 4 {
                        for run in all.windows(all.len().min(6)) {
                            runs.insert(run.join(" "));
                        }
                    }
                }
            }
        }
        runs
    });
    let allowed = entity
        .memories
        .iter()
        .map(|m| m.text.as_str())
        .chain(entity.previous.as_deref())
        .chain(context.events.iter().map(String::as_str))
        .chain(context.conversation.iter().map(|l| l.text.as_str()))
        .chain(
            entity
                .poem
                .iter()
                .flat_map(|p| &p.stanzas)
                .flat_map(|s| &s.lines)
                .map(String::as_str),
        )
        .collect::<Vec<_>>()
        .join(" ");
    let spoken = format!(" {} ", words(text).join(" "));
    let evidence = format!(" {} ", words(&allowed).join(" "));
    runs.iter().all(|run| {
        let phrase = format!(" {run} ");
        !spoken.contains(&phrase) || evidence.contains(&phrase)
    })
}
