# Making the Willows creepier

Status: design. Active work items are filed as issues that link here.

The Willows pack (`v2/content/willows/`) adapts Blackwood's 1907 story, but
the current content reads as a careful camping trip with a sad discovery. This
page sets out how to bring back the story's dread without breaking the project
rules: generic rules and generators, one want per avatar, Talk as the path to
desires, mystery over reachability, short prompts for small local models, and
rules that own every outcome while the model only voices committed events.

## Principle

Never name the thing. The rules emit small, concrete anomaly events: a thing
missing, a thing extra, a distance shorter than before, a sound from the wrong
side. The model voices those events and nothing else.

Dread comes from three sources:

- the familiar going slightly wrong (a clean gap in a food sack);
- threats heard, never seen in full;
- the Swede's calm, which is right about every fact and wrong about the
  situation (the register of *The Wicker Man*).

Mark Fisher's "eerie" is the working test: something where there should be
nothing, or nothing where there should be something. This matches
[canon](../canon.md) rule 4 (precision is the dread instrument) and rule 6
(horror is a descent, never an ambush).

## Book motifs against current content

Quotes are from `v2/content/willows/source-text.txt`.

### Already present

| Motif | Where now |
| --- | --- |
| Slit hull, paddle scraped thin | `willows-examine-hull` at the landing |
| Counting stores, missing bread ("It's gone. There is no bread. They've taken it!") | `willows-count-stores` at the camp |
| Supper as reason against knowing | `willows-supper` topic and situation |
| Sand hollows | `willows-examine-hollows` in the thicket |
| Humming, drowned man with matching hollows | `willows-hear-humming`, `willows-look-beneath-roots` at the bank |
| "It's _their_ sound" | `willows-understanding-text` reading |
| The Swede with his map | `willows-map`, `willows-channels` |
| No careless noise | `willows-muffled-bell` situation |

The bank discoveries form a fixed chain: hollows, then humming, then the
corpse (each `requires` the previous flag). The chain makes the bank a
checklist instead of a place that might show you something.

### Missing

- **The shrinking island.** "The island's much smaller than when we landed,"
  said the accurate Swede.
- **The willows moving nearer.** The narrator paces the distance: "I paced out
  on the warm sand the distances between the willows and the tent", and later
  "_They had moved nearer._"
- **The otter.** It "had looked exactly like the body of a d[rowned man]" and
  "had such extraordinary yellow eyes."
- **The boatman.** "He's crossing himself! … Look, he's making the sign of the
  Cross!"
- **The shapes over the willows.** "They were nude, fluid shapes, passing up
  the bushes, _within_ the leaves almost—rising up in a living column into the
  heavens. Their faces I never could see."
- **Patterings and weight on the tent.** "Outside there was a sound of
  multitudinous little patterings" and "a great weight upon the surface of my
  body."
- **Keeping minds quiet.** "Do not refer to them _by name_. To name is to
  reveal; it is the inevitable clue, and our only hope lies in ignoring them,
  in order that they may ignore us." When the narrator shouts "You
  superstitious idolater! You—", the Swede hears "the strange cry overhead".
