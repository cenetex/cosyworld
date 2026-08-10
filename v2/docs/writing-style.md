# CosyWorld writing style

The house rule: **let the magic be emergent, not forced.** The system does
something rare — a clock fills, a hidden exit reveals, an evolution completes —
and a plain surface is what makes that moment land. If every surface performs
wonder, no moment can.

The model sentence already in the pack:

> The ashes have been swept into a small arrow pointing from the hearth toward
> the low doorway.

Concrete, flat, no editorializing. The player does the enchanting.

## Rules by surface

Every player-visible string belongs to one register. Decide which before
writing.

### 1. Chrome (buttons, action hints, UI copy)

Invisible. Verbs and objects only.

- Yes: "Listen to the room." / "Choose a way out." / "Catch your breath."
- No: "Let the room whisper its first clue to you."
- Mechanical stakes stay plain and explicit: "Trouble may draw nearer while
  you rest." is the register to copy.

### 2. Environment text (location descriptions, feature look/search/use)

Concrete nouns, short sentences, at most one image. The second sentence must
add information, never restate the first one's mood.

- Objects report physical state, never feelings. "The charm cools in your
  palm." — not "…pleased by the circle's restraint."
- Second person belongs to the Left Sentences register. Routine world prose
  reports what is present without telling the player what they perceive.
- Never explain the subtext. "The dust shows careful footwork and no blood."
  already implies the rest; cutting the conclusion is what makes the player
  think it.
- Banned tells: "as if", "seems to", "meant for", objects that remember,
  weather with intentions.

### 3. Memory lines (location `memory` arrays)

Flat records of things that happened or things that are there. They read like
a logbook, not an epigraph.

- Yes: "Coach waits here." / "One of its bells is missing. It lies below the
  Darkest Ocean."
- No: "Clouds remember footsteps differently than dirt does."

### 4. Journal (current place, open threads, and story so far)

The production Journal is a player chronicle, not an event inspector. Its
presentation resembles a warm storybook: a short chapter recap followed by
small, turnable pages of remembered moments. Its copy never exposes event
types, tags, payload grammar, source sequence numbers, or debug fallbacks.

The three Journal regions have different jobs:

- **Current place** states durable context. It is not another chronological
  event and does not repeat as the newest history row.
- **Open threads** name a concrete unresolved question or available choice.
  Vague encouragement such as "lets what happened shape what comes next" is
  omitted until the choice can be named.
- **Story so far** records meaningful committed outcomes in chronological
  order. One entry may group several canonical events. The chapter recap names
  the dominant themes and latest turn using only those curated beats; it does
  not call a language model or invent connective lore.

History headlines use named third-person past tense, an explicit subject, and
a meaningful verb: "Elsie discovered a path to the Old Oak Tree." They never
use `event`, `tag`, dotted machine keys, arrow movement, or subjectless
fragments such as "is now path to…".

Each page carries no more than six beats so history reads as a sequence of
leaves rather than an event wall. A clipped entry may unfold to reveal the same
complete, authoritative sentence; that responsive disclosure is a reading aid,
not a second layer of facts. The room-header ticker uses the exact latest
visible headline rather than a second formatter.

Journal copy is a deterministic projection of committed state. Unknown source
events stay out of player copy and become presentation-coverage diagnostics;
they do not fall back to their type name. Language models do not generate this
surface.

### 5. Character voice (actor/card blurbs, NPC speech prompts, persona fields)

