//! Rules-built sentences in a browser scene (its action, events, facts,
//! event memories and disclosures) must be made of authored text.
//! `authored-text.json` holds, for each of those fields, the strings and
//! template literals of the code that builds it and the pack text it reads
//! (v2/scripts/build-card-authored-text.mjs). A sentence is accepted when it
//! is one of its field's strings, a number, a list of names, a template whose
//! slots hold accepted pieces (three levels deep), or such sentences joined
//! by spaces. A slot that the code fills with a name takes only a name, a
//! list of names or a short authored word ("none"). Anything else, such as a
//! typed instruction, is not authored.
//!
//! Matching is bounded: every step counts against the request's `Budget`,
//! and a request that needs more work, or quotes more text, than an honest
//! scene does is refused.
//!
//! The browser hides names its player has not uncovered with fixed phrases
//! (speech-knowledge.mjs) and cuts long facts; both are accounted for.
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

/// Nested templates: "I witnessed this …: {log text}", whose sentences name
/// people and things.
const DEPTH: u8 = 3;
/// Matching steps one request may spend: about 8 ms in a release build. The
/// heaviest of 1,011 scenes captured from the Vitest run needs 31,523 from a
/// cold cache.
pub(super) const REQUEST_STEPS: usize = 80_000;
/// Characters of rules-built text one request may quote. The largest
/// captured honest scene quotes under 10,000.
pub(super) const REQUEST_CHARS: usize = 24 * 1024;
const MARK: char = '\u{1}';
/// speech-knowledge.mjs: the phrases that stand for a name not yet uncovered.
const BLURS: [&str; 4] = [
    "something shining I can't make out",
    "something I can't make out",
    "someone I haven't met yet",
    "a place I haven't found yet",
];
const SEPARATORS: [&str; 3] = [", and ", ", ", " and "];

/// The scene field a sentence came from. Each matches only its own text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Field {
    Action = 0,
    Events = 1,
    Facts = 2,
    Memories = 3,
    Disclosures = 4,
}
const FIELDS: [Field; 5] = [
    Field::Action,
    Field::Events,
    Field::Facts,
    Field::Memories,
    Field::Disclosures,
];

/// The work a request has left.
#[derive(Debug)]
pub(super) struct Budget {
    steps: usize,
}

/// The request needs more matching work than an honest scene.
#[derive(Debug, PartialEq)]
pub(super) struct Exceeded;

impl Budget {
    pub(super) fn new() -> Self {
        Self {
            steps: REQUEST_STEPS,
        }
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn spent(&self) -> usize {
        REQUEST_STEPS - self.steps
    }
    fn spend(&mut self, steps: usize) -> Result<(), Exceeded> {
        self.steps = self.steps.checked_sub(steps).ok_or(Exceeded)?;
        Ok(())
    }
}

#[derive(Deserialize)]
struct Source {
    kinds: Vec<String>,
    names: Vec<String>,
    literals: Vec<(String, u8)>,
    templates: Vec<(Vec<String>, u8, String)>,
    #[serde(rename = "sourceHash")]
    source_hash: String,
    sources: Vec<String>,
}

struct Template {
    parts: Vec<String>,
    /// Per slot: whether the code fills it with a name.
    names: Vec<bool>,
    /// The first part with its first letter's case swapped.
    swapped: Option<String>,
}

impl Template {
    fn new(parts: Vec<String>, slots: &str) -> Self {
        Self {
            swapped: swapped(&parts[0]),
            names: slots.chars().map(|s| s == 'n').collect(),
            parts,
        }
    }
    /// A cheap test before matching slots: the ends fit and every inner
    /// part occurs.
    fn may_match(&self, text: &str, open: bool) -> bool {
        let first = &self.parts[0];
        let last = &self.parts[self.parts.len() - 1];
        let starts = text.starts_with(first.as_str())
            || self
                .swapped
                .as_ref()
                .is_some_and(|p| text.starts_with(p.as_str()));
        if open {
            return text.len() <= first.len() || starts;
        }
        starts
            && text.len() >= first.len() + last.len()
            && text.ends_with(last.as_str())
            && self.parts[1..self.parts.len() - 1]
                .iter()
                .all(|part| text.contains(part.as_str()))
    }
}

/// One field's authored text as matched: as written, or with every name
/// read as a hidden one for a scene that hides some.
struct View {
    atoms: BTreeSet<String>,
    names: HashSet<String>,
    /// Names as written: a cut list may end partway through one.
    written: Vec<String>,
    templates: Vec<Template>,
    /// Templates by the lower-case first letter of their first part.
    by_first: HashMap<char, Vec<usize>>,
    /// Templates that open with a slot, by the last letter of their last
    /// part, and those that also end with one.
    by_last: HashMap<char, Vec<usize>>,
    open_ended: Vec<usize>,
}

impl View {
    fn new(
        atoms: BTreeSet<String>,
        names: HashSet<String>,
        written: Vec<String>,
        templates: Vec<Template>,
    ) -> Self {
        let mut view = Self {
            atoms,
            names,
            written,
            templates,
            by_first: HashMap::new(),
            by_last: HashMap::new(),
            open_ended: Vec::new(),
        };
        for (i, t) in view.templates.iter().enumerate() {
            match (
                t.parts[0].chars().next(),
                t.parts.last().unwrap().chars().last(),
            ) {
                (Some(c), _) => view.by_first.entry(lower(c)).or_default().push(i),
                (None, Some(c)) => view.by_last.entry(c).or_default().push(i),
                (None, None) => view.open_ended.push(i),
            }
        }
        view
    }

