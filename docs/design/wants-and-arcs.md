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
9. Boxes first: "I mean almost every box should be locked, unlocking a box
   should 'feel' like the primary way until they're all unlocked then you
   find out about desire (we ahve 9 locked boxes now but perhaps we should
   have many more) also the world generator provides an opportunity for
   procedural expansion"
10. Re-locking and visibility: "yes, boxes can re-lock and so on as well -
    think of it as a maze of escape rooms but the locked boxes should be
    visibile right..."
11. RatiRadio's three doors sharing one lock kind: "Vary 2".
12. Whether a box hands over a want: "A locked box tells you its want."
13. Unordered staged wants: "(?)", undecided. The halfway dream: "dreams".
    Homecoming and Pip's lamp as starter wants: "sure".
14. "yes to all four", to these four recommendations: desire is per box,
    and a resident's own desire is a second want learned by Talk after
    their box opens; a box that locks again does not pay XP again (one XP
    per box, once per avatar per world); items are boxes too, as a later
    slice; the start is Vale, the Lamp and the Mirror attic open, with the
    Black pond the first box, opened by putting the lamp out.

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

**What can be a box.** Counts are entries in `packs.json` for the six
mounted packs, plus `forest.json` and `shared-cast.json` for the hub.

| Card kind | Cards | Locked today | Lock it can carry with no rules change |
| --- | --- | --- | --- |
| Place | 93 in packs; 3 hub; 8 homes | 6 (4 sealed ways, 1 guarded, 1 lane) | A route's `requires` plus `sealed` (`pack-schema.mjs:1290-1297`); a guard on the way; a ship lane's `opensWith` and `reason`. Pack crossings (15, 8 gated) and hub routes cannot carry `sealed` |
| Resident | 58 in packs; 3 hub; 8 human | 1 (Raven) | `requires` plus `sealed: { at, reason }` (`pack-schema.mjs:696-703`) |
| Item | 83 in packs; 4 hub | 2 (bread, provisions) | Only `locked: { by, consumes }`: a maker and what she uses. No general item lock exists |

Conditions a lock may use today (`CONDITION_KINDS`, `pack-schema.mjs:63`):
a thing held (`holding`, `held`, `in_hand`); a thing placed (`item_at`,
`item_near`, `grounded`); a person met, talked with or a fact known (`met`,
`talked`, `knows`); trust (`trusted`, used 0 times); a flag or a fork set by
an effect on Give, Meet, Wait, Talk or Hold; time and weather (`daylight`,
`clock`, `weather`); light and sound; a guard, who keeps a schedule and can
be fought or given what he wants (rules 100).

**What is drawn.** A locked card is on the table only where its lock was
written to show (`availableCards`, `cards.mjs:73-89`):

- *Places.* A shut way is drawn only if its route has `sealed` or a guard
  (`sealedWays`, `world/geography.mjs:216-240`), and a shut lane only if it
  has a `reason`. 16 of 23 pack routes are gated; 4 carry `sealed` and 1 is
  guarded. The other 11 gated routes, all 8 gated crossings and the hub's
  mirror are left out of the hand until they open.
- *Residents.* A resident whose `requires` does not hold is drawn only if it
  has `sealed`, and only at its `at` place (`sealedAvatar`, `cards.mjs:31`).
  30 pack residents have `requires`; 1 has `sealed`. The other 29 are left
  out until they appear.
- *Items.* A made thing is drawn locked at its home while used up and its
  maker is active (`lockedAt`, `pack-items.mjs:91`). No other item can be
  drawn locked.

So today most shut things are hidden, not shown locked.