Wit is allowed here — character humor is earned, and it pops harder against a
quiet world. Persona fields are AI steering, not player prose; keep them vivid.
The speech-prompt base already enforces the output register ("punchlines over
poetry", banned vocabulary, no objects that remember things) — keep new NPC
prompts consistent with it.

Generated dialogue is the largest body of player-visible prose in the game, so
one part of that register is executable rather than prompt-only. The publication
gate rejects **scenery acting with intent** (`voice_object_agency`): an
inanimate scene noun as the subject of a verb of intent, judgement, or memory.

- No: "the path is learning my name" / "these hills recruit me" / "the kettle
  remembers every argument" / "Lantern Bend has welcomed me".
- Yes: "the path is steep and my boots are wet" / "Elsie welcomes me every
  single time" / "i remember the kettle, and i want it back".

The rule is narrow on purpose. A *person* who wants, judges, or remembers is
ordinary speech, and imagery is untouched — only the scenery doing the wanting
breaks the register, which is the same ban §2 places on environment text. Wit
itself is not gated: how much figurative license a character gets remains a
voice decision, not a check.

### 6. Rare system moments (the magic budget)

Lyricism is spent only where the system did something rare: hidden-exit
discovery text, evolution completion, clock-fill aspects, the deepest zones
(Dark Abyss keeps its banquet). One poetic line at a real event reads as an
event. The same line on a doorknob reads as wallpaper.

### 7. Left Sentences (the authored lyric register)

Sentences are where the remaining magic budget is spent. If a lyric line wants
to exist somewhere else, it is probably a sentence. The canonical corpus lives
in `v2/content/core/sentences.json`.

- Second person is permitted only here.
- Use present-tense declarations without hedging. The turn happens once, then
  stops.
- Keep whimsy and ontological unease together; avoid bodily horror and gore.
- No despair without hospitality. Every dark shelf keeps one lit window.
- "As if" and "seems to" remain authorially banned even though this collection
  is exempt from ordinary world-prose lint.

### 8. Chance feedback (every d20 the kernel resolves)

**One disclosure rule for every roll.** Where the kernel resolves a d20, the
result is shown as a story beat *and* the arithmetic that produced it. Chance
is legible because the referee is deterministic and has nothing to hide; a
player who missed is owed the reason.

The card carries a title, the mechanics, and a plain outcome:

```
Lantern Stitch finds an opening
Ashwood Practice Blade · Strength attack · d20 14 +3 = 17 vs AC 13
it lands
```

- Attacks read `<Ability> attack · … vs AC <n>`; ordinary checks read
  `<Ability> check · … vs DC <n> · <outcome>`. Both come from one formatter
  (`abilityCheckMechanics`) so the two surfaces cannot drift apart.
- The outcome line stays plain language — "it lands", "not this time", "a clue
  appears". Arithmetic explains the outcome; it never replaces it.
- Damage, HP, and recovery keep their existing prose treatment. This section
  governs the roll, not its consequences: "Gust looks steadier" is still right,
  and zero-HP language is still banned.
- The same roll may appear in both the transcript and the Log. That is
  deliberate: the transcript carries the beat you read, the Log the row you
  scan. They render from `detail` and `story` on the same event.

This reverses an earlier stance under which combat hid its arithmetic while
ordinary checks exposed theirs — the same kernel roll with two opposite rules.
Both browser assertions in `v2/scripts/smoke-browser.mjs` now pin exact
arithmetic. See issue #464.

## Review checklist

- [ ] Could this sentence appear on a button a player reads 200 times?
      Then it is chrome: verbs and objects.
- [ ] Does any object have an opinion, feeling, or memory? Delete it or move
      it to a character.
- [ ] Does sentence two explain sentence one? Cut sentence two.
- [ ] Grep the diff for "as if" and "seems to" in look/search/use/description
      fields.
- [ ] Was lyricism spent on a rare system moment, or on furniture?
- [ ] Does Journal copy expose an event key, tag, arrow, payload delimiter, or
      generic fallback? Replace it with a semantic outcome or omit it.
- [ ] Does every Journal disclosure add information absent from its headline?
      If not, remove the disclosure affordance.

## Governance

The lint conforms to this document. When lint and doc disagree, the doc wins
and the lint changes.

Register governs sound; canon governs meaning. See `canon.md` for the
whimsical-cosmic-horror doctrine that defines what the world is allowed to
mean.
