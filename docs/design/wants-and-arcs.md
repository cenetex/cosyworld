# Wants and arcs

Status: draft for the owner to edit, 2026-11-10, with the owner's first
answers folded in. Nothing here is built. Issue:
[#2605](https://github.com/cenetex/cosyworld/issues/2605), under
[#2576](https://github.com/cenetex/cosyworld/issues/2576).

Line numbers are for main at `c3bfac77a` (rules `full-card-world/131`). Pack
counts are computed from `v2/card-game/packs.json` with a short Node script
over the six mounted packs in `v2/worlds/card-table.json`.

## Owner decisions, 2026-11-10

1. Buttons: "Only the 9 buttons." The `choose` play goes. The 179 authored
   choices that fire from fixed verbs stay.
2. The player's want: "Players should earn xp by unlocking boxes primarily.
   They should have one 'quest/want' at a time too but they should get them
   from locked boxes or conversations."
3. A helper earns XP when their play meets someone else's want: "sure".
4. Home: "Vale's home is the attic, each avatar has their home."
5. Discarding Sleep at home: "costing xp is what prevents it coming back
   immediately, so keep it."
6. Arcs, option A with the cap of three: "sure", and a question: "does it
   follow the principles of deleuze and jodorowsky?"
7. Dreams: "Keep long rest dreams its charming."
8. Shared worlds on Lonely Forest at the rules bump: "we can reset."

## Already decided earlier

This draft does not reopen these.

- One want per avatar, XP is wants met, no authored quest chains (owner,
  2026-10-30; PRs #1449, #1451, #1700). The stack came back with #1831
  ([quest stack](quest-stack.md)), [two active quests](two-active-player-quests.md),
  Talk gives a quest (#2196) and sealed ways
  ([rules 95](rules-95-item-cycle-and-sealed-gates.md)).
- Fixed verbs; Talk is the path to desires (#1581, open;
  [Talk-triggered choices](talk-triggered-choices.md)).
- [Level curve](level-curve.md), [sleep](sleep.md) (#2028),
  [rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md)
  (#1648), [residents level at home](resident-level-home.md).
- Crafting is a locked thing and its unlock quest
  ([items and crafting](items-and-crafting.md), rules 102).
- "Find <avatar>'s home" earns a world slot (#2282, proposal); the hidden
  avatar and homecoming are built (#1936).
- [Polynices' funeral](polynices-funeral.md) is an owner exception to "no
  quest chains" (#2301). [RatiRadio](ratiradio.md) opens through recovered
  possessions.
- Remembered help belongs to #1871, grounded refusals to #2539, the truth
  boundary for speech to #1537, talk-to-reveal to #1848.
- The arc is relationships deepening. AI characters act only by talking. UI
  goes through the bar, the context button, cards and stacks.

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
| 5 | Sealed way gives a quest (`gate` play) | offered `world.mjs:1615`, pushed `world.mjs:3001` | 4 routes: the Hollow, and three in RatiRadio |
| 6 | Pack effect `hide_item` | `pack-registry.mjs:830` | 8 choices, RATi's buttons in `lonely-forest` |
| 7 | Homecoming, "Bring <item> home" | `homecoming.mjs:72-91` | one per non-Vale world |
| 8 | Seek, "+ Find <name>" | `seekHidden`, `hidden-avatar.mjs:70-79` | one hidden avatar per world |
| 9 | Pip's landing page | `beginPipJourney`, `pip-landing.mjs:31-36` | `/pip` only |

A quest is offered by being pushed (`pushQuest`, `want.mjs:193`), chosen with
the `focus` play (`world.mjs:2983`), met by a world fact after a play
(`settleWants`, `want.mjs:779`), and paid as one XP and a reward receipt the
player claims (`commitMet`, `want.mjs:808`; `claim`, `world.mjs:2967`).

### Story choices

A story choice is an entry in a pack's `choices`: a subject, a place,
`requires`, `effects` and a World line. The six packs hold **188**: Greek 86,
Hoppy Cat 52, Lonely Forest 33, Willows 11, RatiRadio 6, Badger 0.

Only **9** are buttons. A choice with no `on` is offered as a `choose` play
on its subject's card (`packChoices`, `pack-registry.mjs:587`, added to the
legal plays at `world.mjs:1592`): seven Ajax choices in Greek and two
"Hear … on the three walkers" in Lonely Forest. All nine also have a Talk
topic that commits them.

The other **179** already fire from a fixed verb and are never offered as
cards: give 66, meet 40, wait 34, talk 30, hold 8, depart 1
(`choiceFeasible`, `pack-registry.mjs:541`; `packGiveChoice` `:660`;
`packTalkChoice` `:756`). Five Greek choices are `archived` and never fire.

### Locked boxes

A locked box is a card the rules keep shut, drawn face down on the locked
carved back with the label "Locked". It is presentation over rules facts:
`isLockedBox` is "this card has a sealed reason" (`locked-box.mjs:130`,
`sealedReason`, `cards.mjs:176`). Five kinds of fact make one:

| Kind | Where | Today |
| --- | --- | --- |
| Sealed way: a route with `sealed` | `sealedWays`, `world/geography.mjs:216` | 4: the Hollow (Greek); Dispatch Window, Listening Room, Broadcast Booth (RatiRadio) |
| Guarded way | same; `world-life.json:23` | 1: Theban gate to the battlefield |
| Locked made thing: `locked: { by, consumes }` | `lockedAt`, `pack-items.mjs:91` | 2: Dione's bread, Myrto's Travel Provisions (Greek) |
| Sealed resident: `sealed: { at, reason }` | `sealedAvatar`, `cards.mjs:31` | 1: Raven (RatiRadio) |
| Shut ship lane with a `reason` | `shutLanes`, `pack-transport.mjs:150` | 1: Wine-Dark Harbor to Piraeus |

That is **9** in the mounted packs: Greek 5, RatiRadio 4, the other four
packs 0. The hub's own gates (home doors, the mirror) are not counted: they
are not drawn as locked boxes.

- **Selecting one** shows what opens it: its authored reason, or a caption
  built from its conditions (`lockedQuest`, `locked-box.mjs:21`). The
  context button reads "Locked" and is disabled (`app.mjs:2636`).
- **Opening one** happens when its facts hold: the guard has the Writ, a
  flag is set, the maker holds the set (`settleCrafting`,
  `pack-items.mjs:102`). The box turns over once, in this browser.
- **No XP is paid for opening.** XP comes only if the box's quest was taken
  (source 5, four of the nine) and met. Made things lock again when used up.

A *closed* box is only a card this browser has not turned over: "Tap to
open", no rule, no XP (`app.mjs:479-482`).

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
  a standoff or beside a guttering lamp (`world.mjs:1203-1236`). A long rest
  is a Sleep of 12 turns or more (`LONG_SLEEP_TURNS`, `world.mjs:1795`) in
  the sanctuary where it began (`wakeUp`, `world.mjs:1799`).
- There are five sanctuaries: Mirror attic (`forest.json:36`), The Hillside
  Sanctuary, Halfway Tea Garden, Cosy Cottage and the Listening Room.
- Home is `homeOf` (`world.mjs:633`). A human avatar's home comes from
  `shared-cast.json`; Vale's is set to the Empty station there. The seven
  other homes are ordinary places behind a door that needs the avatar's
  belonging, so a long rest there does nothing today. 36 of 58 pack
  residents set `home`.
- Trust is 0–3 per pair. Its one source is giving someone the item they want
  (`trustGiver`, `world.mjs:1737`). It eases trades and gifts
  (`motives.mjs:95,108`), invitations and shared meals (`world.mjs:1192`,
  `:590`), and stepping in for a struck friend (`world.mjs:2766`). No pack
  gate reads it: `trusted` (`pack-rules.mjs:138`) is used 0 times.
- 25 routes and crossings carry `requires` (one is retired): flags 15, an
  item somewhere or held 15, a `choice` 6.

### What the reference content leans on

- **Greek burial.** Already wants and facts. Antigone and the shade hold a
  starter want to have the oil, cloth and shovel laid in the Hollow; three
  `on: "give"` choices anoint, shroud and bury. Three locked boxes: the
  Hollow, the guarded battlefield, the bread.
- **RatiRadio.** Six `on: "meet"` choices set flags. Three doors and Raven
  are its four locked boxes. RATi levels at home.
- **Lonely Forest opening.** The first quest waits for the pond
  (`forest.json:2`). "Stay for tea" is an `on: "talk"` choice. RATi hides a
  button and its finder gets a story quest (source 6). No locked box.
- **Find home.** Homecoming is source 7. The world slot is #2282, not built.

## The design

### Residents: one want each

A want is one record on an avatar: a thing to hold, a place to be, or a
person to see, with at most one of today's shapes (give it to someone, bring
it somewhere, eat it, lay things in a place). `actor.under`, the limits, the
`focus` play and the `story` and `quest` marks go.

- A resident starts with its pack `want` when it has one. Every other want
  is drawn by the rules, seeded by avatar and turn as today, from committed
  facts only: a thing it values, held nearby or lying loose; a thing an open
  grievance names; a thing, place or person it has seen or been told of
  (#1506); a person it trusts who is elsewhere; somewhere it has not been;
  home, after a few wants met away. The draw keeps the fact it came from.
- In Talk it says its want in one first-person line, with the reason when
  there is one ("I want the Bell. The keeper took it."), as `wantFact` does
  now (`want-talk.mjs:61`).
- It is met by a world fact after anyone's play. It gains one XP, is content
  a while, then draws again. It sets a want aside after three refusals.

### Players: boxes and conversations

- **XP comes first from opening locked boxes.** When a player's play makes a
  locked box's facts hold, that player gains XP and the world records who
  opened it. This is new: opening pays nothing today.
- **A helper's point comes second.** When a player's play meets someone
  else's want, the player gains one XP and that person's trust in them rises
  by one. This widens `trustGiver` from "gave me the item" to "met my want".
  #1871 owns what a remembered helper says and does later.
- **One want at a time, from two places.** From a locked box: select it and
  take its quest, the `gate` play that four boxes have today, extended to
  all of them from the caption they already show. From a conversation: Talk
  that reveals a person's want gives the matching want (give it to them,
  bring them there, bring them to that person), as rules 99 does now.
- **Nothing is drawn for a player.** A player with no want has no quest
  card until a box or a person gives one.

My assumptions where the owner's sentence leaves a gap (each is an open
question below). The one quest card sits where the quest fold sits today.

- *A want already held stays.* A second box or Talk does not replace it. The
  box still shows what opens it and the person still says what they want.
  The player discards first (free, as today) to take another.
- *One XP per act.* A box opening pays one. A helper's point pays one. A
  player's want being met pays nothing more by itself: a box want is paid by
  the box opening and a conversation want by the helper's point.
- *A box pays each avatar once per world*, so bread that locks again cannot
  be farmed. A *closed* box (not yet turned over) pays nothing.
- *Starter wants stay*: homecoming in a non-Vale world, and Pip's lamp on
  `/pip` (which already comes from a Talk).

A finding to weigh: there are 9 locked boxes today, in two packs, and level
5 takes 15 XP. Boxes cannot be the main source of XP until packs hold more
(sealed ways, made things, sealed residents). That is pack data, not rules.

### Level Up is Sleep at home

- Each avatar has its home. Vale's is the Mirror attic (a data change: his
  `shared-cast.json` home names the Empty station today). The others keep
  theirs: Paper theatre, Sunken belfry, Wild glasshouse, Wind hill,
  Between-hours carriage, Games pavilion, Sail loft.
- Home rests its own avatar as a sanctuary does. A non-Vale home's door
  needs its belonging, so finding home comes first.
- When a player's XP reaches the next level's threshold, they hold **Sleep
  at home**: the place want with the rest step that exists today, aimed at
  `homeOf`. It is the one want the rules give a player unasked. A player
  holding another want gets it when that one ends.
- It is met by a long rest at home: a Sleep of 12 turns or more that began
  there. The level rises by one on waking. One level per sleep.
- **Discarding it costs XP**, as dropping a level quest does now
  (`dropCost`, `want.mjs:473`). That takes the player back under the
  threshold, which is what stops it returning at once.
- **Long-rest dreams stay.** The halfway glimpse still comes on a long rest
  at home. Today it fixes one aspect of the level quest's first step
  (`glimpse.mjs`); with no level quest, what it shows is an open question.
- Not ready, in the existing places only: away from home the quest card
  reads Go to; at home the context button offers Wait, then Sleep; where
  Sleep cannot be offered the button says why ("Can't sleep during a
  standoff", "Can't sleep aboard", "The lamp is about to go out"). Woken
  early, nothing rises and the want stays.
- Residents keep today's rule. `levelAtHome` stays an opt-in.
- The level quest and its drawn steps go.

### What is removed

| Removed | Replaced by |
| --- | --- |
| The `choose` play: 9 buttons (decided) | Each becomes `on: "talk"` on the same subject. Pack data. |
| 5 archived Greek choices | Nothing. |
| Source 2 for players, the drawn want | Boxes and conversations. Residents keep the draw. |
| Source 3, level quest | Sleep at home. |
| Source 6, `hide_item` quest | The button is still hidden. RATi's want names it; Talk gives it. |
| Source 8, Seek | The `seek` play goes. Nothing replaces it here; #1848 proposes learning of a hidden person by Talk. |
| The stack, `focus`, two active quests | One want. |

Kept: the 179 triggered choices, as authored effects on fixed verbs
(decided); source 1 for residents; source 4, Talk gives a want; source 5,
a box gives a want; sources 7 and 9 as starter wants.

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
- *Needs.* A `wants` list in pack data; one generic read in want selection
  and a schema check in the rules. The player sees what people ask for
  change after what was done.
- *How it fails.* It is a chain if authors make it long, and a staged
  resident never wants anything else. One resident, one line of story.

**B. Stages of a bond** (not chosen). Trust 0–3 with each resident picks an
authored want, Talk topic or opening per tier, using `trusted`. Antigone
would move from the Hollow to the rites to her family's story. It fails
because trust is per traveler but a want is one per resident, so two
travelers pull one Antigone two ways, against One World, One Truth; a
burial is a public deed, not a private bond; and four tiers end fast.

**C. Chapters of the world** (not chosen). A pack lists facts set at world
levels, applied on a level-up sleep and told in the waking dream: the shade
walks from world level 2, the Station Key turns up at another. It fails
because sleeping, not doing, opens the story: a door opens for a clock, not
a reason. It also tangles with pack toggles and shared seats.

**Chosen: A, kept small** (owner: "sure"). Both reference levels are already
written this way in data: wants, effects on fixed verbs, and flags. A names
that pattern and needs the least new rule and no new saved state. Its facts
are public, so every traveler sees the same Antigone. Three limits, checked
by the pack validator:

1. At most three staged wants per resident (the size of the funeral).
2. An arc never puts a want in the player's hand. It changes what residents
   want; the player takes that up by Talk, or takes a box's.
3. Every `when` reads a fact that a fixed verb can make true.

B is the texture under it, and #1871 owns it. C stays between worlds (#2282).

### Does A follow Deleuze and Jodorowsky?

An interpretation for the owner to correct.

The repo has one statement, in
[dynamic characters](dynamic-characters.md#deleuze-guattari-and-barthes-as-design-prompts),
marked there as "our design interpretations": "connections among different
kinds of things and many possible points of entry", so that "Meeting any of
them can lead into the situation", and "A reward can create another useful
connection". It has no text on Jodorowsky; that part uses the commonly
cited ideas.

Where A fits. No plot stands outside the world: a staged want is read fresh
from present facts and nothing is saved. A want is met by a concrete act
with a real effect, never by speech. Talk reads what a person wants now, as
a tarot reading describes the present and predicts nothing.

Where it does not. "The first entry that holds" is an ordered line: a tree
with one way in, on one resident. A cap of three makes it short, not
many-entried.

One adjustment, no new system: make the list unordered. Any staged want
whose `when` holds may surface, and a situation's wants may sit on several
residents (Antigone, the guard, the shade), so any of them leads in.

Per the Pact, a symbolic act is a fictional world action, never treatment
or diagnosis.

### The three ethos questions

1. **What can the player do differently?** Choose their one want, from a
   box in front of them or from what someone says, and drop it freely. Go
   home to sleep when they have grown. Refuse, and nothing nags.
2. **What will the world remember?** Who opened which box; who met whose
   want and the trust that came of it; the public facts an arc turned on (a
   burial, an opened door); a level earned at home.
3. **Why is it more interesting?** Today the hand fills with quests from
   nine sources and the player works the list. With one want, taken on
   purpose, what matters is the shut thing in front of them and the people
   near it. Level-up gives home a purpose.

## Migration slices

In order. Rules slices 3–6 mint one rules version together. Alpha saves may
be dropped, and the owner allows the shared worlds on Lonely Forest to be
reset at that bump ("we can reset"), so no upgrade keeps old stacks.
Released journals replay on their frozen bundles. Slices that delete
`want.mjs` code will pass the 400-line budget and need `Large-Change`.

| # | Slice | Kind | Saves | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Nine buttons become `on: "talk"`; drop five archived choices | pack data | keep | No pack choice lacks `on`; Talk with Teucer commits `greek-ajax-hear-plea`; no `choose` play is offered |
| 2 | Vale's home is the attic; each human home rests its own avatar | data | keep | Schema test: every human avatar's home accepts its long rest |
| 3 | One want: remove the stack and `focus`; no drawn want for players; remove sources 6 and 8 | rules | reset | After 200 turns no avatar has `under`; a player with no want has no quest card; Talk with the keeper gives "give the Bell" only when none is held |
| 4 | Box opening pays XP; every box gives its want; helper XP and trust | rules | reset | Vale brings the guard the Writ: the battlefield opens, Vale +1 XP, once. Vale gives the keeper the Bell: Vale +1 XP, keeper's trust in Vale +1 |
| 5 | Level Up is Sleep at home; remove the level quest; keep dreams | rules | reset | At threshold Vale holds Sleep at home; a 12-turn Sleep in the attic raises the level; discarding it costs XP and it does not return at once |
| 6 | Staged `wants` on residents; remove `choose` from offered plays | rules | reset | No arc field in the save; the same world facts give the same want after reload |
| 7 | Burial, RatiRadio and RATi's buttons as staged wants; more boxes | pack data | keep | Antigone's Talk line changes at the Writ and after the burial; RATi's changes at each door |
| 8 | One quest card; remove the fan and Focus from the client | client | keep | `npm run check:ui` passes with no new entry; phone and desktop |

Later: resident draws from grievances, knowledge and trust (#1506, #1871),
as a second rules batch; then the README quest section is rewritten.

## Open questions for the owner

1. Which boxes pay XP? The draft pays for the 9 locked boxes (Greek 5,
   RatiRadio 4), once per avatar per world, and nothing for a closed box
   that is only turned over. Should a box that locks again (the bread) pay
   again, and where should more boxes come from?
2. When a player holds a want and a box or a person offers another, does
   the held one stay (the draft) or does the new one replace it?
3. Is it one XP per act (a box opened, a want met for someone), with no
   extra point when the player's own want is met, or should a box pay more?
4. Do the two starter wants stay: homecoming in a non-Vale world, and Pip's
   lamp on `/pip`? Homecoming comes from neither a box nor a conversation.
5. Arcs: should a resident's staged wants be unordered, any that hold may
   surface, as the Deleuze note suggests, or stay "first that holds"?
6. With no level quest, what does the halfway dream show? The draft leaves
   the glimpse as drawn today.