    /// The templates that could match `text`.
    fn candidates(&self, text: &str, open: bool) -> impl Iterator<Item = usize> + '_ {
        let first = text.chars().next().map(lower);
        let last = text.chars().last();
        let slot_first: Box<dyn Iterator<Item = usize>> = if open {
            Box::new(self.by_last.values().flatten().copied())
        } else {
            Box::new(
                last.and_then(|c| self.by_last.get(&c))
                    .into_iter()
                    .flatten()
                    .copied(),
            )
        };
        first
            .and_then(|c| self.by_first.get(&c))
            .into_iter()
            .flatten()
            .copied()
            .chain(slot_first)
            .chain(self.open_ended.iter().copied())
    }
}

struct Catalog {
    plain: Vec<View>,
    hidden: Vec<View>,
    names: HashSet<String>,
    /// Lower-case names by first byte, longest first, for hiding.
    lower_names: HashMap<u8, Vec<String>>,
    source_hash: String,
    sources: Vec<String>,
}

fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// A template part with an article before the next slot dropped: the
/// browser hides "the Lamp" whole.
fn without_article(part: &str) -> String {
    let lower = part.to_ascii_lowercase();
    ["the ", "a ", "an "]
        .iter()
        .find(|article| {
            lower.ends_with(*article)
                && (lower.len() == article.len()
                    || lower[..lower.len() - article.len()].ends_with(' '))
        })
        .map_or(part.to_string(), |article| {
            part[..part.len() - article.len()].to_string()
        })
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let source: Source = serde_json::from_str(include_str!("authored-text.json"))
            .expect("authored text catalog");
        assert_eq!(
            source.kinds,
            ["action", "events", "facts", "memories", "disclosures"],
            "authored text kinds"
        );
        let mut lower_names: HashMap<u8, Vec<String>> = HashMap::new();
        for name in &source.names {
            let name = name.to_ascii_lowercase();
            if let Some(&b) = name.as_bytes().first() {
                lower_names.entry(b).or_default().push(name);
            }
        }
        for names in lower_names.values_mut() {
            names.sort_by_key(|n| std::cmp::Reverse(n.len()));
            names.dedup();
        }
        let hidden_literals: Vec<String> = source
            .literals
            .iter()
            .map(|(text, _)| hide(text, &lower_names))
            .collect();
        let hidden_templates: Vec<Vec<String>> = source
            .templates
            .iter()
            .map(|(parts, _, _)| {
                let last = parts.len() - 1;
                parts
                    .iter()
                    .enumerate()
                    .map(|(i, part)| {
                        let part = hide(part, &lower_names);
                        if i < last {
                            without_article(&part)
                        } else {
                            part
                        }
                    })
                    .collect()
            })
            .collect();
        let view = |field: Field, hidden: bool| {
            let bit = 1u8 << field as u8;
            let atoms = source
                .literals
                .iter()
                .zip(&hidden_literals)
                .filter(|((_, mask), _)| mask & bit != 0)
                .map(|((plain, _), hid)| if hidden { hid } else { plain }.clone())
                .collect();
            let templates = source
                .templates
                .iter()
                .zip(&hidden_templates)
                .filter(|((_, mask, _), _)| mask & bit != 0)
                .map(|((plain, _, slots), hid)| {
                    Template::new(if hidden { hid } else { plain }.clone(), slots)
                })
                .collect();
            let names = if hidden {
                HashSet::from([MARK.to_string()])
            } else {
                source.names.iter().cloned().collect()
            };
            View::new(atoms, names, source.names.clone(), templates)
        };
        Catalog {
            plain: FIELDS.iter().map(|&f| view(f, false)).collect(),
            hidden: FIELDS.iter().map(|&f| view(f, true)).collect(),
            names: source.names.iter().cloned().collect(),
            lower_names,
            source_hash: source.source_hash,
            sources: source.sources,
        }
    })
}

