# Builder AI and summoning

Status: design, 2026-10-29. Draft for the owner. No code yet. Built in
small steps (see "Build order").

## Outcome

Two things, one idea: **the AI writes, the rules decide.**

1. **A builder AI** turns a short brief into a checked, playable world pack.
   It ends as one pull request per pack. The owner approves the outline and
   the art; checks prove the rest.
2. **Summoning.** In a private world, a player can bring new people, things
   and places into being from inside the game. They do it with a card and
   Talk, not a menu. A summoned thing is data in the save. The same schema
   that checks authored packs checks it, and journal replay rebuilds it.

## How a pack is built today

A card pack is three files and some art. See [card packs](../../v2/docs/card-packs.md).

| Step | File or command | What it holds |
| --- | --- | --- |
| World | `v2/content/<id>/card-world.json` | `id`, `packId`, `revision`, `name`, `description`, `tone`, `entry`, `continuity`, `places`, `avatars`, `items`, `fixtures`, `routes`, `choices`, `sections`, `release`, `specials`, `storyQuests`, `topics`, `situations`, `observations`, `sources` |
| Place | inside `places` | `name`, `text`, `persona` (speaks as the place), `exits`, `backdrop`, optional `art`, `music`, `road` (two fixed ends), `backdrops` (state variants: `backdrop` + closed `requires`; the first match supplies the final painting, with its own day/night conditions) |
| Person | inside `avatars` | `name`, `text`, `place`, `home`, `persona`, `voice`, `tastes` (`likes`, `sore`, `reason`, `noise`), `desire`, `values` (what hub items are worth to them), `portrait`, `expression`, `travels`, `standoffs`, optional `temperament` |
| Thing | inside `items` | `name`, `text`, `holder`, `persona`, `art` |
| Bridge | `v2/worlds/<id>/card-bridge.json` | `crossings` (from, to, `requires`, `signal`, `scenery`), `values`, `transports` |
| Mount | `v2/worlds/card-table.json` | the pack id in `packs` |
| Art | `v2/card-game/assets/<id>/` | backdrops (16:9, day and night), portraits and cutouts (3:4, alpha), item art |
| Art record | `art-prompts.json`, `*-provenance.json` | full prompts, references, source hashes, sizes |
| Compile | `npm run v2:card:pack:build` | `packs.json`, image variants, media hashes, shared engine (Cargo builds the asset module) |
| Check | `npm run v2:card:pack:check`, `npm run v2:worldpack` | schema, stale outputs, story warnings |
| Rules | `npm run v2:card:shared:next` | the next shared rules version (packs.json is inside the bundle) |
| Tests | `test/card-<pack>.test.mjs`, a smoke script | a walk in and back through a reload, each story path |

Notes from the code:

- `pack-schema.mjs` rejects unknown fields and kinds, dangling ids and
  missing art, in the build and again on load. `check-worldpack.mjs` checks
  the **classic** contract; the card check is `build-card-worldpacks.mjs --check`.
- Card art comes from the agent's built-in image tool (`"tool": "built-in
  image_gen"` in the #1274, #1287, #1289 provenance files). No repo script,
  no repo API cost. `generate-card-art.mjs` is classic (Replicate, Flux).
- The Rust text route trusts only profiles from embedded `packs.json`,
  `entity-profiles.json`, `boardyai.json` and `shared-cast.json`
  (`base_profiles()` in `card_narrative.rs`). Other ids cannot speak.
- `validateWorld()` checks ids against fixed module sets (`actorIds`,
  `places`, `ids`). A save with an unknown id fails.

## The builder AI pipeline

The builder is an **agent recipe plus a deterministic checker**. The agent
(Codex or Claude, as today) writes; a new `npm run v2:card:pack:audit -- <id>`
judges. No paid API is called from the repo.

| Stage | Who | Artifact | Gate |
| --- | --- | --- | --- |
| 0. Brief | Owner | `v2/content/<id>/BRIEF.md`: source or idea, tone, licence, 3–8 places, 2–8 people, the thing that scatters, where it attaches | Owner writes or approves it |
| 1. Outline | AI | `outline.json`: towns, the one road or door that attaches it, cast with one line each, items, story spine (start, middle, two endings), topics | **Owner taste gate 1** |
| 2. Draft | AI | `card-world.json`, `card-bridge.json`, mount line | Schema |
| 3. Audit | Checker | audit report in the PR | All mechanical checks pass |
| 4. Art briefs | AI | `art-prompts.json` with one style lock for the pack | Checker: every media path has a prompt |
| 5. Paint | AI (built-in image tool) | PNGs, WebP copies, provenance JSON, a contact sheet at desktop and 390 × 580 phone | **Owner taste gate 2** |
| 6. Bind | AI | `v2:card:pack:build`, `v2:card:shared:next`, version bump | `v2:card:pack:check`, replay tests |
| 7. Prove | AI | `test/card-<id>.test.mjs` generated from the outline, one smoke journey | `npm test`, smoke at both widths |

