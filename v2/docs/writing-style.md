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
compact presentation may resemble a logbook, but its copy never exposes event
types, tags, payload grammar, source sequence numbers, or debug fallbacks.

The three Journal regions have different jobs:

- **Current place** states durable context. It is not another chronological
  event and does not repeat as the newest history row.
- **Open threads** name a concrete unresolved question or available choice.
  Vague encouragement such as "lets what happened shape what comes next" is
  omitted until the choice can be named.
- **Story so far** records meaningful committed outcomes in chronological
  order. One entry may group several canonical events.

History headlines use named third-person past tense, an explicit subject, and
a meaningful verb: "Elsie discovered a path to the Old Oak Tree." They never
use `event`, `tag`, dotted machine keys, arrow movement, or subjectless
fragments such as "is now path to…".

A collapsed entry answers what happened. Expansion is offered only when it
adds a distinct fact: context, durable change, consequence, or unresolved
matter. Repeating the headline with punctuation is not detail. The room-header
ticker uses the exact latest visible headline rather than a second formatter.

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
