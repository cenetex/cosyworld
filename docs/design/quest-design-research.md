# Research: quest design for the card table

Date: October 28, 2026. Status: research and proposals. No code changes.

This note applies old-school (OSR) play, systemic game design, cosy games and
LLM-character research to the three quest kinds in the shipping card table
(`v2/card-game/`). It ends with a rumor and knowledge design for the Talk path.

Two owner rules bind every proposal here:

1. **Talk only.** No new quest buttons, panels or logs. Quest information
   reaches the player through the characters' speech in the existing Talk play,
   and through the cards and choices that already exist.
2. **Cards choose things; the world chooses the verb.** The rules own legality,
   progress and rewards. The AI never decides what is possible, what is true or
   what is earned. It only voices facts that the rules hand it.

Line numbers refer to commit `0ab11ecd` on `main`.

---

## (a) Principles, with sources

Each principle has a one-line meaning for CosyWorld. Quotes are short and come
from the linked source. Paraphrase is marked as such.

| # | Principle | Source | What it means here |
|---|---|---|---|
| P1 | **Rulings, not rules.** The referee judges from the fiction; a written rule is a tool, not a cage. | Matt Finch, *A Quick Primer for Old School Gaming* (2008), "First Zen Moment". | The rules engine is our referee. It must be able to rule on many verbs with a few general checks (custody, place, company, knowledge), not a special rule per quest. |
| P2 | **Player skill, not character abilities.** Success comes from what the player notices, asks and tries. | Finch, "Second Zen Moment". | A quest should be solvable by asking the right person the right thing, not by a level number. |
| P3 | **Information is the core resource.** McDowall: "Players cannot make a proper choice unless they have enough information!" | Chris McDowall, [The ICI Doctrine: Information, Choice, Impact](https://www.bastionland.com/2018/09/the-ici-doctrine-information-choice.html) (2018). | Every quest step must be learnable through Talk before the player has to act on it. |
| P4 | **Real choice.** "For there to be a proper Choice, there have to be multiple actions the players can choose between." | Same post. | A step with one possible card is a chore, not a choice. Two endings with real trade-offs beat one. |
| P5 | **Impact.** "Everything you do matters." | Same post. | A finished quest must change something other people can see and talk about. |
| P6 | **Three Clue Rule.** "For any conclusion you want the PCs to make, include at least three clues." Corollaries: proactive clues (something happens when players stall) and permissive clue-finding (reward a good idea you did not plan). | Justin Alexander, [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule) (2008). | Every required fact needs at least three independent sources: a person, a place or thing, and an event or rumor. |
| P7 | **Prep situations, not plots.** "A plot is the sequence of events in a story." Prep what happens if the players do nothing. | Alexander, [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots) (2009). | A quest is a situation in the world (a need, a holder, a place, a pressure). It should not be a fixed list of hands. |
| P8 | **Node-based design.** Clues point to nodes (people, places, events); any three clues lead somewhere. | Alexander, [Running Mysteries: the two types of leads](https://thealexandrian.net/wordpress/50095/roleplaying-games/running-mysteries-the-two-types-of-leads) and the Three Clue Rule follow-ups. | A quest's facts should point at people and places, not at the answer. |
| P9 | **Procedures make the world tick.** Hexcrawl and pointcrawl play runs on a repeated procedure: move, check, encounter, discover. | Alexander, [Hexcrawl series](https://thealexandrian.net/?p=36844) (2012) and [5E Hexcrawl](https://thealexandrian.net/wordpress/46020/roleplaying-games/5e-hexcrawl). | Our turn loop is the procedure. Quest pressure should ride on it, not on special timers. |
| P10 | **The overloaded encounter die.** One roll per turn yields an encounter, a sign of a monster, a local event, fatigue, or light running out. | Necropraxis, [Overloading the encounter die](https://www.necropraxis.com/2014/02/03/overloading-the-encounter-die/) (2014). | One deterministic "world beat" per round can carry signs, omens and resource drain at once. |
| P11 | **Reaction rolls.** The other side's attitude is not fixed; a 2d6 roll plus situation sets it. | B/X *D&D* (1981) reaction table; see [Black Citadel on reaction rolls](https://blackcitadelrpg.com/reaction-rolls-5e/). | Residents already have trust and grievances. Their willingness to share a fact should come from those numbers, and Talk should voice it. |
| P12 | **Rumor tables and paid information.** Rumors are a reward; some are false; a bard can sell them, and their truth can depend on price. | Arnold K, [Bardic Services](https://goblinpunch.blogspot.com/2016/01/bardic-services.html), Goblin Punch (2016). | Our Bard already follows completed deeds. He should be the place where news of them can be heard. |
| P13 | **Myths and omens.** Each Myth reveals itself through six ordered Omens met in the wilderness; player actions come first, and Omens bend to them. | Chris McDowall, [Mythic Bastionland](https://chrismcdee.itch.io/mythic-bastionland) (2025); review notes in [Exploration in Mythic Bastionland](https://nat7.bearblog.dev/exploration-in-mythic-bastionland/). | An authored story quest can advance its *signs* while the player is away, as a slow, ordered drip of facts. |
| P14 | **Depth crawls.** Location tables change with how far you are from the start. | Emmy Allen, *The Gardens of Ynn* (2017); [interview](https://thefandomentals.com/gardens-of-ynn-ttrpg-emily-allen-interview). | Generated situations can scale by distance from home instead of by level. |
| P15 | **OSR axioms as principles.** A set of GM and player principles in the style of *Apocalypse World*. | Ben Milton, Steven Lumpkin and David Perry, [Principia Apocrypha](https://lithyscaphe.blogspot.com/p/principia-apocrypha.html) (2018). | Use principles to guide the LLM's voice, and procedures to guide the engine. |
| P16 | **Clocks.** Progress clocks are segmented circles for effort against an obstacle or a coming threat. | John Harper, *Blades in the Dark*; [Roll20 compendium entry](https://roll20.net/compendium/BITD/Progress%20clocks). | Many resources are already clocks (lamp fuel, oil doses, rest turns). Talk should name them as stakes, not numbers. |
| P17 | **Fronts.** Linked threats with ordered portents that advance when the players do not act. | Vincent Baker, *Apocalypse World*; see [The Daily Apocalypse on threat countdowns](https://daily-apocalypse.com/daily-apocalypse/85-threat-countdown-clocks). | A cosy "front" is a need that gets a little worse, then speaks up. |
| P18 | **Dungeon sign and tell.** Good dungeons show evidence before danger; exploration rewards reading the place. | Gus L, *Dungeon of Signs* and *All Dead Generations* blogs; see review of [Tomb Robbers of the Crystal Frontier](https://gorgonbones.bearblog.dev/review-tomb-robbers-of-the-crystal-frontier-by-gus-l/). The in-repo [DM guide](../dm-guide/chapters/06-obstacles-and-pressure.md) states the same as Lead, Gate, Hazard, Pressure. | Each quest gate should have a visible, sayable sign. |
| P19 | **Storylets and salience.** Small content pieces unlocked by qualities; the system or player picks the most fitting one now. | Emily Short, [Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) (2016) and [Storylets: You Want Them](https://emshort.blog/2019/11/29/storylets-you-want-them/) (2019). | Our `storyQuests` plus `topics` are already storylets. Talk should pick the most salient fact for this listener, here, now. |
| P20 | **The simulation dream, and its trap.** Rich simulation only matters when players can see and read it. | Tynan Sylvester, [The Simulation Dream](https://gamedeveloper.com/design/the-simulation-dream) (2013). | Hidden quest state that no character can mention is wasted. |
| P21 | **Storytellers pace events.** RimWorld's storyteller presets choose when and how hard events land. | [RimWorld](https://en.wikipedia.org/wiki/RimWorld); [RimWorld wiki](https://rimworldwiki.com/wiki/About_RimWorld). | A cosy storyteller should space quest beats and rest, not raise danger. We already have rest and stall turns. |
| P22 | **Generate events, explain after.** Caves of Qud generates historical events, then rationalizes causes. | Jason Grinblat, [Procedurally Generating History in Caves of Qud](https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves) (GDC 2018). | A generated quest can borrow its reason from a real logged event ("since Pip gave you the cloth"). We already do this with sparks. |
| P23 | **Attachment to generated heroes.** Wildermyth binds procedural events to named characters and lasting changes. | Nate Austin, [GDC 2022 Indie Summit session](https://gdcvault.com/play/1027614/Independent-Games-Summit-Session-Getting); [Wildermyth](https://en.wikipedia.org/wiki/Wildermyth). | A quest should leave a mark on the avatar (a kept item, a changed hope line) that later Talk refers to. |
| P24 | **No right answer; consequences surface later.** Pentiment's director wanted a story where the killer is never certain. | [Shacknews interview with Josh Sawyer](https://www.shacknews.com/article/146276/pentiment-josh-sawyer-no-correct-answer). | Story endings should be plural and judged by the town over time, through what people say. |
| P25 | **Inner voices and passive checks.** Disco Elysium's skills speak up unbidden when the character notices something. | [Disco Elysium](https://en.wikipedia.org/wiki/Disco_Elysium); [Kotaku on its dialogue](https://kotaku.com/disco-elysium-lets-you-choose-your-characters-dialogue-1839144864). | A companion can "notice" a quest-relevant fact and say it during any Talk, with no new button. |
| P26 | **Schedules make a world legible.** Ultima V's residents keep daily routines. | [Ultima V](https://en.wikipedia.org/wiki/Ultima_V:_Warriors_of_Destiny); [Lycaeum: NPC schedules](https://lycaeum.ultimacodex.com/npc-schedules/). | "Where will Pip be?" is a fair question only if the answer is stable and sayable. |
| P27 | **Cosy requests.** Animal Crossing villagers ask small favours; Spiritfarer's spirits have personal wishes tied to care. A Short Hike guides with talk and landmarks, not waypoints. | [Spiritfarer interview, Pocket Tactics](https://www.pockettactics.com/spiritfarer/interview); [A Short Hike GDC postmortem](https://gdcvault.com/play/1026613/Independent-Games-Summit-Crafting-A); [PlayStation Blog on A Short Hike](https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/). | Requests come from a person's care for a place or another person. Guidance is a person saying where to look. |
| P28 | **Fallible but honest knowledge.** Characters observe, tell, misremember and lie, inside a simulation that knows the truth. | Ryan, Summerville, Mateas, Wardrip-Fruin, [Toward Characters Who Observe, Tell, Misremember, and Lie](https://ojs.aaai.org/index.php/AIIDE/article/view/12825) (AIIDE 2015). | Misleading must come from the engine (old news, partial witness), never from the LLM making things up. |
| P29 | **Memory retrieval by recency, importance, relevance.** | Park et al., [Generative Agents](https://arxiv.org/abs/2304.03442) (2023). | Choose which facts reach a speaker by a scored, deterministic rule, with quest relevance as a strong weight. |
| P30 | **LLMs drift on state; a symbolic check helps.** GPT-3 alone failed to keep stories consistent; a small world model rejected over half of its sentences. GPT-4 is still unreliable as a text world simulator. | Nye et al., [Dual-System, Neuro-Symbolic Reasoning](https://arxiv.org/abs/2107.02794) (2021); Wang et al., [Can Language Models Serve as Text-Based World Simulators?](https://arxiv.org/abs/2406.06485) (ACL 2024). | Keep all state in rules. Validate speech against the packet. CosyWorld already does this for disclosures (`factDelivered`). |
| P31 | **LLMs help a DM best with bounded material.** DMs used generated text as a draft inside their own world. | Zhu et al., [CALYPSO](https://arxiv.org/abs/2308.07540) (AIIDE 2023). | The model should phrase supplied facts, not plan the quest. |
| P32 | **Social simulation with explicit knowledge.** Versu's characters act from shared social practices and their own state. | Evans and Short, [Versu](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf) (IEEE TCIAIG 2014). | Talk is a social practice with rules; its knowledge effects are rule effects. |

Three short summaries carry most of the weight:

- **Quests are situations, not scripts** (P7, P8, P13, P17). Someone wants
  something. Something stands in the way. Time makes it a little worse. Several
  people know part of the answer.
- **Information first** (P3, P6, P18, P19). The player must be able to *hear*
  every step before taking it. Three sources for each required fact.
- **Honest voices, fallible world** (P28 to P31). The model only says what the
  engine gave it. Uncertainty and error come from the engine's own record of
  who saw what and when.

---

## (b) Critique of the three quest kinds

### B1. Generated personal quests (`quests.mjs`, `situations.mjs`, `life.mjs`)

**What works.**

- Programs come from real custody, routes and company
  (`quests.mjs:189-443`). The comment at `quests.mjs:187-188` says the bargain
  is resolved once and saved. This is good OSR practice: "stock once" (DM guide
  ch. 9) and no rerolls on reload.
- Sparks seed purpose from logged experiences (`life.mjs:222-262`), so a quest
  has a reason ("It started with talking with Pip", `life.mjs:341-344`). This
  is the Caves of Qud move (P22) and it reads well.
- Hope milestones give a long arc (`life.mjs:28`, `life.mjs:102-116`,
  `life.mjs:563-573`). That is Wildermyth-like attachment (P23).
- Rest and stall pacing (`life.mjs:13-14`, `life.mjs:505-542`) is a calm
  storyteller (P21).

**Problems.**

1. **Situations are tied to four hub items and two places.** The crossing
   requires `attic` and `pond` and the lamp (`situations.mjs:170-195`). The
   answer requires the bell at the pond (`situations.mjs:196-234`). Conditions
   are hard-coded: `lit` checks `s.items.lamp` (`situations.mjs:56-62`),
   `ringing` checks `s.items.bell` (`situations.mjs:63-68`), and
   `validCondition` only accepts `lamp` and `bell` (`situations.mjs:108-110`).
   In a mounted pack (Greece, the lonely forest) only `delivery`, `bargain` and
   `introduction` can appear, so the hope milestone "Settle a trouble nearby"
   (`life.mjs:94-99`) has no situation to fulfil it. This breaks P1: the
   referee cannot rule on a pack's own objects.
2. **The bargain is a fetch-and-carry, not a situation.** The fallback is
   gather, meet, carry (`quests.mjs:348-361`). The destination is chosen by
   rotation (`quests.mjs:333-337`), not by need. Nothing in the world wants the
   item *there*. There is no reason a resident could say aloud (P7).
3. **The LLM sees the quest's name, not its situation.** Talk context says only
   `My active purpose is ${activeQuest.program.name}.` and a list of pending
   names (`narrative.mjs:355-364`). The `purpose` prose (for example
   `situations.mjs:227-230`) never reaches the speaker. The desire facts
   (`narrative.mjs:441-488`) list wanted items, a place and company, but not
   *why*, not *who else could help*, and not *what goes wrong if it waits*.
   Characters can state wants but cannot hint (P3, P6).
4. **No leads.** A resident who wants the oil flask is told `Wants Oil.`
   (`narrative.mjs:478`) when it is elsewhere, but not who holds it or where it
   was last seen, even when the speaker witnessed it. Every quest fact has one
   source: the quest owner. This fails the Three Clue Rule (P6).
5. **No pressure the player can hear.** The lamp's fuel is a real clock, and
   the item fact names it (`narrative.mjs:493`), but no quest fact connects
   it to the stakes ("If the lamp goes dark, the crossing closes"). Stall turns
   (`life.mjs:14`) make the *avatar* restless, but the *situation* never
   worsens (P16, P17).
6. **Consequences are small and private.** The four consequences are `anchor`,
   `oil`, `hush` and `trust` (`situations.mjs:119-124`). They change state, but
   completion entries are not news: `witnessKnowledge` drops entries with
   `questPlan` and drops non-action kinds (`knowledge.mjs:122-137`), and
   `memory.mjs:56` drops `kind === "quest"`. So no other resident can mention
   that Vale anchored the attic. The deed has state impact but no social impact
   (P5).
7. **Hope text is fixed and generic.** Three hope kinds with fixed prose
   (`life.mjs:81-100`) cover every avatar in every pack. "Look after friends at
   the pond" fits Pip; it reads oddly for Dione or Teucer.

### B2. Authored story quests (`storyQuests`, `story-quests.mjs`)

**What works.**

- Rules use lasting evidence: receipts, flags, choices, meetings, quest status
  (`v2/docs/card-story-quests.md:54-71`). Validation rejects cycles. This is a
  sound "situation graph" (P7, P8).
- Talk topics with `requires` already form fact chains
  (`card-story-quests.md:118-147`), and a topic can commit an authored choice
  (`knowledge.mjs:223-230`, `world.mjs:862-887`). This is the correct Talk-only
  path.
- Greece has plural endings and named outcomes (`Fulfilled`, `Declined`,
  `Reported`, `Shared`; `card-story-quests.md:42-46`). This honours P4 and P24.

**Problems.**

1. **Most story quests have no middle.** Of Greece's 21 story quests, 13 list
   no `progress` actions. Examples: `story-quest-greek-table` starts on
   meeting the baker and ends on one choice, `greek-return-water-jar`
   (`card-world.json:8161-8199`, choice at `:1832-1858`).
   `story-quest-greek-ajax-shield` starts on a flag and ends on one delivery
   (`:9129-9147`). The engine treats each story as one step:
   `totalSteps: 1` (`story-quests.mjs:82`) and `quest.step = 1` on resolve
   (`story-quests.mjs:115`). A one-step quest is a single card, not a
   situation. The lonely forest's three quests also have no `progress`
   (`lonely-forest/card-world.json:550-600`).
2. **Information gates still look like buttons.** The decree is both a choice
   card labelled "Hear the burial order" (`greek-drama/card-world.json:1859-1874`)
   and a Talk topic (`:9247`). The card is the reliable path; the topic is a
   second door. Under the owner's rule, *hearing* should be Talk, and *doing*
   should be a card.
3. **Only Greece uses topics.** Greece has 18 topics. The lonely forest has 0.
   Other packs have no story quests. So in most worlds, Talk cannot advance a
   story at all.
4. **One source per fact.** Each topic has one `speaker` at one `at`
   (`card-story-quests.md:100-106`; selection at `knowledge.mjs:213-216`).
   If the player never talks to the guard at the gate, the decree has no
   second or third source (P6). Retelling helps only after someone has
   already heard it.
5. **The speaker gets the title, not the line.** For story records, the
   `program.name` is the title and `program.purpose` is the line
   (`story-quests.mjs:74-78`). Talk context sends only names
   (`narrative.mjs:357-361`). The Greek lines ("Her brother waits for earth.")
   are good hints, and the model never sees them.
6. **No pressure.** A pending story waits forever. Nothing in the data lets a
   need grow while the player is away (P13, P17).

### B3. Roaming quests (`roaming-quests.mjs`)

**What works.**

- The Bard follows the latest meaningful completion from the receipt ledger
  (`roaming-quests.mjs:91-118`). He travels by the same legal routes
  (`v2/docs/card-table/roaming-quests.md:14-19`). Route knowledge is personal
  and saved (`roaming-quests.mjs:21-49`). Blocked edges create Help cards that
  other people can join. This is a real systemic quest and fits P9.
- Family exclusion stops loops (`roaming-quests.md:44-46`).

**Problems.**

1. **He goes, but he does not learn.** The journey's purpose is
   `Reach the place where X completed a quest.`
   (`roaming-quests.mjs:109-111`). Arrival completes the card
   (`roaming-quests.mjs:119-133`) but teaches him nothing new. Completions
   are not facts (see B1.6). His song uses "earned authored verses"
   (`roaming-quests.md:54-56`), so generated deeds never enter it.
2. **No rumor role.** The Bard is the natural rumor table (P12), but no
   resident can hear from him what happened elsewhere, and he cannot point the
   player at a place where something is still unresolved.
3. **The purpose does not say what the deed was.** "Visit the Pond" with no
   content gives the model nothing to sing or ask about.
4. **He always chases the newest.** There is no salience (P19). A small gift
   overrides a grand homecoming if it was later.

### B4. Cross-cutting: the Talk packet

- **Two-fact cap.** `knowledgeFacts` keeps two facts per speaker
  (`knowledge.mjs:364`), sorted by recency, with priority only for the one
  pending disclosure (`narrative.mjs:366-371`). A speaker with a quest-relevant
  fact from five turns ago will lose it to two newer gifts.
- **Origin phrase without age.** Facts say `I witnessed this earlier:` or
  `X told me this earlier:` (`knowledge.mjs:366-371`). There is no age, no
  place, and no "this may have changed". Old news about custody becomes a
  silent lie when the item has moved.
- **No explicit unknowns.** The packet never tells a speaker what it does *not*
  know. The DM guide calls for "excluded claim classes"
  (`docs/dm-guide/chapters/08-ai-referee.md:45-49`). Without them, a model
  asked "where is the bell?" will guess.
- **The design backlog is heavier than needed.** `quest-grammar-and-return.md`
  proposes a typed `QuestPattern` graph, receipts and deltas across the C
  kernel and Rust (`:169-215`). Its functions are sound (Sign, Return), and its
  invariants match ours (`:217-247`, especially 3 and 15). But the card table
  can get most of the value from data and Talk context, without a new graph
  language.

---

## (c) Recommendations, ranked by value and cost

Value: how much better quests feel. Cost: code and data work. Every item keeps
Talk as the only quest surface and keeps legality and rewards in the rules.

| Rank | Change | Value | Cost |
|---|---|---|---|
| R1 | Quest brief in Talk context | High | Low |
| R2 | Leads: who knows, who holds, where last seen | High | Low-Medium |
| R3 | Completions become news | High | Low |
| R4 | Aged, placed, hedged fact phrasing | High | Low |
| R5 | Quest-salient fact selection | High | Low |
| R6 | Three-source lint for story quests | High | Low (data + test) |
| R7 | Give each story quest a middle | High | Medium (writing) |
| R8 | The Bard as rumor carrier | Medium-High | Low-Medium |
| R9 | Omens: pressure that speaks | Medium-High | Medium |
| R10 | Pack-driven situations | High | Medium-High |
| R11 | Reaction to the asker | Medium | Low |
| R12 | Pack-authored hope text | Medium | Low |
| R13 | Rumor tables, stocked once | Medium | Medium |

### R1. Quest brief in Talk context

**Problem:** B1.3, B2.5. **Files:** `v2/card-game/narrative.mjs:349-375`.

Replace the name-only lines with a short brief per carried quest, built from
saved data:

```text
I want: <purpose or story line>.
Still missing: <unmet item / person / place / fact, from requiredItems and conditions>.
It started with: <spark phrase, life.mjs purposeOrigin>.
```

For story quests use `program.purpose` (the authored `line`). For generated
quests use `program.purpose`, which already exists (`situations.mjs:227-230`,
`quests.mjs:408`). Cap at 240 characters like other facts.

*Talk-only:* the brief is speaker context, not UI. *Authority:* every field is
read from saved state; the model only phrases it.

### R2. Leads: who knows, who holds, where last seen

**Problem:** B1.4, B2.4. **Files:** new pure helper beside `knowledge.mjs`;
call site `narrative.mjs:441-488`.

For each unmet requirement of a quest the *speaker* knows about (their own, or
one they carry, or a quest whose holder is present), derive up to three lead
lines from authoritative state and the speaker's own knowledge:

- **Holder lead:** if the speaker witnessed the last custody event of the item
  (a `give` or `trade` fact they know), say "I saw Mara take the oil at the
  station." Use the fact's turn and place, not the live state.
- **Speaker lead:** if an authored topic for the needed fact has a `speaker`
  the current speaker has met, say "The guard at the gate reads the orders."
- **Place lead:** if the needed place has a visible path from here, say "The
  pond is past the attic mirror."

A lead never names hidden entities and never states live custody the speaker
did not see. It is a pointer to a node (P8), not the answer. This is how a
Talk turns into a hint without any button.

*Authority:* leads are computed by rules from facts the speaker holds; the
model may phrase them but cannot add one. The validator (R4 below) rejects
names outside the packet.

### R3. Completions become news

**Problem:** B1.6, B3.1. **Files:** `knowledge.mjs:116-164`,
`quest-completions.mjs:21` (record), `memory.mjs:56` (unchanged; memory stays
separate).

When `recordQuestCompletion` writes a receipt, also call a new
`witnessCompletion(world, completion, text)` that stores a fact
`completion:<seq>` with a deterministic sentence such as "Vale left the lamp
lit in Mara's care at the station." Witnesses are the participants and anyone
present. The sentence comes from a template per situation kind and per story
`completion` outcome, so it passes `validFactText` (`knowledge.mjs:34-38`).

This needs a shared-rules version bump and replay care (a new fact id
namespace), as `roaming-quests.md:48-52` did for journeys. Mark these facts
protected while a related quest is open, as `retainFact` already does for
`knows` topics (`knowledge.mjs:83-93`).

*Impact:* deeds now travel by Talk (P5). *Authority:* the text is a template
filled from the receipt.

### R4. Aged, placed, hedged fact phrasing

**Problem:** B4 "origin without age". **Files:** `knowledge.mjs:349-373`.

Phrase each fact with its source kind, teller, place and age band. Add a hedge
when the fact is about custody or position and the speaker did not see it this
turn. See section (d) for the exact format. This is the single cheapest way to
let characters "mislead plausibly" while staying honest: old news is still
true *as old news*.

### R5. Quest-salient fact selection

**Problem:** B4 "two-fact cap". **Files:** `knowledge.mjs:349-364`,
`narrative.mjs:366-371`.

Keep a small cap (the prompt budget matters), but sort by a deterministic score
in the spirit of Generative Agents (P29):

```text
score = 8 * relevantToSpeakerQuest      (fact id is a needed topic, or names a needed item/place/person)
      + 6 * relevantToListenerQuest     (same test for the listener)
      + 4 * pendingDisclosure
      + 2 * witnessed
      - ageBand                          (0 this turn, 1 recent, 2 older, 3 old)
```

Raise the cap from 2 to 3 only for quest-relevant facts. All inputs are saved
state. No embeddings are needed, so replay stays exact.

### R6. Three-source lint for story quests

**Problem:** B2.3, B2.4. **Files:** `v2/card-game/pack-story-schema.mjs`,
`test/card-pack-story-quests.test.mjs`, `v2/docs/card-story-quests.md`.

Add a compiler check (warning first, error later) for each story quest:

- every `knows` requirement on a progress or ending choice has at least two
  sources: two topics with different speakers or places, or one topic plus one
  witnessed choice receipt that teaches it;
- every ending gate (`holding`, `flag`) has a topic that names where the needed
  item or flag comes from;
- report quests with no `progress` and no topic chain as "single-card story".

This puts the Three Clue Rule (P6) into tests, not prose. It costs only data
and a schema test.

### R7. Give each story quest a middle

**Problem:** B2.1, B2.2. **Files:** `v2/content/greek-drama/card-world.json`
(`storyQuests` at `:8159`, `topics` at `:9245`), `lonely-forest/card-world.json:550`.

For each of the 13 single-choice Greek quests and the 3 forest quests, add one
Sign beat between start and ending, in this order of preference:

1. a topic that the holder or a neighbour says, which the ending choice then
   `requires` (a `knows` rule, already supported, `card-story-quests.md:76-79`);
2. a `progress` choice that moves an item into place;
3. a second ending with a different outcome (`Declined`, `Shared`).

Move pure "hear" choices (for example `greek-hear-decree`, `:1859`) to
topic-only once R6 confirms each has another source. Keep the choice id and
receipts for save compatibility; only stop offering the card.

This is data work. It matches the Lead/Gate shape in the DM guide (ch. 6).

### R8. The Bard as rumor carrier

**Problem:** B3. **Files:** `roaming-quests.mjs:91-118`, the Bard's topics in
the hub pack, `knowledge.mjs`.

- On arrival, the Bard gets the completion fact (R3) as `heard` from any
  present participant, through the normal Talk reserve path, or as `witnessed`
  if he arrives the same turn.
- His journey purpose names the deed: "Hear how Vale left the lamp at the
  station" (template from the completion).
- When he Talks, his salience score (R5) prefers completion facts from *other*
  places than the listener's. He becomes the rumor table (P12) without any
  table UI.
- Optional: an unresolved story quest elsewhere gives him a lead (R2 place
  lead) to say: "In Thebes a sister is still waiting for earth."

*Authority:* he only retells facts the engine gave him.

### R9. Omens: pressure that speaks

**Problem:** B1.5, B2.6. **Files:** `storyQuests` schema
(`pack-story-schema.mjs`), `story-quests.mjs`, `life.mjs` stall loop.

Add an optional `omens` list to a story quest: ordered topic ids, each with a
`speaker` and `at`, released one at a time when the quest is pending and a
deterministic world beat fires (for example every N resolved rounds since the
last beat, or on the overloaded beat in R13). An omen is only a new topic the
speaker now knows. It never changes items, routes or endings. Example for
`story-quest-greek-burial`: "The dogs have been at the field outside the gate."
then "The guard has doubled the watch."

For generated quests, reuse real clocks. When a needed item is a light with
low fuel, the brief (R1) adds "The lamp will not last much longer." This turns
existing state into a sayable stake (P16).

Mythic Bastionland's rule applies: player action comes first. If the quest has
moved on, skip omens that no longer fit (use `when`).

### R10. Pack-driven situations

**Problem:** B1.1, B1.2. **Files:** `situations.mjs`, pack item data,
`pack-schema.mjs`.

Replace the hard-coded `lamp`/`bell`/`cloth` checks with item *affordances* in
pack data, for example:

```json
{ "id": "greek-water-jar", "affords": ["fill", "carry"], "needs": { "fill": "greek-well" } }
```

Then define the five situation kinds against affordances and place tags, not
ids: a *crossing* needs a light-type item and a crossing edge; an *answer*
needs a sound-type item at a place with an authored answer; a *delivery* needs
a person whose need names a tag. Keep the forest's exact ids as the first data
set so saves replay. This is the most valuable change for packs and the most
expensive; it needs a rules version, migration, and the shared engine rebuild.

Also give the bargain a reason: choose the destination as a place where some
resident's hope or need names the item's tag, not by rotation
(`quests.mjs:333-337`). Then the brief can say who wants it there.

### R11. Reaction to the asker

**Problem:** P11 unused. **Files:** `narrative.mjs:463-469` (favour helpers),
`motives.mjs` (grievances), `knowledge.mjs:207-262`.

The engine already knows trust and grievances. Add one deterministic stance
line per speaker toward the listener: `open`, `guarded` or `unwilling`. In
`reserveKnowledge`, an `unwilling` speaker reserves no disclosure (they refuse
to share). Talk context gets "You do not want to tell Vale about the decree
yet." The model voices a refusal. No lie is told, and the rules decided it.

### R12. Pack-authored hope text

**Problem:** B1.7. **Files:** `life.mjs:81-100`, entity profiles.

Let a profile supply `hope` lines per kind (`title`, `wish`, `next`). Fall back
to current text. Validation keeps length and sentence rules. Dione's hope can
then read "I want my table to feed whoever comes home."

### R13. Rumor tables, stocked once

**Problem:** B4, P12, P10. **Files:** pack data (`rumors` list), `knowledge.mjs`
install path.

Let a pack author a short `rumors` list: complete one-sentence facts, each with
`speaker` candidates, a `truth` field (`true`, `partial`, `false`) that stays in
the engine, and an optional quest link. At world creation (or first mount),
assign each rumor to one candidate by a seeded draw from the world seed, and
freeze it, as the DM guide's "Tables without amnesia" asks
(`docs/dm-guide/chapters/07-places-and-tables.md:140-184`). A rumor is spoken as
hearsay: "People at the well say ...". A `false` rumor is authored, attributed
and hedged, so the model never invents it. Later, when an event contradicts a
rumor, the engine can give witnesses a correcting fact.

---

## (d) Rumor and knowledge design for the Talk path

### D1. What the engine already guarantees

- A fact is one complete sentence of at most 180 characters
  (`knowledge.mjs:34-38`).
- Each listener keeps how they learned it: `witnessed` or `heard`, the teller,
  the event and the turn (`knowledge.mjs:61-77`).
- One Talk reserves at most one disclosure (`knowledge.mjs:207-262`,
  `knowledgeDisclosures` slices to one at `:285`).
- The listener learns the fact only if the saved reply contains the full fact
  sentence (`factDelivered`, `knowledge.mjs:39-46`; checked at `:316-323`).
- Heard news can be retold only on a later turn (`knowledge.mjs:221-222`).

This is already a good honest-rumor core (P28, P30). The proposals below add
phrasing and scope, not a second system.

### D2. Four kinds of lines in the packet

Every quest-related line given to a speaker falls into one of four kinds. Each
kind has a fixed lead phrase so the model can tell them apart and so a
validator can check them.

| Kind | Lead phrase | Source in rules | The model may |
|---|---|---|---|
| **Know** | `I saw this myself (<when>, <where>):` | `witnessed` fact | State it plainly. |
| **Heard** | `<Teller> told me (<when>):` | `heard` fact | State it as hearsay, naming the teller or "someone". |
| **Want** | `I want:` / `Still missing:` | quest brief (R1) | Ask for help, explain why. |
| **Unknown** | `I do not know:` | derived from the quest's unmet needs minus the speaker's facts | Say they do not know, and may point to a lead. |

Plus one **Lead** line kind (R2): `Ask <person>` / `Look at <place>`, which
the model may turn into a suggestion.

`<when>` uses bands, never turn numbers: `just now`, `today`, `a few days
ago`, `long ago`. Map from turns with a fixed table. Turn numbers in prose
invite arithmetic and false precision.

### D3. Hedging old custody and position facts

The world moves. A heard or old fact about *where* something is may now be
wrong. The engine knows this; the speaker may not. Rule:

- If a fact's subject is custody or position (verbs `give`, `trade`,
  `accompany`, `move`, or a completion that placed an item), and the fact's
  turn is older than the current turn, append the hedge sentence to the packet
  line: `It may have moved since.`
- Never correct the fact in the speaker's packet unless the speaker has a newer
  fact. A character who saw Pip take the bell three days ago honestly says so.
  The player, not the speaker, discovers it moved.

This produces **plausible misleading without lies** (P28): stale but sincere
testimony, the oldest trick in mystery design, made safe because the engine
only ever stored true events.

### D4. Hinting rules for the voice

Give speakers these short rules in the style section (DM guide ch. 8 "Style"):

1. Speak only from the Know, Heard, Want, Unknown and Lead lines.
2. Point at a person, place or thing. Do not solve the quest for the listener.
3. Name your source when you repeat what you heard.
4. If asked something under `I do not know`, say you do not know. You may
   suggest the Lead.
5. Do not say a quest is done, an item has moved, or a door is open unless a
   line says so.

These are principles in the Principia Apocrypha style (P15). The engine does
not rely on them; the validator does the enforcing.

### D5. Validation (fail closed)

`acceptKnowledgeSpeech` already rejects a disclosure if the sentence is
missing. Extend the reply check (the DM guide's list,
`08-ai-referee.md:91-110`) with three cheap, deterministic tests on the saved
line:

1. **Entity scope.** Every entity name in the reply must be in the packet's
   entity list or a Know/Heard/Lead line. Names come from the pack registry, so
   matching is exact.
2. **No completion claims.** Reject phrases that state a quest step as done
   when the packet has no completion line for it. Use the quest titles and
   item names as the match set.
3. **No custody claims beyond facts.** A line "X has the Y" must match a Know
   or Heard line about X and Y, or the speaker's own `Holding:` line
   (`narrative.mjs:406-408`).

On failure, drop the reply and keep the turn's rule result. The DM guide
already says to do this, not to invent canned speech
(`08-ai-referee.md:105-110`).

### D6. Rumor spread

Spread stays exactly as now: one fact per Talk, verbatim, accepted only after
the checked reply is saved, retellable on a later turn. Three additions:

- **Hop count.** Store `hops` on `heard` entries (teller's hops + 1). Phrase
  `hops >= 2` as `People say ...` instead of naming the teller. This is how
  real rumor loses its source, and it costs one integer. It needs a knowledge
  version bump and a migration that sets `hops = 1` for existing heard facts.
- **Completion news first for travellers.** The salience score (R5) favours
  completion facts from other places when the speaker is the Bard or a
  traveller.
- **Correction.** When a new witnessed fact contradicts an older custody fact
  the listener holds (same item, newer turn), it outranks it in R5. The world
  corrects rumors by events, not by the model.

### D7. Withholding and refusal, not lying

A character may refuse to share (R11) or may only share part (an authored
`partial` rumor, R13). A character never states a false fact the engine did
not author. If a pack wants a deceiver, it authors the false sentence as a
`false` rumor with a named speaker, and the engine records who told it. This
matches Talk of the Town's design, where lying is a simulated act with a
recorded source, not a model failure (P28).

### D8. Worked example (Greece, burial)

State: Vale has met Antigone. The guard at the gate knows the topic
`greek-hear-decree`. Ismene was at the gate when the guard read it two turns
ago (witnessed). Vale has not been to the gate.

Packet for Antigone (speaker) with Vale (listener):

```text
I want: Her brother waits for earth.
Still missing: what the city's order says.
I do not know: the exact words of Creon's order.
Ask: Ismene was at the gate. The guard at the gate reads the orders.
```

Packet for Ismene, if Vale Talks to her next:

```text
I saw this myself (a few days ago, at the gate): Creon's order forbids burial for Polyneices.
I want: (none shared)
```

Ismene's reply must contain the full fact sentence to teach it. Now the decree
has three sources (guard topic, Ismene's witness, Antigone's lead), and no
"Hear the burial order" card is needed.

---

## (e) Reading list

OSR and tabletop

- Matt Finch, *A Quick Primer for Old School Gaming* (2008). Background: [Wikipedia: Matthew J. Finch](https://en.wikipedia.org/wiki/Matthew_J._Finch); [RPG.net review](https://www.rpg.net/reviews/archive/16/16298.phtml).
- Justin Alexander, [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule).
- Justin Alexander, [Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots) and [Tools, Not Contingencies](https://thealexandrian.net/wordpress/37422/roleplaying-games/dont-prep-plots-tools-not-contingencies).
- Justin Alexander, [Running Mysteries: the two types of leads](https://thealexandrian.net/wordpress/50095/roleplaying-games/running-mysteries-the-two-types-of-leads).
- Justin Alexander, [Hexcrawl](https://thealexandrian.net/?p=36844), [Designing the hexcrawl](https://thealexandrian.net/wordpress/48051/roleplaying-games/hexcrawl-addendum-designing-the-hexcrawl), [5E Hexcrawl](https://thealexandrian.net/wordpress/46020/roleplaying-games/5e-hexcrawl).
- Justin Alexander, [Rules vs. Rulings](https://thealexandrian.net/creations/misc/rules-rulings.html) (a critique of the primer).
- Ben Milton, Steven Lumpkin, David Perry, [Principia Apocrypha](https://lithyscaphe.blogspot.com/p/principia-apocrypha.html).
- Chris McDowall, [The ICI Doctrine](https://www.bastionland.com/2018/09/the-ici-doctrine-information-choice.html), [How I Run Into the Odd](https://www.bastionland.com/2015/09/how-i-run-into-odd.html), [Primacy of Action](https://www.bastionland.com/2022/09/primacy-of-action.html).
- Chris McDowall, [Mythic Bastionland](https://chrismcdee.itch.io/mythic-bastionland); [The State of Mythic Bastionland](https://www.bastionland.com/2023/09/the-state-of-mythic-bastionland.html).
- Necropraxis, [Overloading the encounter die](https://www.necropraxis.com/2014/02/03/overloading-the-encounter-die/).
- Arnold K, [Bardic Services](https://goblinpunch.blogspot.com/2016/01/bardic-services.html) (Goblin Punch).
- Emmy Allen, *The Gardens of Ynn*; [interview](https://thefandomentals.com/gardens-of-ynn-ttrpg-emily-allen-interview).
- Gus L, *Dungeon of Signs* and *All Dead Generations*; [review of Tomb Robbers of the Crystal Frontier](https://gorgonbones.bearblog.dev/review-tomb-robbers-of-the-crystal-frontier-by-gus-l/).
- Reaction rolls: [Black Citadel](https://blackcitadelrpg.com/reaction-rolls-5e/).
- John Harper, *Blades in the Dark*, [progress clocks](https://roll20.net/compendium/BITD/Progress%20clocks).
- Vincent Baker, *Apocalypse World*, fronts: [The Daily Apocalypse on threat countdowns](https://daily-apocalypse.com/daily-apocalypse/85-threat-countdown-clocks).

Systemic, narrative and cosy games

- Emily Short, [Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/); [Storylets: You Want Them](https://emshort.blog/2019/11/29/storylets-you-want-them/); [Storylets Play Together](https://emshort.blog/2019/12/03/storylets-play-together/).
- Richard Evans and Emily Short, [Versu](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf).
- Tynan Sylvester, [The Simulation Dream](https://gamedeveloper.com/design/the-simulation-dream); [RimWorld](https://en.wikipedia.org/wiki/RimWorld).
- Jason Grinblat, [Procedurally Generating History in Caves of Qud](https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves).
- Nate Austin, [Wildermyth GDC 2022 session](https://gdcvault.com/play/1027614/Independent-Games-Summit-Session-Getting).
- [Ultima V](https://en.wikipedia.org/wiki/Ultima_V:_Warriors_of_Destiny); [Lycaeum: NPC schedules](https://lycaeum.ultimacodex.com/npc-schedules/).
- Josh Sawyer on Pentiment: [Shacknews](https://www.shacknews.com/article/146276/pentiment-josh-sawyer-no-correct-answer).
- [Disco Elysium](https://en.wikipedia.org/wiki/Disco_Elysium).
- Adam Robinson-Yu, [A Short Hike postmortem (GDC 2020)](https://gdcvault.com/play/1026613/Independent-Games-Summit-Crafting-A); [PlayStation Blog](https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/).
- Nicolas Guérin on Spiritfarer: [Pocket Tactics](https://www.pockettactics.com/spiritfarer/interview).

LLM characters and world state

- Ryan, Summerville, Mateas, Wardrip-Fruin, [Toward Characters Who Observe, Tell, Misremember, and Lie](https://ojs.aaai.org/index.php/AIIDE/article/view/12825).
- Park et al., [Generative Agents](https://arxiv.org/abs/2304.03442).
- Nye et al., [Improving Coherence and Consistency in Neural Sequence Models with Dual-System, Neuro-Symbolic Reasoning](https://arxiv.org/abs/2107.02794).
- Wang et al., [Can Language Models Serve as Text-Based World Simulators?](https://arxiv.org/abs/2406.06485).
- Zhu, Martin, Head, Callison-Burch, [CALYPSO: LLMs as Dungeon Masters' Assistants](https://arxiv.org/abs/2308.07540).

In-repo

- [Story quest guide](../../v2/docs/card-story-quests.md), [quest journeys](../../v2/docs/card-table/roaming-quests.md), [card guide](../../v2/card-game/README.md).
- [Quest grammar and return](../backlog/quest-grammar-and-return.md) (Sign and Return map to R2/R7 and R3/R8 here).
- DM guide: [obstacles and pressure](../dm-guide/chapters/06-obstacles-and-pressure.md), [tables](../dm-guide/chapters/07-places-and-tables.md), [AI referee](../dm-guide/chapters/08-ai-referee.md), [preparing adventures](../dm-guide/chapters/09-preparing-adventures.md).