One pack is one PR. Art may land first as its own "Paint" PR, as now.

### What the audit checks

The audit adds the checks the schema cannot do alone:

1. **Map rule.** Inside a town, places link directly. Between towns there is
   exactly one road place, with two ends and its own painting. No new dock or
   lane: the seven ports and seven lanes are final, at most four per port.
2. **Reachability.** Every place is reachable from the entry, and every place
   has a way home. A scattered thing has at least one floor destination.
3. **Story solvability.** A headless walker drives `world.mjs` legal plays
   (bounded search) from a fresh save until each `storyQuests` ending is
   reached. It writes the shortest path into the test file. This is the
   proof that the pack is **playable**, not just valid.
4. **Talk coverage.** Each story step has three clues in `topics` (the
   three-clue rule), each spoken by someone reachable before that step.
5. **Voice.** Each `persona` and `voice` is inside the length bounds and
   passes the writing-register check. No two residents share a voice brief.
6. **Art.** Every media path exists, has its provenance record, and matches
   the size and alpha rules (stage WebP, 512-pixel card copies).
7. **Budget.** Places, people, items and text stay within agreed sizes, so
   `packs.json` growth is visible in the PR.

### What needs a human

The checker proves shape and play, not taste. The owner keeps the brief
(subject, source, licence), the outline (who is in it, what the story
means), the art contact sheet, any real person or real account, and where
the world attaches. Ids, exits, tastes, values, topics, item text, crossing
scenery and test journeys are the builder's work.

## Summoning in play

### The Unwritten card

Summoning uses one new hub item: the **Unwritten card**, a blank card with a
faint border. It fits the card metaphor: a card that has not yet been
written. It is an ordinary item. It can be carried, given, traded and put
down. The number you hold is the number of things you can write.

- A new private world puts one Unwritten card on the floor of your home.
- Completing a story quest leaves one more Unwritten card with you.
- An avatar can hold at most three.

### What you pair it with decides what you write

No new button or panel. The player uses the existing pair plays in the row
below the hand (see `ACTIONS.md`), and the result arrives through Talk.

| Hand | Play | Writes |
| --- | --- | --- |
| Unwritten card + a person | Talk | someone that person knows: a friend, a rival, a cousin |
| Unwritten card + the current place | Write here | a room or a door at this place |
| Unwritten card + an item | Write its pair | a thing that belongs with that item |

Who you ask shapes what comes. Mara knows theatre people. The keeper knows
the old station staff. Badger knows the forest. The AI writes from the
writer's own facts, the place and the item. This is the Cultist Simulator
idea: you make new things by combining cards you already hold.

### From first summon to a card in hand

1. **Ask.** Vale holds the Unwritten card and Talks to Mara. Mara answers in
   her own voice: *"There was a prompter at the Paper theatre. Nobody saw
   her face, only her hands in the wings."*
2. **The card develops.** The Unwritten card leaves the hand. A **faint
   card** for the Prompter takes its place: drawn in ink, not yet painted.
   It is a proposal. It cannot act and nobody else can see it.
3. **Accept by playing it.** The first committed play that uses the faint
   card fixes it: Talk to the Prompter, or Invite her along. Now she is a
   resident with a home, tastes and a voice. Her card is in the hand.
4. **Or ask again.** Talk to Mara again while the faint card is in hand. The
   old proposal fades and Mara offers another. Each Unwritten card allows
   three proposals. After the third, the last one stays.
5. **Or let it go.** Put the faint card down, or leave it for eight turns.
   It fades and the blank Unwritten card comes back. Nothing is lost.
6. **Paint (later step).** A fixed card starts as an ink sketch (see "Art").
   The player can ask for a painting with their own OpenRouter credits.

The rules, not the AI, decide the kind, the id, the home, the holder, the
attachment and every gate. The AI only writes text inside a fixed shape.

### What a summoned thing can do

- **A person** is a resident. It has `name`, `text`, `persona`, `voice`,
  `tastes`, `desire`, `values` and `expression`. In the first version it
  stays at home (`travels: false`, `standoffs: false`). It talks, holds
  things, gives and trades under the usual willingness rules.
- **A thing** is an item. It rests where it was written or with its writer.
  It has no special play. Its worth to others is the default.