- **The Swede's arc.** The narrator thinks him "devoid of imagination" and
  "accurate". In the book the narrator does the explaining away ("that otter
  _was_ an otter, so don't let's play the fool about it!"); the game gives
  that role to the Swede first, since he is the only voice. Then he listens,
  then he turns: "You _fool!_ … you utter fool. That's just the way all
  victims talk." At the end he struggles toward the river, "going _inside_ to
  Them".
- **The climax.** "My life, old man—it's my life I owe you. But it's all over
  now anyhow. They've found a victim in our place!"

### Flat or cosy now

- Swede `voice`: "the steady warmth of a trusted travelling companion".
- Thicket `persona`: "Keep the powers beyond the island distant and strange";
  the willows never speak as a crowd.
- Nothing changes over time apart from the day and night paintings.
- The ending is chores: lay out the sheet, rope and paddle, then
  `willows-choose-departure`.
- No room music and no weather region.
- The night landing (`landing-ship-night.webp`) shows the warm lanterns of
  the Greek ship.
- Item prompts in `art-prompts.json` stress a "much-handled, modest practical"
  possession.
- Bank `persona` ends with meta text: "The four authored places remain the
  paths the traveller can choose."

## Changes

### Tier 1: content and presentation, low rule risk

1. **Rewrite the Swede.** Short lines for small models. Before
   `willows-signs-shared` he explains everything (wind, otters, stones).
   After, he whispers, never names them, and says "Hush" when they are named.
   His schema want stays one of the four kinds (`place: willows-landing`,
   getting the companion home); `tastes.reason` and `voice` carry "keep the
   minds quiet". Tone word: being noticed. Few-shot lines:
   - "Wind in the reeds. Only — the reeds are not moving. Wind, then."
   - "We should sleep. I will mend the paddle in the morning." (said before
     the player has found the paddle missing)
   - "The island is smaller tonight. The river takes sand. It takes. That is
     all rivers do."
   - "Count the willows if it helps you. I counted them at supper and there
     were —"
2. **The willows move closer.** A camp choice paces the distance from tent to
   willows and records a number. A later "pace it again" records an exact
   shorter number. The thicket persona becomes a plural "we" that chatters,
   leans and counts. Delete the bank meta line.
3. **Unchain the discoveries and add the missing ones.** Humming and the
   corpse stop requiring earlier flags. New standalone choices, each with its
   reading: the otter and the boatman (landing), patterings on the tent (camp,
   night), shapes over the willow tops (thicket, night). Some may stay hard to
   find; that is fine.
4. **Presentation.** In flight on `claude/prep-halloween-transitions`: a
   Halloween-only uncanny flicker on the Swede, a day/night crossfade and
   weather transitions. The night-and-mist arrival is #1484
   (`claude/prep-willows-night-mist`), with a separate rework of the Willows
   gate to follow.

### Tier 2: needs code or assets

5. **The hum.** A diegetic drone: two WebAudio oscillators between 55 and
   110 Hz, detuned by 1 to 3 Hz, plus a harmonic above 200 Hz so phone
   speakers carry it, under a slow LFO. Intensity follows rule state (turns
   near the willows, river height). Before a reveal, fade to silence over
   300 ms. Start only after a user gesture, with its own volume control. The
   alternative is an owner-supplied gong or drone in `roomTracks` in
   `v2/card-game/music.mjs`, with a `PROVENANCE.md` entry.
6. **"Did that move?"** Swap backdrop layers only during card flips or scene
   changes. Willow silhouettes at the frame edges drift through 20 to 60 s
   transforms. The vignette tightens as the river rises. Grade colour through
   CSS custom properties over 4 to 10 s.
7. **Art.** Night variants for the thicket and bank (a faint bronze column in
   the willow tops, foot-sized funnels in the sand); an unlit camp after the
   watch; a night landing with no ship; a frightened Swede pose. The pose needs
   avatar variants beyond `asleep`, `awake` and `irritated`
   (`VARIANTS` in `v2/card-game/pack-schema.mjs`).
8. **A leak slot for the Swede.** For each line the rules pass at most one
   leak they chose: `repeats_last_word`, `knows_unseen:<fact>` or
   `breaks_off`. Most turns pass none. Code performs the truncation. A post
   filter rejects monster words (creature, demon, entity, monster, evil,
   eldritch, ghost), more than one leak, or lines over about 20 words. This is
   untested on gemma and llama-8b; test before relying on it.

### Tier 3: rules work

These change shared rules, so they need a shared-rules version bump and must
keep the released replay bundles.

9. **The watch as the descent.** Keep `depart` as the safe surface. Move the
   corpse discovery behind `willows-response=watch`. The watch ends with the
   Swede at the river's edge and "it's my life I owe you". This follows canon
   rule 6: every step down is chosen.
10. **Naming and noise as rule state.** A rung bell or a shouted name sets a
    flag that brings the humming overhead. The Swede reacts to the recorded
    fact, not to the model's guess.
11. **The shrinking island.** The flood level advances with the world clock
    and appears as a narrator fact: "The island has lost 4 paces since
    landing."
12. **Pressure from card horror,** adapted to generic rules with no scripted
    thresholds:
    - visible countdowns that turn unease into dread (*Cultist Simulator*);
    - the island as an unseen player whose face-down hand grows each night
      (*Inscryption*);
    - the Swede's description as the only window on the far bank
      (*Iron Lung*);
    - the Swede denying an event the journal recorded (*Slay the Princess*);
    - display-only glitches in labels and the log at high dread
      (*Eternal Darkness*). The journal itself never changes.

## Accessibility

These are hard rules for every presentation change:

- WCAG 2.3.1: no more than three flashes per second. No saturated red
  flashes. Keep flash areas small and low in contrast.
- No high-contrast stripes or checkers (the Harding test).
- `prefers-reduced-motion` disables flicker, jitter and sway. Colour fades
  and audio may remain.
- A "flashes and scares" toggle, a background-motion toggle, and a one-time
  content warning on entering the pack.

## Validation

Rule changes run `test/card-willows.test.mjs`,
`v2/orchestrator-rust/src/card_shared/willows_tests.rs` and
`v2/scripts/smoke-card-willows.mjs`, then rebuild the shared engine and the
pack. During alpha, old saves may break.
