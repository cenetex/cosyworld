# Wants and arcs

Status: draft for the owner to edit, 2026-11-10. Nothing here is built. No
rules, pack or client change ships with this note. Issue:
[#2605](https://github.com/cenetex/cosyworld/issues/2605), under
[#2576](https://github.com/cenetex/cosyworld/issues/2576).

Owner direction, 2026-11-10: remove story choice buttons and quest sources.
One want per avatar. The want for Level Up becomes Sleep at home; the rest is
procedural. Story arcs sit on top, and that part needs design.

Line numbers are for main at `b6b3f646a` (rules `full-card-world/131`). Pack
counts are computed from `v2/card-game/packs.json` with a short Node script
over the six mounted packs in `v2/worlds/card-table.json`.

## Already decided

This draft does not reopen these.

- One want per avatar, XP is wants met, no authored quest chains, trust has
  one source (owner, 2026-10-30). PRs #1449, #1451 and #1700 built the first
  version. The stack came back on 2026-11-01 (#1831,
  [quest stack](quest-stack.md)) and grew: two active player quests
  ([note](two-active-player-quests.md)), Talk gives a quest (#2196, rules
  99), sealed ways give a quest ([rules 95](rules-95-item-cycle-and-sealed-gates.md)).
- Fixed verbs; Talk is the path to desires; effects fire from Talk, Give and
  Use (#1581, still open; [Talk-triggered choices](talk-triggered-choices.md)
  built most of it).
- Level curve and the level quest ([level curve](level-curve.md), rules 90);
  Sleep is a Wait after a Wait ([sleep](sleep.md), #2028); long rest at a
  sanctuary ([rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md), #1648).
- Residents may level only at home (`levelAtHome`,
  [note](resident-level-home.md)).
- "Find <avatar>'s home" earns a world slot with the next character lost
  (#2282, proposal). The hidden avatar and homecoming are built (#1936).
- Polynices' funeral is an owner exception to "no quest chains"
  ([funeral](polynices-funeral.md), #2301). RatiRadio opens through recovered
  possessions ([RatiRadio](ratiradio.md)).
- Remembered help and witness stance belong to #1871; grounded refusals to
  #2539; the truth boundary for speech to #1537; talk-to-reveal to #1848.
- The arc is relationships deepening, not a plot ending. AI characters act
  only by talking. UI goes through the bar, the context button, cards and
  stacks.

## What exists today

### Quest sources

`actor.want` is the top quest and `actor.under` the rest. Players hold two
active quests and more waiting (`QUEST_LIMIT`, `want.mjs:49`); residents hold
three (`want.mjs:50`). Nine places add a quest:

| # | Source | Where | Count in data |
| --- | --- | --- | --- |
| 1 | Authored starter `want` | `installWants`, `want.mjs:510` | 11 of 58 pack residents; Vale, Pip and the keeper (`forest.json:75,86,100`); BoardyAI |
| 2 | Drawn from the world | `nextWant`, `want.mjs:628` | every empty stack |
| 3 | Level quest, on waking | `offerLevelQuest`, `want.mjs:312`, from `wake`, `want.mjs:427` | players only |
| 4 | Talk gives a quest | `talkQuest`, `talk-quest.mjs:74` | any revealed want |
| 5 | Sealed way gives a quest (`gate` play) | offered `world.mjs:1604`, pushed `world.mjs:2987` | 4 routes: the Hollow, and three in RatiRadio |
| 6 | Pack effect `hide_item` | `pack-registry.mjs:830` | 8 choices, RATi's buttons in `lonely-forest` |
| 7 | Homecoming, "Bring <item> home" | `homecoming.mjs:72-91` | one per non-Vale world |
| 8 | Seek, "+ Find <name>" | `seekHidden`, `hidden-avatar.mjs:70-79` | one hidden avatar per world |
| 9 | Pip's landing page | `beginPipJourney`, `pip-landing.mjs:31-36` | `/pip` only |

A quest is offered by being pushed (`pushQuest`, `want.mjs:193`), chosen with
the `focus` play (`world.mjs:2969`), met by a world fact after a play
(`settleWants`, `want.mjs:779`), and paid as one XP and a reward receipt the
player claims (`commitMet`, `want.mjs:808`; `claim`, `world.mjs:2953`). The
quest modules are `want.mjs` (1,146 lines), `quest-card.mjs` (360),
`quest-step.mjs` (129), `glimpse.mjs` (109), `talk-quest.mjs` (107) and
`quest-screen.mjs` (106).

### Story choices

A story choice is an entry in a pack's `choices`: a subject, a place,
`requires`, `effects` and a World line. The six packs hold **188**: Greek 86,
Hoppy Cat 52, Lonely Forest 33, Willows 11, RatiRadio 6, Badger 0.

Only **9** are buttons. A choice with no `on` is offered as a `choose` play
on its subject's card (`packChoices`, `pack-registry.mjs:587`, added to the
legal plays at `world.mjs:1581`): seven Ajax choices in Greek and two
"Hear … on the three walkers" in Lonely Forest. All nine also have a Talk
topic that commits them.

The other **179** already fire from a fixed verb and are never offered as
cards: give 66, meet 40, wait 34, talk 30, hold 8, depart 1
(`choiceFeasible`, `pack-registry.mjs:541`; `packGiveChoice` `:660`;
`packTalkChoice` `:756`). Five Greek choices are `archived` and never fire.
The earlier figure of about 188 story buttons counted every choice. #1581
counted 170 buttons on 2026-10-31; most have moved since.

Their effects: `set_flag` 188, `place_item` 57, `choose` 33 (a named fork,
read by six Greek route gates), `retire_item` 24, `hide_item` 8, `upgrade` 8.

### Level up, Sleep and home

- A player's level rises only through a level quest. With XP at `questXp`
  (3 for level 2, 15 for level 5, 44 for level 10, 636 for level 50), a long
  rest brings the quest (`want.mjs:447-452`). It has `ceil(n / 5)` drawn
  steps, then a rest step at a sanctuary (`restStep`, `want.mjs:384`).
  Dropping it costs XP (`dropCost`, `want.mjs:473`). Halfway there, a long
  rest brings a glimpse (`glimpse.mjs`).
- Residents level on XP alone (`want.mjs:832-837`), except `levelAtHome`
  residents, who level on arriving home (`want.mjs:90`). RATi is the only one.
- Sleep is `wait` with `sleep: true`, offered after a Wait, never aboard, in
  a standoff or beside a guttering lamp (`world.mjs:1202-1235`). A long rest
  is a Sleep of 12 turns or more (`LONG_SLEEP_TURNS`, `world.mjs:1784`) in
  the sanctuary where it began (`wakeUp`, `world.mjs:1788`).
- There are five sanctuaries: Mirror attic (`forest.json:36`), The Hillside
  Sanctuary, Halfway Tea Garden, Cosy Cottage and the Listening Room.
- Home is `homeOf` (`world.mjs:632`). A human avatar's home comes from
  `shared-cast.json` (Vale's is the Empty station). These homes are ordinary
  places, not sanctuaries, so a long rest there does nothing today. 36 of 58
  pack residents set `home`.

### Trust, gates and memory

- Trust is 0–3 per pair. Its one source is giving someone the item they want
  (`trustGiver`, `world.mjs:1726`). It lowers a trade's price and softens a
  gift refusal (`motives.mjs:95,108`), lets an invitation or a shared meal
  be accepted (`world.mjs:1191`, `:589`) and makes a resident step in for a
  friend who is struck (`world.mjs:2751-2754`). No pack gate reads it: the `trusted` condition exists
  (`pack-rules.mjs:138`) and is used 0 times.
- 25 routes and crossings carry `requires` (one is retired). Their
  conditions are mostly flags (15) and an item being somewhere or held (15).
  Six read a `choice`. Four are sealed with a quest.
- Four bounded records hold the past: `memory.mjs` (16 events),
  `knowledge.mjs` (256 facts), `motives.mjs` (6 grievances each) and
  `life.mjs` (16 experiences).

### What the reference content leans on

- **Greek burial.** Already wants and facts, not buttons. Antigone and the
  shade each hold a starter want to have the oil, cloth and shovel laid in
  the Hollow (`step.verb: "lay"`). Three `on: "give"` choices anoint, shroud
  and bury, each gated on the flag before it. The Hollow's route is sealed
  with a quest to talk to the shade. The gate opens while the guard holds
  Creon's Writ. It leans on sources 1, 4 and 5.
- **RatiRadio.** Six `on: "meet"` choices set flags: carry the beanie,
  thermos or figurine to a door, and lay three keepsakes in the Listening
  Room to wake Raven. Three sealed routes give "hold this item" quests
  (source 5). RATi levels at home.
- **Lonely Forest opening.** The first quest waits for the pond
  (`questsBeginAt`, `forest.json:2`). "Stay for tea" is an `on: "talk"`
  choice. RATi hides a button and its finder gets a story quest (source 6).
- **Find home.** Homecoming is source 7. The world slot is #2282, not built.

## The design

### One want per avatar

A want is one record on an avatar: a thing to hold, a place to be, or a
person to see, with at most one of today's shapes (give it to someone, bring
it somewhere, eat it, lay things in a place). `actor.under`, the limits, the
`focus` play and the `story` and `quest` marks go. Nothing waits beneath.

- **Where it comes from.** A resident starts with its pack `want` when it has
  one. Every other want is drawn by the rules, seeded by avatar and turn as
  today, from committed facts only:
  - a thing it values more than what it carries, held nearby or lying loose;
  - a thing an open grievance names (taken from it, or broken);
  - a thing, place or person it has seen or been told of (#1506);
  - a person it trusts who is elsewhere;
  - a place it has not been, or a person it has not talked with;
  - home, after a few wants met away.
  The draw keeps the fact it came from, so the avatar can say why.
- **How the player learns it.** Talk. The person says it in one first-person
  line, with its reason when there is one ("I want the Bell. The keeper took
  it."), as `wantFact` does now (`want-talk.mjs:61`). Nothing is added to the
  player's hand. The player's own want is their one quest card, in the same
  place as today.
- **How it is met.** By a world fact after anyone's play, as now. The want
  records who made that play.
- **What follows.** The avatar gains one XP. If someone else's play met it,
  that helper gains one XP too, and the avatar's trust in them rises by one
  (this widens `trustGiver` from "gave me the item" to "met my want"). The
  avatar is content for a while, then draws the next want from the changed
  world. #1871 owns what a remembered helper says and does later.
- **Dropping.** A player may discard their want at no cost; the next is
  drawn. A resident sets one aside after three refusals, as now.

### Level Up is Sleep at home

- When a player's XP reaches the next level's threshold, their next want is
  **Sleep at home**: the place want with the rest step that exists today,
  aimed at `homeOf`. Thresholds keep today's `questXp` numbers.
- It is met by a long rest at home: a Sleep of 12 turns or more that began
  there. The level rises by one on waking. One level per sleep.
- Home counts as a sanctuary for its own avatar. A non-Vale avatar's home
  door opens only with its belonging near, so finding home comes first.
- The cost is the trip and the time. The world moves on while they sleep.
- Not ready, in the existing places only:
  - Away from home, the quest card reads Go to, as a rest step does now.
  - At home, the context button offers Wait, then Sleep.
  - Where Sleep cannot be offered, the button says why: "Can't sleep during
    a standoff", "Can't sleep aboard", "The lamp is about to go out".
  - Woken early, nothing rises and the want stays.
  - With too little XP there is no such want, and Sleep is plain rest.
- Discarding Sleep at home is free. It returns when the next want is met.
- Residents keep today's rule. `levelAtHome` stays an opt-in.
- The level quest, its drawn steps, the halfway glimpse and the discard cost
  go.

### What is removed

| Removed | Replaced by |
| --- | --- |
| The `choose` play: 9 buttons | Each becomes `on: "talk"` on the same subject. Pack data. |
| 5 archived Greek choices | Nothing. |
| The 179 triggered choices | They stay, as authored effects on fixed verbs. They are not buttons and give no quest. |
| Source 3, level quest | Sleep at home. |
| Source 4, Talk gives a quest | Nothing in the hand. Talk still says the want; meeting it pays the helper. |
| Source 5, sealed way gives a quest | The sealed card and its reason on the context button stay. The `gate` play goes. |
| Source 6, `hide_item` quest | The button is still hidden. RATi's want names it (see arcs). |
| Source 8, Seek | The `seek` play goes. The lost character is the world's story (#2282). |
| The stack, `focus`, two active quests | One want. |
| Sources 1, 2, 7, 9 | Kept. Each is the avatar's one want: starter, drawn, homecoming, or Pip's lamp. |

Content that changes hands:

- **The Hollow.** Its seal keeps its reason, "Speak to Polynices' Shade to
  learn the way into the Hollow." No quest is handed over.
- **RatiRadio's doors.** The three seals keep "Carry the Red Beanie to open
  this passage." and its two siblings. The `meet` effects are unchanged.
- **RATi's buttons.** The eight hide effects stop pushing a quest.
- **Ajax and the walkers.** Nine buttons become Talk effects.
- **Fork effects** (`choose`, 33) and the six route gates that read them
  are out of scope here; #1581 step 8 owns them.

### Story arcs: three options

**A. Stages of world facts.** A resident may carry a short `wants` list.
Each entry has `when` (the existing conditions) and a `want`; the first
entry that holds is that resident's want, and an entry may say "draw one".
Nothing is saved: the stage is read from the world each turn, like
`homeWhen`.

- *Burial.* Antigone: until the guard holds the Writ, "I want to be at
  Polynices' Hollow"; then "I want the oil, the cloth and the shovel laid in
  the Hollow"; after the burial, a drawn want. The guard: bread until he has
  the Writ. The three give effects stay as they are.
- *RatiRadio.* RATi: the beanie until Dispatch opens, the thermos until the
  Listening Room opens, the figurine until the Booth opens, then the three
  keepsakes laid in his room; after Raven wakes, "I want to see Raven".
- *Pack data.* A `wants` list on the avatars that need one.
- *Rules.* One generic read in want selection, and a schema check.
- *The player sees.* What people ask for changes after what was done.
- *How it fails.* It is a chain if authors make it long, and a staged
  resident never wants anything else. One resident, one line of story.

**B. Stages of a bond.** Trust 0–3 with each resident picks from an authored
list: a want, a Talk topic or an opening per tier, using `trusted`.

- *Burial.* Antigone at 0 wants the Hollow reached; at 1 the rites; at 2 she
  tells of her family; at 3 she gives a keepsake.
- *RatiRadio.* The doors stay as they are (the owner's rule is carried
  possessions, not gifts). RATi's tiers colour only the return.
- *Pack data.* A `bond` list per named resident.
- *Rules.* Trust from any want met; tier picks the want.
- *The player sees.* Warmer talk, new topics, sometimes a way opened.
- *How it fails.* Trust is per traveler but a want is one per resident, so
  two travelers pull one Antigone two ways, against One World, One Truth. A
  public deed like a burial is not a private bond. Four tiers end fast.

**C. Chapters of the world.** The world has a level. A pack lists chapters
by world level; reaching one on a level-up sleep sets its facts (a shade
appears, a key turns up), told in the waking dream. "Find home" earning the
next world (#2282) is the chapter between worlds.

- *Burial.* The shade walks only from world level 2; the rites stay facts.
- *RatiRadio.* The Station Key appears at the pond at a world level.
- *Pack data.* A `chapters` list of levels and `set_flag` effects.
- *Rules.* A world level, and effects applied on a level-up sleep.
- *The player sees.* A dream on waking at home; the world's tier colour.
- *How it fails.* Sleeping, not doing, opens the story. A door opens for a
  clock, not a reason. It tangles with pack toggles and shared seats.

**Recommendation: A, kept small.** Both reference levels are already written
this way in data: wants, effects on fixed verbs, and flags. A names that
pattern and needs the least new rule and no new saved state. Its facts are
public, so every traveler sees the same Antigone. Three limits keep it from
becoming a chain, checked by the pack validator:

1. At most three staged wants per resident (the size of the funeral).
2. An arc never gives the player a want. It only changes what residents
   want. The player's want is always drawn, homecoming, or Sleep at home.
3. Every `when` reads a fact that a fixed verb can make true.

B is not the arc; it is the texture under it, and #1871 already owns it. C
stays where it already is: between worlds (#2282), not inside a pack.

### The three ethos questions

1. **What can the player do differently?** Talk to learn what someone wants
   and choose whether to meet it, with no list telling them to. Go home to
   sleep when they have grown. Refuse, and nothing nags.
2. **What will the world remember?** Who met whose want; the trust that
   came of it; the public facts an arc turned on (a burial, an opened door);
   a level earned at home.
3. **Why is it more interesting?** Today the hand fills with quests from
   nine sources, and the player works the list. With one want each,
   what matters is the people and what they ask for now. Level-up gives
   home a purpose it lacks today.

## Migration slices

In order. Rules slices 3–6 mint one rules version together. Alpha saves may
be dropped; released journals replay on their frozen bundles. Slices that
delete `want.mjs` code will pass the 400-line budget and need `Large-Change`.

| # | Slice | Kind | Saves | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Nine buttons become `on: "talk"`; drop five archived choices | pack data | keep | No pack choice lacks `on`; Talk with Teucer commits `greek-ajax-hear-plea`; no `choose` play is offered |
| 2 | Human homes rest their own avatar; residents that need a home get one | data | keep | Schema test: every human avatar's home accepts its long rest |
| 3 | One want: remove the stack, `focus`, sources 4, 5, 6 and 8 | rules | break | After 200 turns of loose play no avatar has `under`; Talk with the keeper says "I want the Bell." and Vale's hand is unchanged |
| 4 | Met-by: helper XP and trust | rules | break | Vale gives the keeper the Bell: keeper `want_met`, Vale +1 XP, keeper's trust in Vale +1 |
| 5 | Level Up is Sleep at home; remove the level quest and glimpse | rules | break | At threshold the want is Sleep at home; a 12-turn Sleep there raises the level; a short Sleep or one elsewhere does not |
| 6 | Staged `wants` on residents; remove `choose` from offered plays | rules | break | No arc field in the save; the same world facts give the same want after reload |
| 7 | Burial, RatiRadio and RATi's buttons as staged wants | pack data | keep | Antigone's Talk line changes at the Writ and after the burial; RATi's changes at each door |
| 8 | One quest card; remove the fan and Focus from the client | client | keep | `npm run check:ui` passes with no new entry; phone and desktop |
| 9 | Draws from grievances, knowledge and trust (#1506, #1871) | rules, later batch | break | The keeper sees Vale take the Bell: his next want is the Bell and Talk gives the reason |
| 10 | Rewrite the README quest section; retire superseded notes | docs | keep | `npm run docs:check` |

## Open questions for the owner

1. Does "story choice buttons" mean the 9 pressed buttons, or all 188
   authored choices? This draft removes the buttons and keeps the 179
   effects that already fire from Talk, Give, Wait, Meet and Hold.
2. Does the player's own avatar keep a want (one quest card), or have none
   and earn XP only by meeting other people's wants?
3. Does a helper earn XP when their play meets someone else's want? The
   draft says one each.
4. Which place is home for Sleep at home? The draft uses the avatar's own
   home (Vale: the Empty station; Cass: the Games pavilion) and lets it rest
   its owner. Or is Vale's home the Mirror attic, where he wakes?
5. Is discarding Sleep at home free? Dropping a level quest costs XP today
   (rules 98).
6. Arcs: is option A right, with at most three staged wants per resident
   and never a want handed to the player?
7. Is the halfway glimpse cut with the level quest, or do long-rest dreams
   stay for something else?
8. At the rules bump, may the shared worlds on Lonely Forest be reset, or
   must the upgrade keep each avatar's top quest?