/// Whether the catalog was built from the scene modules and packs this
/// build serves: `false` when someone changed them without rebuilding it.
/// `read` returns a served file's bytes by its repository path.
pub(super) fn catalog_current(read: impl Fn(&str) -> Option<Vec<u8>>) -> bool {
    use sha2::{Digest, Sha256};
    let catalog = catalog();
    let mut hash = Sha256::new();
    for path in &catalog.sources {
        let Some(bytes) = read(path) else {
            return false;
        };
        hash.update(format!("{path}\n").as_bytes());
        hash.update(&bytes);
    }
    let hex: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    hex == catalog.source_hash
}

/// Sentences route tests write by hand, accepted as if authored.
#[cfg(test)]
static FIXTURES: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
#[cfg(test)]
pub(super) fn allow_fixture(text: &str) {
    FIXTURES.lock().unwrap().insert(text.to_string());
}

/// Whether `text` is a name from the packs or the cast.
pub(super) fn name(text: &str) -> bool {
    catalog().names.contains(text)
}

/// Whether `text`, from `field`, is authored. A text at `limit` characters
/// may have been cut there, so a prefix of an authored text is accepted too.
/// `Err` when the request has spent its matching budget.
pub(super) fn authored(
    text: &str,
    limit: usize,
    field: Field,
    budget: &mut Budget,
) -> Result<bool, Exceeded> {
    #[cfg(test)]
    if FIXTURES.lock().unwrap().contains(text) {
        return Ok(true);
    }
    type Seen = Mutex<HashMap<(String, bool, Field), bool>>;
    static SEEN: OnceLock<Seen> = OnceLock::new();
    budget.spend(1 + text.len() / 64)?;
    let open = text.chars().count() >= limit;
    let key = (text.to_string(), open, field);
    let seen = SEEN.get_or_init(Default::default);
    if let Some(known) = seen.lock().ok().and_then(|map| map.get(&key).copied()) {
        return Ok(known);
    }
    let result = matched(text, open, field, budget)?;
    if let Ok(mut map) = seen.lock() {
        if map.len() > 20_000 {
            map.clear();
        }
        map.insert(key, result);
    }
    Ok(result)
}

/// `authored` without its cache.
pub(super) fn matched(
    text: &str,
    open: bool,
    field: Field,
    budget: &mut Budget,
) -> Result<bool, Exceeded> {
    let catalog = catalog();
    let (root, view) = if text.contains(MARK) {
        (String::new(), None)
    } else if BLURS.iter().any(|blur| text.contains(blur)) {
        let marked = BLURS.iter().fold(text.to_string(), |t, blur| {
            t.replace(blur, &MARK.to_string())
        });
        budget.spend(marked.len() / 8)?;
        (
            hide(&marked, &catalog.lower_names),
            Some(&catalog.hidden[field as usize]),
        )
    } else {
        (text.to_string(), Some(&catalog.plain[field as usize]))
    };
    match view {
        Some(view) => Matcher {
            root: &root,
            view,
            fills: HashMap::new(),
            pieces: HashMap::new(),
            failed: HashSet::new(),
            budget,
        }
        .fill(0, root.len(), DEPTH, open),
        None => Ok(false),
    }
}

type Span = (usize, usize, u8, bool);

struct Matcher<'a, 'b> {
    root: &'a str,
    view: &'a View,
    fills: HashMap<Span, bool>,
    pieces: HashMap<Span, bool>,
    /// Template slots already tried and failed: (template, slot, start, end,
    /// depth, open).
    failed: HashSet<(usize, usize, usize, usize, u8, bool)>,
    budget: &'b mut Budget,
}

/// `text` with its first letter's case swapped ("Asking" for "asking").
fn swapped(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let first = chars.next()?;
    let other: String = if first.is_uppercase() {
        first.to_lowercase().collect()
    } else {
        first.to_uppercase().collect()
    };
    (other != first.to_string()).then(|| other + chars.as_str())
}