- **A place** is a room or a door (see "Attachment to the map").

A summoned thing cannot name conditions, effects, choices, routes, signals,
story quests or topics. It cannot meet an authored story requirement,
because authored requirements name authored ids. Summoning adds colour and
company, never a shortcut through a story.

## Data model and replay

### Where it lives

One new save field, `summoned`. (The name `summons` is already used by the
Bard's recital verses.)

```jsonc
"summoned": {
  "version": 1,
  "next": 4,                          // next number; ids are never reused
  "entries": {
    "summoned-3": {
      "kind": "avatar",                // avatar | item | place
      "state": "fixed",                // faint | fixed | faded
      "writer": "mara", "by": "vale",  // who answered, who held the card
      "turn": 812, "fixedTurn": 813,
      "at": "theatre",                 // its authored anchor place
      "attach": null,                  // places only: "door" | "room"
      "proposals": 2,                  // 1..3
      "card": {                        // a closed subset of a pack entity
        "name": "The Prompter", "text": "...", "persona": "...",
        "voice": "...", "tastes": { "likes": "...", "sore": "...", "reason": "..." },
        "desire": { "items": [], "location": null, "avatars": [] },
        "expression": "speech"
      },
      "art": null,                     // or { "sha256", "type": "image/webp" }
      "hash": "..."                    // sha256 of the canonical card JSON
    }
  }
}
```

The running state is ordinary: a fixed person is in `world.actors`, a thing
is in `world.items`, a place is in `world.locations` with its crossing in
`world.crossings`. `summoned.entries` is the catalog for those ids.

### Ids

- `summoned-<n>`, numbered per world. The pack schema forbids authored ids
  that start with `summoned-`, so they never collide.
- An id is never reused, even after it fades. Memories and quest history that
  name it stay valid.

### How validateWorld treats it

1. Check `summoned` first: version, `next`, each entry's fields, the limits
   below, and the `hash`.
2. Build one synthetic pack from the fixed entries (`id: "summoned"`) and run
   the same `packProblems()` from `pack-schema.mjs` on it, with a closed
   field list. A summoned entry may only use the fields shown above.
3. Validate the rest of the save against authored ids **plus** summoned ids.
4. A faint entry has no actor, item or place yet. A faded entry keeps its
   record and its id but is not active. An entry that fails its checks after
   a later rule change becomes `faded`, never deleted.

### The journal

The shared journal already records AI output as data: a speech command
carries its knowledge disclosure, and a reflection is checked against
witnessed events before it is recorded. Summoning follows the same path.

- `summon-ask`: the server asks the model, validates the answer, and records
  the play and the proposal in one command. Replay never calls a model.
- `summon-fix`: part of the first committed play that uses the faint card.
- `summon-fade`: on put-down or after eight turns.
- `summon-art`: the image hash only. Missing bytes show the ink sketch; art
  never changes rules.

Local saves record the same entries. The local upgrader adds an empty
`summoned` field.

### The content seam

Today `pack-registry.mjs` builds module constants from `packs.json`, and
`validateWorld()`, the quest validators and the Rust text route read fixed
sets. Summoned content cannot be compiled into a rules bundle, so these
readers must take content from the world.

The **minimum seam** is:

1. `createRegistry(content)` in `pack-registry.mjs`. It returns today's
   lookups (`packPlaces`, `packPeople`, `packThings`, `packEntity`,
   `packProfiles`, `crossings`, ...) for a given content set. The module
   default stays `createRegistry(compiled)`, so nothing else changes.
2. `registryFor(world)`: the compiled registry plus one overlay built from
   `world.summoned`. Cached by the summoned hash. Every rule that looks up an
   id through a world calls this.
3. The Rust text route accepts summoned profiles. In a shared world the
   server reads them from the saved world it already holds. In local play the
   browser sends them, and the server applies the same field and length
   bounds and the safety check. It marks them as player-written.

Content versioned separately from rules (packs.json out of the bundle) is
**not** needed for summoning: summoned content is save data, not bundle
data. It would help the builder, because a new pack would then not need a
new rules version. It can follow later.

The same overlay can also carry **linked NFT avatars** into the card table
later (see "Linked avatars").

## Attachment to the map

The map rule holds: rooms inside a town link directly; towns join by one
road or a sea lane; the seven ports and seven lanes are final. A summoned
place never adds a road, a dock or a lane.

A summoned place attaches in one of two ways, chosen by the rules from where
the card was played:

1. **A door (default).** Like the human homes off Black pond and BoardyAI's
   parlour. The fixed place card becomes its own key, a small calling card.
   The door shows at the anchor place while that card rests there or is
   carried by someone present (`item_near`, as Boardy's card). The way back
   is always open. A door is not a road, so it never joins two towns.
2. **A room inside a town.** A direct exit from the anchor place and back.
   Allowed only where the anchor is an ordinary town place.

Never allowed as an anchor: a road place, the ship deck, a dock while the
ship is there, a place in a section that is not yet open for that save,
another human's home, or another summoned place (depth one, first version).

Limits per anchor: one summoned door or room per authored place, and at most
three per town. Your own home can hold three doors.

A **new private town behind one road** is possible later: one summoned road
place with its own painting, from your home only, at most one per world. It
waits until doors and rooms have been played.

## Limits, safety and cost

### Limits

| Limit | Value |
| --- | --- |
| Summoned entities per world | 24 (at most 8 places, 8 people, 12 things) |
| Proposals per Unwritten card | 3 |
| Unwritten cards held | 3 per avatar |
| text lengths | `name` 40, `text` 240, `persona` 800, `voice` 400, each `tastes` field 120 characters |
| one entry, canonical JSON | 4 KiB |
| all of `summoned` | 64 KiB (the interpreter limit is 4 MiB per call) |
| art | one image per entity, WebP, at most 1024 px and 300 KiB; 8 MiB per world |
| requests | the card text limits, plus 6 summons per hour per client and 20 per day per world |

### Safety

- **No typed input in the first version.** The proposal is built from the
  writer's facts, the place and the item. A player cannot type a prompt, so
  there is nothing to inject and no real name to paste.
- **Fictional people only.** The prompt says: invent; never name a real
  person, a social handle, a brand or a known character. The validator
  rejects `@handles`, URLs, "inspired by", and names in a short deny list.
  A rejected proposal fails visibly and costs nothing.
- **Real people are authored, never summoned.** BoardyAI is inspired by a
  real account and is authored by the owner in `boardyai.json`. That stays
  an owner decision with a recorded permission. Summoning cannot make one.
- **The same text checks as speech.** The public-safe phrase checks and the
  existing scene validators run on every field.
- **Art prompts come from rules.** The image prompt is built from validated
  fields plus the pack style lock. Adults only. No player text.
- **Sharing re-checks.** Moving summoned content into a shared world runs the
  checks again on the server (see below).

### Cost

- **Text:** about one dialogue request per summon, on the server key, under
  the card text limits (30 a minute, 240 per client an hour, 1,200 an hour
  in total) plus the summon limits.
- **Art:** none paid in the first version. A summoned card shows an **ink
  sketch**: an authored frame and line silhouette per kind, tinted by a hash
  of the id (allowed as designed non-dialogue media). Painting comes later
  on the **player's own OpenRouter credits**, as voices and video do. The
  classic server art path (Replicate, 1 USD a day cap, about 0.05 USD an
  image) is not used.

## Private and shared worlds

**Private first.** Summoning is on in local browser saves. Images stay in
the browser (IndexedDB, keyed by hash). A local backup export includes the
summoned entries and their images.

**When a private world is shared.** "Share this world" already validates
the host save. With summoning it also:

1. re-runs the summoned checks on the server;
2. uploads the images by hash into the generated asset store (its 512 MiB
   budget applies) and checks file type and size;
3. keeps each passing entry exactly; marks any failing entry `faded`.

**What other players see.** A summoned person, thing or place looks and
plays like any other card. Its card keeps the ink-sketch border until it is
painted, so the world shows what was written there without a badge or panel.
Its dialogue in a shared world uses the server key and the shared budgets.

**Summoning inside a shared world** waits for a later step. When it comes:
each human summons only from their own home or the current place; a summoned
thing is never placed in another human's home; the host can fade any entry.

## Linked avatars

Linked NFT avatars live in the classic world: `linked_avatars` sources,
Helius ownership checks, `linked-avatar:<asset>` receipts (#1026, #1027,
#1029). Player selection waits on the ADR that supersedes ADR 0006. The card
table does not mount them yet.

A summoned person belongs to **one world**, with no owner or wallet. A
linked avatar belongs to **an account** and can visit many worlds. Both use
one profile shape, so the `registryFor(world)` overlay can later carry
linked avatars into the card table. A linked avatar can also be a writer:
Unwritten card + your NFT avatar writes someone from its story. A summoned
person never becomes an NFT in the first version.

## Ideas from other games

- **Cultist Simulator:** new cards come from combining cards. Here the
  Unwritten card plus a person, place or item decides what is written.
- **NovelAI lorebook, AI Dungeon world info:** short, capped entries that
  enter the model context only when present. A summoned profile is one.
- **Animal Crossing dream islands:** visitors see your island under the same
  rules. A shared private world keeps its summons, checked once on the way in.
- **Dwarf Fortress legends:** generate, freeze, then read. The builder works
  this way, and could later promote a good summon into a pack.
- **Session zero (lines and veils):** the pack `tone` and the deny list are
  the world's lines.

## Build order

Two tracks. Each step is one PR with its own tests.

**Builder**

1. **Audit checker.** `v2:card:pack:audit`: map rule, reachability, Talk
   coverage, art records, budget. Proves: it passes on every mounted pack and
   fails on hand-made broken fixtures. Useful now for the Greek work.
2. **Story walker.** Headless legal-play search to each story ending, with
   the path written into a test. Proves: Willows and Hoppy Cat endings are
   found from a fresh save.
3. **Recipe and scaffold.** `v2/docs/card-pack-builder.md` (the stages and
   prompts) and `v2:card:pack:new -- <id>` (empty files that pass schema).
   Proves: a scaffold builds and fails audit only for missing content.
4. **Pilot pack.** One small pack (3–4 places, 2 people) built from a brief by
   the recipe. Proves: brief to merged PR with the two owner gates.

**Summoning**

1. **Content seam.** `createRegistry(content)` and `registryFor(world)` with
   an empty overlay. Ships as the next rules version. Proves: no behavior
   change; every released bundle still replays.
2. **Saved data.** The `summoned` field, schema checks, limits, local save
   upgrade, journal commands with fixture text. Proves: hand-written summons
   load, replay from the journal alone, and over-limit saves are rejected.
3. **They can talk.** The Rust text route accepts summoned profiles with
   bounds. Proves: a fixture summoned resident speaks in local and shared play.
4. **The Unwritten card.** The item, the pair plays, faint, fix, ask again
   and fade, with a deterministic test writer. Proves: the whole flow at
   desktop and phone widths, through a reload.
5. **Real writing.** The model writes proposals; validation and safety
   checks; summon rate limits. Proves: a bad answer fails visibly and costs
   no card.
6. **Places.** Doors and rooms under the map rule. Proves: no new road, dock
   or lane; every summoned place has a way back; anchors outside the rules
   are refused.
7. **Sharing.** Re-checks, image upload by hash, faded entries. Proves: a
   private world with summons becomes a shared world that replays the same.
8. **Paint.** The player's OpenRouter image request, size and type checks.

## Tracking (Later)

Folded from the epic [#1362](https://github.com/cenetex/cosyworld/issues/1362)
and its children on 2026-11-01. None of this is active work yet. The epic is
done when every step below is done and the rules validate everything the AI
proposes.

- **Owner approval (#1398).** This design still awaits the owner's review and
  approval, or requested changes. The open questions below are part of it.
- **Builder pipeline (#1399).** Brief → places, connections, items, avatars,
  story → paintings; schema and worldpack checks run; one PR per world pack;
  the owner has taste gates before merge. Needs approval first.
- **Summon through Talk (#1400).** In private worlds only, through Talk or an
  in-fiction item, with no builder menu ("Talk, not buttons"). The AI
  proposes and the rules validate; summoned content is save and journal data,
  and the journal replays to the same result. Needs approval and the content
  seam.
- **Generate characters (#1401).** A player creates a character in a private
  world, validated by the rules and saved. "The most requested feature."
  Needs summoning.
- **Limits and safety (#1402).** Generation has rate limits, safety checks run
  on generated content, and generated content cannot impersonate real people.

## Open questions for the owner

1. **Typed wishes.** Should a player be able to add one short typed line
   (about 120 characters) when they ask? It helps "the character generator"
   feel personal. It also brings prompt injection and real names back.
2. **Name and supply.** Is "Unwritten card" the right name? One in each home
   plus one per story quest: too few or too many?
3. **Summoned people.** Should they travel, take personal quests, or join
   introduction quests? The first version keeps them at home.
4. **Who pays for summon text?** The server key (as dialogue) or the
   player's OpenRouter account (as voices)?
5. **Art default.** Is the ink sketch good enough to ship first, or must a
   summoned card be painted before it counts?
6. **Summoning in shared worlds.** Later, as proposed, or never?
7. **Promotion.** May the builder promote a player's summon into an authored
   pack, with their permission and credit?
8. **Real accounts.** Should BoardyAI's permission be recorded in the pack,
   and is that the rule for any future real-account character?
9. **Content versions.** Should packs move out of the rules bundle so a new
   pack does not need a new rules version?
10. **Attachment.** New worlds from the builder now attach by one road or a
    door, since the ports and lanes are final. Which towns may take a new
    road?