**Locking again.** Three things do it today. A made thing locks when used
up (`pack-items.mjs:82`). A guard bars his way again when he is back at his
post. A route marked `live: true` is open only while its condition holds;
any other gated route latches: once open it stays open for everyone
(`pack-registry.mjs:432-446`). 2 of the 16 gated routes are `live` (the
Theban gate and the Oak's trail). RatiRadio's doors latch, by its contract.

**The hub.** A new world opens with Vale in the Mirror attic holding the
lit Lamp (`forest.json` `opening`). The mirror to the Black pond opens when
the lamp is there and not lit (`reflectionRoutes`); the way back needs it
lit at the pond; the attic as home needs lamp and oil (`homeGates`). Human
homes open with their belonging near (`human-cast.mjs:51`). None of these
is drawn as a locked box.

**The world generator.** `/make` asks the model for text only: a place, an
avatar and an item, each `kind`, `name`, `text`
(`card_authoring_seed.rs:5-22`). Code builds the rest
(`authoring-seed-world.mjs:183-212`): a new place gets plain `exits` both
ways to the entry place, an avatar stands at the entry, an item lies there,
and the first avatar wants the first item. It emits no `routes`, `requires`,
`sealed` or `locked`, so every generated card is open. The prompt tells the
model to prefer "a different relationship or practical use over another
version of a locked door" and not to claim "opened routes"
(`card_authoring_seed.rs:17-20`).

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

### Players: boxes first, desire after

**Almost every card arrives locked, and every locked card is visible.** A
box is a card: a place, a resident or an item. It lies on the table face
down with "Locked", never left out until it can be opened. Visible does not
mean openable yet: a box may wait on something far away or not yet in the
world, and nothing falls back (mystery over reachability). Its want shows
on the context button and descriptor when it is selected, never on the card.

- *Places* lock through the way to them. Every gated route says why
  (`sealed`), so the 11 hidden gated routes become visible boxes. Pack data.
- *Residents* lock with `requires` and `sealed`. The 29 conditional
  residents that show nothing today become visible boxes. Pack data.
- *Items* are boxes too (decided), as a later slice: they need one small
  rules addition, a `sealed` item, lying where it is but shut until its
  conditions hold. Places and residents come first, as pack data.
- *Crossings and hub ways* need `sealed` read there too: rules.
- *Open at the start* (decided): Vale, the Lamp he holds, and the Mirror attic, his
  home. The first box is the Black pond behind the mirror, opened by putting
  the lamp out, which is already the opening's first play. Beyond it Pip,
  the keeper, the Bell and the Empty station can each be a box.

**A maze of escape rooms.** A place is a room. Its boxes interlock: opening
one supplies what another needs. Rooms join through boxes too, so the world
is a maze of them. In existing cards only:

- A room is a place with three to five boxes among its residents, items and
  ways on, and at least one open card to start from.
- Inside a room, each lock names another card of that room or of a room
  already passed: the thing in this box is the thing that one's resident
  wants, or the thing that way needs carried.
- A way on is a box like the others, so leaving a room is one of its
  puzzles, and a later room may need something left behind.
- Thebes is one today: the bread (made) feeds the guard, whose way (guard)
  leads to the shade (time), who opens the Hollow (talk), where the rites
  need three things laid (placed).

**Locking again is normal.** A pack chooses per box whether it latches open
or follows its facts:

| Box | Locks again when | Today |
| --- | --- | --- |
| Made thing | it is used up | yes |
| Way with a held or placed key | the key is carried away | yes, if the route is `live` |
| Guarded way | the guard is back at his post | yes |
| Way or resident on a time | the hour passes | yes, if `live` |
| Trust lock | trust is lost to a grievance | the `trusted` condition already reads grievances |
| Latching way (RatiRadio's doors) | never | yes |

A way the player already passed may shut behind them if it is `live`. That
is the maze, not a fault: a fight, the guard's want or another way round
remains. Personal entry rules stay personal. Decided: a box pays its XP
to each avatar once per world, so opening the same box again pays nothing.
Otherwise eating the bread and having it made again would farm XP.

**A lock is a want.** "A locked box tells you its want." There is one
idea here, not two: what shuts a card is what that card wants, and meeting
it opens the card. So every card holds one want, as residents do: a shut
way wants the beanie carried to it, the bread wants Dione to have water and
wheat, Raven wants three keepsakes laid in the Listening Room.

- *Selecting a locked box tells its want*, on the context button and the
  descriptor, never on the card. Pressing that button takes it up as the
  player's one want, with no turn spent, so the quest card can hold it.
- *Meeting it opens the box*, whoever holds it as a want or nobody. The
  player whose play met it gains one XP and the world records who opened
  it. XP is again simply wants met: a box's, or a person's.
- *What this deletes:* the `gate` play as a quest hand-over; the separate
  `reason` and `quest` on a seal (one want, and its sentence is built from
  it as `lockedQuest` does today); the disabled "Locked" button; and a
  second XP rule for boxes.

**Generated worlds.** The entry place and the first avatar stay open; every
card drawn after arrives locked and visible. Code, not the model, writes
the lock, as it writes the links today: a new place joins by a `routes`
entry with `requires` and `sealed` in place of plain `exits`; a new
resident gets `requires` and `sealed`. Each draw extends a room: its lock
names a card already in that world, and the lock kind rotates by seed, so
the lock can be met from facts in the same world. A room that reaches five
boxes sends the next place draw on as a new room. The prompt stays as it
is: the model still writes no locks.

**Desire after.** Two readings of "until they're all unlocked then you find
out about desire":

1. *Per world.* Wants surface for the player only once every box in the
   world is open.
2. *Per box.* A resident's box, once open, is where you learn that
   resident's desire. Desire arrives box by box.

**The second is decided.** A generated world keeps adding boxes, and boxes
lock again, so "all open" may never come under the first. The second also
fits one want per avatar: each resident's want is found at that resident's
own box. Early play is nearly all boxes; as they open, more of what is in
front of the player is people and what they want.

A resident's card therefore tells two wants, one after the other. Shut, the
box tells its want: what opens the way to that person. Open, the person
tells their own desire in Talk. They are two wants, in that order, and
"finding out about desire" is the second (decided).

So, for a player:

- A sealed resident cannot be talked with; its box tells its want. Once
  open, Talk says the resident's own.
- The player holds one want at a time: a box's, taken up by selecting it,
  or a person's, from a conversation (rules 99). Nothing is drawn.
- Meeting any card's want pays one XP: opening a box, or helping a person,
  whose trust in the helper also rises by one (#1871 owns what they
  remember).
- Homecoming and Pip's lamp stay as starter wants (owner: "sure").
- The one quest card sits where the quest fold sits today.

**XP against today's thresholds.** One XP per want met: a box opened or a
person helped. Level 5 takes 15 XP, level 10 takes 44, level 20 takes 132
(`questXp`).

| Boxes | Count | Reaches |
| --- | --- | --- |
| Locked today | 9 | level 3 (7 XP) |
| Every existing gate shown: 16 routes, 8 crossings, 2 lanes, 1 guard, 30 residents, 2 made things | up to 59 | level 12 |
| Almost every pack card (93 places, 58 residents, 83 items) | about 230 | level 27 |
| Greek alone, all locked | about 140 | level 20 |
| A generated world | 2 for the first draw, then 1 a draw | 7 draws for level 10 to 11 |

Boxes can carry the levels once locking is broad; the nine cannot.

**Lock guardrails.** Many boxes must not become many copies of key and door
([jagged edge](jagged-agi-level-design.md) warns of a station that plays as
"three copies of a key-and-door puzzle").

- Seven lock kinds, each from conditions that exist: a thing held; a thing
  placed; a thing made; a person's trust; something met, heard or seen;
  a guard; a time.
- A validator rule: the boxes shown in one place do not share a lock kind,
  and a way's lock kind differs from the lock on the way that led to it.
  RatiRadio's three carry-it-here doors fail this today; two are varied
  below.
- A lock names things that exist in its world. It need not be reachable now.
- No lock is opened by what a model says. A Talk play may open one: the
  rules commit it at the play. A fight is always a way past a guard.

**RatiRadio, two doors varied** (owner: "Vary 2"). This is my proposal for
the owner to edit. It keeps [the contract](ratiradio.md): the beanie, the
thermos and the figurine are still the three facts, nothing is consumed,
opened ways stay open, Raven still wakes when the glass, figurine and beanie
lie in the Listening Room, and the Request Slip stays optional.

| Door | Today | Proposed want | Lock kind |
| --- | --- | --- | --- |
| Dispatch Window | carry the Red Beanie to it | unchanged | a thing held |
| Listening Room | carry the Thermos to it | the Thermos set down at the Dispatch Window, on the metal plate its line already names | a thing placed (`item_at`) |
| Broadcast Booth | carry the Raven Figurine to it | Talk with RATi while holding the figurine | something heard (an `on: "talk"` effect that needs `holding`) |

Each uses conditions and triggers that exist, so it is pack data. In the
Listening Room the Booth (heard) and Raven (placed) then differ, and no door
repeats the one before it.

My other assumption, an open question below: a held want stays when
another is offered.

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
- **Long-rest dreams stay** (owner: "dreams"). Today the rules make two
  dreams, on a long rest only (`world.mjs:1791`). At halfway to the next
  level the glimpse draws, by seed, one person, item, place or verb the
  avatar already knows (`drawGlimpse`, `glimpse.mjs:46`), and the scene
  gives the model one fact: "In a dream, a glimpse of the quest for level
  N: <name>." (`narrative.mjs:414-418`). The other dream brings the level
  quest (`narrative.mjs:404-412`). The model writes the dream from that
  fact; there are no authored dream lines, and an ordinary long rest dreams
  nothing. With no level quest the second dream goes and the glimpse stays
  as it is drawn, now at home, as a dream of something known and nothing
  more. Its fact line drops "of the quest for level N".
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
(decided); source 1 for residents; source 4, Talk gives a want; source 5
for every box, as the box telling its want; sources 7 and 9 as starter
wants (decided).

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
   want; the player learns it by Talk once that resident's box is open.
3. Every `when` reads a fact that a fixed verb can make true.

With boxes first, an arc is a situation spread over several boxes of one
or two rooms, and each opened resident then says a staged want. Any of
those boxes leads in.

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
residents (Antigone, the guard, the shade), so any of them leads in. The
owner has not decided ("(?)"). The two behaviours, in the burial, once the
guard holds the Writ and before the rites:

- *Ordered.* Antigone always says "I want the oil, the cloth and the shovel
  laid in the Hollow." Her earlier want, to be at the Hollow, is behind her
  for good, even while she still stands at the gate.
- *Unordered.* Both hold while she is at the gate. On one visit she says
  she wants to be at the Hollow; on another, that she wants the three
  things laid there. Which comes is drawn by seed. Bringing her or bringing
  the things each meets a want of hers.

Per the Pact, a symbolic act is a fictional world action, never treatment
or diagnosis.

### The three ethos questions

1. **What can the player do differently?** Open what is shut in front of
   them, by carrying, placing, making, waiting, earning trust or fighting.
   Then learn what the person behind it wants and choose whether to help.
2. **What will the world remember?** Who opened which box; who met whose
   want and the trust that came of it; the public facts an arc turned on (a
   burial, an opened door); a level earned at home.
3. **Why is it more interesting?** Today the hand fills with quests from
   nine sources and the player works the list. With boxes first, the world
   is shut things in plain sight with stated reasons, and people are met by
   opening the way to them. Desire comes as a discovery, not a to-do.

## Migration slices

In order. Rules slices 4–8 mint one rules version together. Alpha saves may
be dropped, and the owner allows the shared worlds on Lonely Forest to be
reset at that bump ("we can reset"), so no upgrade keeps old stacks.
Released journals replay on their frozen bundles. Slices that delete
`want.mjs` code will pass the 400-line budget and need `Large-Change`.

| # | Slice | Kind | Saves | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Nine buttons become `on: "talk"`; drop five archived choices | pack data | keep | No pack choice lacks `on`; Talk with Teucer commits `greek-ajax-hear-plea`; no `choose` play is offered |
| 2 | Vale's home is the attic; each human home rests its own avatar | data | keep | Schema test: every human avatar's home accepts its long rest |
| 3 | Show every lock: `sealed` on the 11 hidden gated routes and the 29 conditional residents; vary two RatiRadio doors | pack data | keep | Each lies in the hand as a locked box that tells its want on the context button |
| 4 | One want: remove the stack and `focus`; no drawn want for players; remove sources 6 and 8 | rules | reset | After 200 turns no avatar has `under`; a player with no want has no quest card |
| 5 | A lock is a want: a box tells it, may be taken up, and meeting it pays one XP and is recorded; helper XP and trust; the `gate` play goes | rules | reset | Vale brings the guard the Writ: the battlefield opens, Vale +1 XP, once. Vale gives the keeper the Bell: +1 XP, keeper's trust +1 |
| 6 | Boxes everywhere: hub ways and crossings drawn as boxes; the lock-kind validator | rules | reset | A new world shows Vale, the Lamp and the attic open and the Black pond locked; putting the lamp out opens it for 1 XP |
| 7 | Level Up is Sleep at home; remove the level quest; keep dreams | rules | reset | At threshold Vale holds Sleep at home; a 12-turn Sleep in the attic raises the level; discarding costs XP |
| 8 | Staged `wants` on residents; remove `choose` from offered plays | rules | reset | No arc field in the save; the same facts give the same want after reload |
| 9 | Lock the hub and the packs as rooms, latch or `live` per box; burial and RatiRadio as staged wants | pack data | keep | The validator passes; carrying a `live` way's key off shuts it again; Antigone's Talk line changes at the Writ |
| 10 | Generated cards arrive locked and visible | authoring code | keep | A second place drawn in `/make` is a locked box whose reason names a card already in that world |
| 11 | One quest card; remove the fan and Focus from the client | client | keep | `npm run check:ui` passes with no new entry; phone and desktop |

Later, as a second rules batch: `sealed` items, so items are boxes too;
resident draws from grievances, knowledge and trust (#1506, #1871). Then
the README quest section is rewritten.

## Open questions for the owner

1. When a player holds a want and a box or a person offers another, does
   the held one stay (the draft's assumption) or does the new one replace
   it?
2. Staged wants: ordered ("first that holds") or unordered (any that hold
   may surface)? The burial example under the Deleuze note shows both.
3. RatiRadio: are the two varied doors right (Thermos set down at the
   Dispatch Window; Talk with RATi while holding the figurine)? The
   proposal is mine.
4. Does the lock-kind rule, and "every lock visible", apply to the hub's
   own ways beyond the Black pond (the mirror back, the lit arch, home
   doors), or only to packs and generated worlds?