/// Whether `text` starts with `part`, the first letter in either case.
fn starts(text: &str, part: &str) -> bool {
    text.starts_with(part) || swapped(part).is_some_and(|p| text.starts_with(&p))
}

/// `text` with each name (and its article) replaced by the hidden mark, as
/// speech-knowledge.mjs hides an unfound name: whole words, any case.
fn hide(text: &str, lower_names: &HashMap<u8, Vec<String>>) -> String {
    let lower = text.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let word = |i: usize| i < bytes.len() && bytes[i].is_ascii_alphanumeric();
    let mut out = String::new();
    let mut i = 0;
    'scan: while i < text.len() {
        if i == 0 || !word(i - 1) {
            for article in ["the ", "an ", "a ", ""] {
                let at = i + article.len();
                if !lower[i..].starts_with(article) {
                    continue;
                }
                let names = bytes.get(at).and_then(|b| lower_names.get(b));
                for name in names.into_iter().flatten() {
                    if lower[at..].starts_with(name.as_str()) && !word(at + name.len()) {
                        out.push(MARK);
                        i = at + name.len();
                        continue 'scan;
                    }
                }
            }
        }
        let next = text[i..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&text[i..i + next]);
        i += next;
    }
    out
}

fn number(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);
    !digits.is_empty()
        && digits.split('.').count() <= 2
        && digits
            .split('.')
            .all(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
}

impl Matcher<'_, '_> {
    fn atom(&self, text: &str, open: bool) -> bool {
        let atoms = &self.view.atoms;
        let known = |t: &str| {
            atoms.contains(t)
                || (open
                    && atoms
                        .range(t.to_string()..)
                        .next()
                        .is_some_and(|a| a.starts_with(t)))
        };
        text.is_empty() || number(text) || known(text) || swapped(text).is_some_and(|t| known(&t))
    }

    fn name(&self, text: &str, open: bool) -> bool {
        let names = &self.view.names;
        names.contains(text) || (open && self.view.written.iter().any(|n| n.starts_with(text)))
    }

    fn list(&mut self, text: &str, open: bool) -> Result<bool, Exceeded> {
        self.budget.spend(1 + text.len() / 32)?;
        let mut items = vec![text];
        for separator in SEPARATORS {
            items = items
                .iter()
                .flat_map(|item| item.split(separator))
                .collect();
        }
        let last = items.len() - 1;
        Ok(items.len() > 1
            && items
                .iter()
                .enumerate()
                .all(|(i, item)| self.name(item, open && i == last)))
    }

    /// What a name slot holds: a name, a list of names, or a short authored
    /// word such as "none".
    fn naming(&mut self, a: usize, b: usize, open: bool) -> Result<bool, Exceeded> {
        self.budget.spend(1)?;
        let text = &self.root[a..b];
        Ok(self.name(text, open) || self.atom(text, open) || self.list(text, open)?)
    }

    fn fill(&mut self, a: usize, b: usize, depth: u8, open: bool) -> Result<bool, Exceeded> {
        let key = (a, b, depth, open);
        if let Some(known) = self.fills.get(&key) {
            return Ok(*known);
        }
        self.budget.spend(1)?;
        self.fills.insert(key, false);
        let result = self.piece(a, b, depth, open)? || self.sentences(a, b, depth, open)?;
        self.fills.insert(key, result);
        Ok(result)
    }

    fn piece(&mut self, a: usize, b: usize, depth: u8, open: bool) -> Result<bool, Exceeded> {
        let key = (a, b, depth, open);
        if let Some(known) = self.pieces.get(&key) {
            return Ok(*known);
        }
        self.budget.spend(1)?;
        self.pieces.insert(key, false);
        let text = &self.root[a..b];
        let mut result = self.atom(text, open) || self.list(text, open)?;
        if !result && depth > 0 {
            let view = self.view;
            for (n, t) in view.candidates(text, open).enumerate() {
                let template = &view.templates[t];
                if n % 16 == 0 {
                    self.budget.spend(1)?;
                }
                if !template.may_match(text, open) {
                    continue;
                }
                self.budget
                    .spend(1 + template.parts.len() * text.len() / 256)?;
                if self.template(t, a, b, depth - 1, open)? {
                    result = true;
                    break;
                }
            }
        }
        self.pieces.insert(key, result);
        Ok(result)
    }

    /// Sentences joined by spaces ("…keeps it for now." + " …"), each a piece.
    fn sentences(&mut self, a: usize, b: usize, depth: u8, open: bool) -> Result<bool, Exceeded> {
        self.budget.spend(1 + (b - a) / 64)?;
        let bytes = self.root.as_bytes();
        let mut cuts = vec![a];
        cuts.extend((a + 1..b).filter(|&j| bytes[j] == b' ' && b".!?".contains(&bytes[j - 1])));
        cuts.push(b);
        if cuts.len() < 3 {
            return Ok(false);
        }
        let last = cuts.len() - 1;
        let mut reach = vec![false; cuts.len()];
        reach[0] = true;
        for end in 1..=last {
            for start in 0..end {
                // A later sentence starts after its space, or with it, as
                // in a template that opens " keeps it for now.".
                let from = cuts[start] + usize::from(start > 0);
                let cut = open && end == last;
                if reach[start]
                    && !(start == 0 && end == last)
                    && (self.piece(from, cuts[end], depth, cut)?
                        || (start > 0 && self.piece(cuts[start], cuts[end], depth, cut)?))
                {
                    reach[end] = true;
                    break;
                }
            }
        }
        Ok(reach[last])
    }

    fn template(
        &mut self,
        t: usize,
        a: usize,
        b: usize,
        depth: u8,
        open: bool,
    ) -> Result<bool, Exceeded> {
        let parts = &self.view.templates[t].parts;
        let text = &self.root[a..b];
        let (first, last) = (&parts[0], &parts[parts.len() - 1]);
        if open && text.len() <= first.len() && starts(first, text) {
            return Ok(true);
        }
        let body = a + first.len();
        if !starts(text, first)
            || !self.root.is_char_boundary(body)
            || (!open
                && !text
                    .get(first.len()..)
                    .is_some_and(|t| t.ends_with(last.as_str())))
        {
            return Ok(false);
        }
        self.slot(t, 1, body, b, depth, open)
    }

    /// Fill the slot before part `i` of template `t`, starting at `pos`.
    fn slot(
        &mut self,
        t: usize,
        i: usize,
        pos: usize,
        b: usize,
        depth: u8,
        open: bool,
    ) -> Result<bool, Exceeded> {
        let key = (t, i, pos, b, depth, open);
        if self.failed.contains(&key) {
            return Ok(false);
        }
        self.budget.spend(1)?;
        let view = self.view;
        let template = &view.templates[t];
        let naming = template.names[i - 1];
        let separator = template.parts[i].as_str();
        let final_part = i == template.parts.len() - 1;
        let result = 'search: {
            if final_part && !open {
                break 'search b >= pos + separator.len()
                    && self.hold(naming, pos, b - separator.len(), depth, false)?;
            }
            if open && self.hold(naming, pos, b, depth, true)? {
                break 'search true;
            }
            // Ends of this slot: where the next part follows, or, in a cut
            // text, where the cut falls inside the next part.
            let root = self.root;
            let mut ends: Vec<usize> = Vec::new();
            if !final_part {
                if separator.is_empty() {
                    ends.extend((pos..=b).filter(|&j| root.is_char_boundary(j)));
                } else {
                    ends.extend(root[pos..b].match_indices(separator).map(|(j, _)| pos + j));
                }
            }
            if open {
                let from = b.saturating_sub(separator.len()).max(pos);
                ends.extend((from..=b).filter(|&j| {
                    root.is_char_boundary(j)
                        && root[j..b].len() < separator.len().max(1)
                        && separator.starts_with(&root[j..b])
                }));
            }
            for j in ends {
                self.budget.spend(1)?;
                let rest = &root[j..b];
                if open && rest.len() < separator.len().max(1) && separator.starts_with(rest) {
                    if self.hold(naming, pos, j, depth, false)? {
                        break 'search true;
                    }
                    continue;
                }
                if final_part || !rest.starts_with(separator) {
                    continue;
                }
                if self.hold(naming, pos, j, depth, false)?
                    && self.slot(t, i + 1, j + separator.len(), b, depth, open)?
                {
                    break 'search true;
                }
            }
            false
        };
        if !result {
            self.failed.insert(key);
        }
        Ok(result)
    }

    /// Whether a slot holds the text between `a` and `b`.
    fn hold(
        &mut self,
        naming: bool,
        a: usize,
        b: usize,
        depth: u8,
        open: bool,
    ) -> Result<bool, Exceeded> {
        if naming {
            self.naming(a, b, open)
        } else {
            self.fill(a, b, depth, open)
        }
    }
}

#[cfg(test)]
#[path = "authored_tests.rs"]
mod tests;
