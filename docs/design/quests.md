# Quests belong to avatars, items and places

Written against rules 187 (`65cfa23ad`). Paths are relative to the repository root; `card-game/` means `v2/card-game/` and `rust/` means `v2/orchestrator-rust/src/`.

Today a quest is something a person takes. Offers stand at boxes, residents, homes, places and the Listener (`OFFER_KINDS`, `card-game/world/offers.mjs:24`). Accept moves one into a stack of up to three held quests (`MAX_HELD`, `card-game/want.mjs:126`); home and Listener offers are held without it. Discard sets one down. The arcana spread shares those slots. Residents run a separate machine: each has one want, authored, staged, taken from a rumour or drawn from the world (`nextWant`, `want.mjs:439-467`), and the world's planner pursues it.

This design removes taking. Every avatar, item and place can have one quest card, and completing it levels its owner. Only the four points under Decisions are decided. Everything else in this doc is proposed and open to change; the points most in doubt are numbered proposals (P1-P6) or open questions.

## Decisions

1. **Quests are never taken.** Accept, held quest slots (`MAX_HELD`, `under`, `slotsUsed`), quest offers and setting a quest down are removed. A quest belongs to its owner; nobody holds it.
2. **One card per entity.** Each avatar, item and place can have a single quest card. Completing it raises its owner one level. An entity need not have a card.
3. **A person's avatar card is like the Fool:** one face-down arcanum, as `giveFool` deals today (`card-game/world/arcana.mjs:481-494`).
4. **Everyone else's card sits face down behind them.** A Talk teaches you the speaker's quest and the quests of the items they hold. Once you know a quest, its card is face up for you.

## The model

This section proposes how the decisions work in the rules. Where a point rests on a numbered proposal, it says so.

### The card behind each entity

- A resident's card sits after that resident's group in the hand, where the locked card from rules 187 sits today (`besideHolders`, `card-game/quest-card.mjs:269-278`). An item's card sits behind the item, and a place's card behind the place.
- Face down, it shows the locked back (`LOCKED_BACK`, `card-game/locked-box.mjs:18`). Face up, it shows the existing quest face (`questFrame`, `card-game/app.mjs:3634-3708`), worded for the viewer by `questFor` (`card-game/talk-quest.mjs:39-87`).
- Face is per viewer. The same card is face up for everyone who knows it and face down for everyone else.
- There is no quest log. The face-up cards behind their owners are what you know.
- The client reuses `want-card`, `card-back`, `place-edge` and `quest-fold`. Any new class goes through the UI inventory (`card-game/ui-inventory.json`).

### A person's avatar

- The Listener deals the avatar one arcanum, face down, behind the avatar.
- Its proof latches `done` while face down, as `settleSlots` does today (`card-game/world/arcana.mjs:641-662`).
- A Talk with the Listener while called turns it, as for the Fool today (`arcana.mjs:533-557`). If it is done, it unlocks, the level rises by one and the next card is dealt face down. If not, it turns face up with its terms and unlocks the moment its proof holds.
- The arcana deck gives the next card. `deckOrder` (`arcana.mjs:290`) already deals the Fool first and the World last. `nextSpread` (`arcana.mjs:401`) becomes a one-card deal: a card not yet unlocked while any remain, otherwise a known card at the current scale (`card-game/arcana.json:20-29`).
- The avatar holds no other quest. Your things' cards sit behind your things.

### Learning a quest

- A quest is a fact in `world.knowledge` (`card-game/knowledge.mjs`), the store Talk already uses to pass facts on, with a new source kind, `quest`. A planned books design (branch `docs/books-design`, not yet published) may share this store.
- The fact's id names the owner and the card. Its text is the owner's want in one sentence, within `FACT_TEXT_LIMIT` (180 characters).
- When the owner tells it in a Talk, the listener records it as `heard` with the owner as teller (`tell`, `knowledge.mjs:302-318`; the entry's shape is checked at `:565-580`).
- A Talk teaches the speaker's card and the cards of the items the speaker holds. The gates in `revealed` stay, including authored `minTrust` (`card-game/want-talk.mjs:79-108`).
- The `heard` map (`validHeard`, `want.mjs:890-908`) and `toldWant` (`talk-quest.mjs:131-134`) are replaced by reading the fact. II The High Priestess (`arcana.json:72-84`, a count of `heard`) counts owners whose quest you learned from them.
- A live card's fact does not age out. When the store is full, `retainFact` evicts the oldest fact that is neither a topic nor pinned grievance evidence (`knowledge.mjs:112-133`), so quest facts are spared the way topic facts are. When a card completes, its fact may age out.
- Knowledge validation is exact-shape (`validKnowledge`, `knowledge.mjs:470-622`), so the new source kind is a rules change.

### Completing a card

- After each play, the rules check the live card of each entity the play touched, with the existing `questMet` and `stepMet` (`want.mjs:500-568`). State verbs read the world; act verbs need the play.
- The completer is the play's actor; for a give, the giver. A card already met before the play pays nobody (rules 150).
- Without P2, a card completes only when its completer knew it. P2 proposes that it completes whoever meets it.
- The owner rises one level. If the owner has a next card (P4), it becomes live, face down for everyone.
- The `want_met` log entry (`card-game/world.mjs:765-785`) gains `ownerId`. The Listener's calls, place levels and the Rust voice authority read that entry.
- A card whose target is gone for good is passed over without a level (`lostOf` and `settleLost`, `want.mjs:264-275,777-791`). The trust lost when a wanted thing is lost in its owner's sight stays.

### Residents (P6)

- If P6 is taken, the planner (`wantPlan`, `world.mjs:3096-3305`) chooses among the cards the resident knows: its own first, then the cards it has learned from others.
- Away and unplayed avatars use the same planner, and `awayPlan` (`world.mjs:2996-3045`) merges into it.
- There are no timers. Stalled wants are no longer revised (`reviseStalledWants`, `want.mjs:724-772`), so a card stays until it completes or is lost.
- A resident's cards are its staged `wants` in authored order, or its single authored `want`, each gated by its `when` (`stagedWants`, `want-talk.mjs:25-43`).
- `fillWants` (`want.mjs:811-822`), the draw from `wantCandidates` and `heardWant` (`card-game/world/rumours.mjs:143-201`) are removed. Rumours no longer make wants.
- `levelAtHome` stays: a completion's level is banked until the resident reaches its home (`want.mjs:93-110`).

## Proposals

These are not decided. Each names the research that supports it.

### P1. Completing another's quest earns their trust, and trust feeds the arcana

- Completing another actor's card raises the owner's trust in the completer by one, capped at 3 (`gainTrust`, `card-game/world/company.mjs:79-84`). Rules 176 already does this when someone meets a resident's want (`helped`, `want.mjs:641-662`). Arcana stay outside it, because their proofs read only the avatar's own plays and record.
- Each distinct owner whose trust you earn this way counts toward the Listener's call (`countResidentQuest`, `card-game/world/arcana-record.mjs:47-54`; `CALLS` is 3 in `arcana.json`). This replaces "three accepted resident quests".
- Later, an arcanum could bind to a resident who trusts you. `bindingOf` (`arcana.mjs:226`) already pins roles per card.
- Fire Emblem supports usually grow when a pair acts together, step through C, B and A, and in most games open each level with a conversation. That is a close match for trust 0-3 ([Fire Emblem Wiki: Support](https://fireemblemwiki.org/wiki/support)).
- In Persona each Social Link stands for one arcana, and ranking it raises the experience bonus for fusing that arcana's Personas. The Wild Card turns bonds into strength, and Akechi's unwillingness to form bonds limits his potential ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant), [megatenwiki: Wild Card](https://megatenwiki.com/wiki/Wild_Card)).

### P2. Completing a quest without knowing it was one still counts

- A card met by someone who did not know it still completes. It turns face up for the completer as it completes, showing the deed that met it.
- The log line names the deed. The narration, text a language model produces from the prompt, can include it.
- This is already true for a resident's trust and rank-up: `helped` checks neither `heard` nor Accept. It is not true today for the Listener's call, place levels, `closed` or companion binding.
- Hades II tracks a prophecy's progress before its prerequisites to appear are met ([Hades Wiki: Fated List (II)](https://hades.fandom.com/wiki/Fated_List_of_Minor_Prophecies/Hades_II)).
- Stardew's Help Wanted board is the opposite case. Gathering requests count only items collected after accepting, and stored items do not count ([Stardew wiki mirror: Quests](https://wiki.stardewvalley.net/Quests)). That is the friction this design removes.

### P3. A place shows its card when you stand in it, and a loose item when you pick it up

- Standing in a place makes you a witness of its card, recorded as a `witnessed` fact. Taking a loose item does the same for the item's card. A held item's card is taught by its holder's Talk (decision 4).
- Guild Wars 2 renown hearts are invisible on the map until a nearby scout tells you or you walk into range, and no NPC interaction is needed to start one ([GW2 Wiki: Renown Heart](https://wiki.guildwars2.com/wiki/Task)).
- This is the least settled point. Today a place offer needs you to stand there (`placeOffer`, `offers.mjs:132-144`), and the client shows it when the place card is selected. Take is not among the verbs that make knowledge (`newsVerbs` and `witnessKnowledge`, `knowledge.mjs:135-163`).
- The alternative is that a place's card is taught by a resident who lives there, and a loose item's card by whoever saw it last.

### P4. Depth comes from a stack of cards behind one active card

- Each entity has an ordered stack with one card per level. Only the top card is live, and the next one comes up after a level.
- The edges behind the top card (`stackEdges`, `app.mjs:1769`) show how many cards remain, face down.
- Stacks come from what exists:
  - residents: the staged wants, or the single authored want;
  - places: the missing things from `placeWant` (`offers.mjs:83-113`), one at a time, which already gives one level per thing laid back (`placeRank`, `want.mjs:87-88`);
  - avatars: the arcana deck;
  - items: authored cards.
- Persona links run through ranks 1-10 ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant)). Minecraft villagers have five career levels, shown by the badge they wear, and each trade adds to the villager's own experience bar ([Minecraft Wiki: Trading](https://minecraft.fandom.com/wiki/Trading)).

### P5. Rules for residents completing what a person was working toward

These apply only with P6.

- **Shared credit.** When a card completes, everyone who knew it gains the owner's trust, not only the completer. The level goes to the owner as always.
  - Guild Wars 2 gives everyone seriously involved in a fight the full experience and loot ([GW2 Wiki: Design Manifesto](https://wiki.guildwars2.com/wiki/Guild_Wars_2_Design_Manifesto)).
  - In Death Stranding, players can add resources to another player's bridges or roads and earn likes for it ([GameSpot](https://gamespot.com/gallery/death-stranding-multiplayer-guide-explaining-how-t/2900-3159/)).
- **A person's own arcanum is proved only by their own deeds.** Residents can only help indirectly, for example by trusting them for V The Hierophant.
  - Bethesda toned down Oblivion's Radiant AI after residents killed a quest's merchant before the player arrived ([GamesBeat](https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/)).
- **The planner ranks a card that a person knows below its other choices,** so residents rarely race a person to the same goal.
- **A resident's completion turns up the next card.** The person loses one goal and sees a new one. When an Animal Crossing request favor runs out of time, the villager may say they got the thing themselves ([Nookipedia: Favor](https://www.nookipedia.com/wiki/Favor)).

### P6. Residents follow the same rules as avatars people steer

- The only difference is who chooses the play: a person or the world's planner. Residents learn quests by Talk, complete any card they know, and level the same way.
- This replaces drawn wants and rumour wants for residents. `talkQuest` stops requiring a player (`talk-quest.mjs:120-129`).
- Mount & Blade II lords follow the same rules and restrictions as the player, and choose among actions by weighing factors such as travel distance ([GameSpace](https://www.gamespace.com/all-articles/news/mount-blade-ii-bannerlord-campaign-ai-dev-blog/)).

## What exists and what changes, per source

| Source | Today | Under this design |
|---|---|---|
| Box | An offer at a shut box that is not your door, taken by Accept (rules 159). It asks for the lock's goal (`boxWant`, `card-game/world/boxes.mjs:473`). | The box's own card is its lock's goal. Completing it opens the box (`creditOpened` still feeds I The Magician and XVI The Tower) and levels the box. |
| Resident | Told by Talk, then taken by Accept (rules 146, 187). | The resident's live card. Talk teaches it, and nobody takes it. |
| Home | Held automatically at your own door: bring your belonging home (`offers.mjs:156-167`). | The belonging's own card, known to its avatar. |
| Listener | Fetch quests held automatically during a sale, or while a face-up card asks for something given up (`fetchPool`, `offers.mjs:173-184,230-271`). | Removed with the price. The Listener turns the arcanum and asks for nothing. |
| Place | Taken by Accept when you stand there (rules 174). `placeMet` is the level. | The place's card asks for one missing thing laid back. Laying it back levels the place (with P2, whoever does it). |
| Dream | "Rest at home", held after a level rise (`sleepQuest`, `want.mjs:216-226`). | Not a quest. A level rise sets a pending dream on the arcana record, and waking at home gives the glimpse (`wake`, `want.mjs:227-249`). |
| Arcana spread | Up to three cards, priced by a Give to the Listener, filling quest slots. | One face-down card. |

## What depends on an accepted quest today

- **The Listener's calls.** `countResidentQuest` fires only for a traveller's met `quest:from:` quest (`want.mjs:673-674`). It fires from the `want_met` owner instead: a completed card whose owner is another actor, or with P1, any owner whose trust you earned.
- **Place levels.** Only a met, held `quest:place:` quest adds to `placeMet` (`want.mjs:675-680`). The place card's completion adds the laid thing.
- **Companion binding.** `bindAsker` (`world.mjs:1899-1930`) binds an escort quest's asker when the quest is taken, if they trust you at 2 or more (`ACCOMPANY_TRUST`). The proposal is that it binds on the Talk that teaches an escort card instead, with the same checks (open question 6). `pinnedCompanion` (`talk-quest.mjs:108-115`) reads the known card instead of the held one.
- **The `closed` record** (`want.mjs:173-189`). Its job of stopping repeat offers goes with the offers. `closedBy`, `closedAny`, `MAX_CLOSED` and `validClosed` are removed. Its two Rust readers change:
  - `rust/card_voices/authority.rs:16-40` (`quest_residents`) picks the residents whose lines are voiced: those whose `closed["quest:from:<id>"]` turn is this turn. It reads `ownerId` from this turn's `want_met` entries instead.
  - `rust/card_narrative/imported.rs:246-258` admits `closed` keys with offer prefixes in imported saves. It keeps admitting them, because old exports still carry `closed` and loading deletes it.
- **The stall guard.** `accepted()` (`want.mjs:773-776`, rules 175 and 178) keeps a resident's want while a player holds it. With no held quests it is always false, so it goes with Accept.
- **Away avatars.** `awayPlan` works through `heldOf` (`world.mjs:3038`). It reads known cards instead.

## Conflicts to resolve

Each resolution below is proposed.

### XII The Hanged Man

- XII is proved only by a `drop` without an item (`arcana.json:418-442`), which means setting down a quest or a tarot. With no Discard, nothing proves it.
- Proposal: prove it by letting another finish a card you knew. That is a `did` on a `want_met` entry whose owner and completer are both someone else, for a card you knew. The case P5 guards against becomes a card.
- Alternative: give away the most valuable thing you carry.
- Either way, its `desire` (a quest to "let go of") is rewritten with it.
- XIII The Nameless Card keeps its proof: anything given up for good. `owesGiving` (`arcana-record.mjs:75-78`) opened the fetch quests for it, and it goes with them.

### The Listener's paid spread

- After the Fool, `nextSpread` deals three cards (up, down and locked), and a sale needs a Give for good (`arcana.json:11-19`, `dealSpread` at `arcana.mjs:468-479`).
- The spread becomes one card at a time. The price, the sale and the fetch quests are removed.
- Re-proving a known card at the current scale (today's `up` slot) remains as the deal once no new cards are left.

### The spread shares the quest slots

- `slotsUsed` adds `tarotsHeld`, so a full spread fills every slot (`want.mjs:130-134`).
- `dealSpread` releases every held quest, and `giveFool` evicts the bottom ones (`arcana.mjs:472,486-488`).
- With no slots, nothing competes for them, and this code is removed.

### Items do not level, and per-level art is rare

- `itemLevel` is the authored `startLevel || 1` (`card-game/rarity.mjs:6`). There is no saved item level and no item quest.
- A saved `s.itemLevel[id]` with a validator is added, like `placeMet`. `itemLevel` reads it before `startLevel`, and the tier colour (`cardLevel`, `rarity.mjs:7-8`) shows the rise.
- Per-level art (`rarityForms`) exists only for two Hoppycat avatars (`card-game/rarity-portraits.mjs:8-26`), and the pack schema has no field for an item form. Items level without new art at first, and an item form field is later content work.
- Item cards come from a new optional pack field. No item has a card until content authors one.

## Saves

- Old saves migrate in place on load, as rules 136 and 141 did. The save schema is not bumped: bumping `SAVE_SCHEMA` (`card-game/legacy-saves.mjs:18`) retires every local save, and `carryLocalProgress` (`:40-69`) keeps only `xp`, `level` and `upgrades`, so a bump loses per-world arcana levels (`arcana.level` and `proved`).
- The migration runs at install time, before validation, because `validateWorld` (`world.mjs:3596`) rejects any field the new validators refuse. It lives in a new install module called from `installWants` and `installArcana`.
- What the migration does:
  - A human's `want` and `under` lose their held quests. A held dream quest becomes the pending dream.
  - `closed`, `offered` and a human's `gaveUp` are deleted.
  - A `heard[them]` entry that still matches their live want becomes a quest fact heard from them.
  - The arcana `spread` keeps one slot. A face-down slot keeps its `done`; otherwise the first unproved card of `need` stays, face up. `sale` is deleted, and an open sale deals the next card at once. `level`, `proved`, `did`, `calls` and `callers` stay, and so do the avatar's `upgrades`.
  - A resident's `want` stays as its live card. With P6 it loses `from`, and a drawn want stays until it is met or lost; then the resident's authored cards take over.
  - `placeMet` stays. An item with no saved level reads `startLevel`.
- Shared worlds get the migration through a new rules version (`npm run v2:card:shared:next`, which mints the next bundle, `engine-v188.js` today). The `upgrade` op loads the save through the target bundle's load path first (`card-game/shared-world.mjs:203-214`), so the same install-time migration applies. `FLOOR` (`rust/card_shared/full_floor.rs:23`) stays.
- No new recorded-save fixtures are allowed (`scripts/recorded-saves-allowlist.json` only shrinks). Migration tests build old shapes by playing on the old rules bundle, or by hand.
- Journey checkpoints (`test/journeys/checkpoints.json`) and the released-rules pins change with each rules version. The `quest-cards` journey's `accept` steps are rewritten.

## Scope

- `card-game/app.mjs` (6313) and `card-game/world.mjs` (4197) sit at their line ceilings (`scripts/line-ceilings.json`). Deleting the offer code lowers those ceilings, so the freed lines do not become room for new code. New code goes in new modules:
  - `card-game/quest-deck.mjs`: live cards, completion and levels;
  - `card-game/quest-learn.mjs`: quest facts;
  - `card-game/world/quest-plan.mjs`: the planner over known cards;
  - `card-game/quest-hand.mjs`: card placement in the hand.
- **Deleted:**
  - `world/offers.mjs`, except `placeWant`, `placeMet` and `validPlaceMet` (about 200 of 271 lines), and `card-game/offer-chance.mjs` (29 lines);
  - in `want.mjs`: `MAX_HELD`, `under`, `slotsUsed`, `holdQuest`, `releaseQuest`, `dropQuest`, the `closed` helpers, `accepted` and `validHeard`; with P6, also stall revision and `fillWants`;
  - in `world.mjs`: the Accept plays and the quest and tarot Discard plays (`1677-1726`), the Accept branch (`3354-3366`), and `dropOpenedBoxQuests` and `settleQuests` (`1873-1898`);
  - in `app.mjs`: the offer card (`555-587`), the Accept, Discard and Confirm buttons (`2947-3005`, `3091-3095`) and Accept's no-turn path (`2183-2195`, `880`);
  - the Discard and Accept labels (`card-game/cards.mjs:517,522`), and the `quest.accept` and `quest.abandon` metrics (`card-game/metrics.mjs:15,30-31`, `rust/play_metrics.rs:46`);
  - tests `card-quest-offers`, `card-quest-slots`, `card-resident-offer`, `card-box-quest-accept`, `card-quest-stack`, `card-quest-stack-edges` and `card-quest-stack-shared` (884 lines), plus the Accept half of `card-quest-cards` and `test/helpers/accept-quest.mjs`;
  - most of `v2/scripts/smoke-card-quest-offers.mjs` (470 lines), and its entries in `scripts/fast-smokes.json`.
- **Rewritten:**
  - the arcana flow, place completion, `awayPlan` and companion binding; with P6, the planner;
  - the Rust voice authority and its test in `rust/card_voices.rs`, `rust/card_shared/quest_loop_tests.rs`, `rust/card_shared/full_floor_tests.rs:166-172` (reads `under`), and `rust/card_shared/world_life_tests.rs:142-144`, which fakes a held quest to keep Creon home;
  - the five other tests that import `test/helpers/accept-quest.mjs`;
  - `v2/scripts/smoke-card-quest.mjs` and the journeys.
- Deleted lines count toward the 400-line budget (`scripts/change-budget.json` counts lines added plus deleted). The tests and smokes alone come to about 1,500 lines, which is at least four PRs of deletions on their own.

## Plan

Each step is one or more PRs, and each PR stays under the 400-line budget with deletions counted. Each PR that changes the rules mints the next rules version with its migration. CI runs every test, so a test, smoke or journey that exercises a removed path goes in the same PR as the path or in a pure-deletion PR just before it, never after. The client stops reading a rules export before the rules remove it.

1. **This doc.**
2. **Quest facts.** Add the `quest` source kind and spare live quest facts from eviction. A Talk teaches the speaker's and their held items' cards. `heard` migrates and the High Priestess recounts. Probably two PRs: the rules, then the migration and its tests.
3. **Faces from facts.** The client places cards behind their owners, face up or face down from facts.
4. **Completion by owner.** `want_met` names its owner. The Listener's calls and place levels read it instead of `from`. The Rust `quest_residents` reads the log. `pinnedCompanion` reads the known card, and companions bind on Talk if open question 6 settles that way.
5. **No Accept in the client.** Remove the offer card, the Accept button, the quest Discard button and Accept's no-turn path, and rewrite the `accept` steps of `smoke-card-quest.mjs` and the `quest-cards` journey. The tarot Discard stays until step 6, so XII stays provable. The rules still offer Accept, but nothing in the client plays it.
6. **One arcanum.** Once open question 5 is answered: the spread becomes one card; the price, the sale, the Listener's fetch quests and the tarot Discard are removed; XII gets its new proof in the same PR; the dream becomes pending, so no held quest is left that the rules make on their own. Probably two or three PRs.
7. **Delete the offer tests and the offers smoke.** First rewrite the five other importers of `test/helpers/accept-quest.mjs`. Then delete the helper, the seven test files and most of the offers smoke in pure-deletion PRs, at least four of them.
8. **No Accept in the rules.** Remove the Accept and quest Discard plays and the remaining offers, then `MAX_HELD`, `under`, `closed` and `accepted()`. `awayPlan` reads known cards in the PR that removes `under`. Each PR carries its on-load migration and hand-built tests. The offers file alone is about 200 deleted lines, so this step takes two or three PRs.
9. **Item levels and item cards.** Add the saved item level, its validator and the optional pack field.
10. **Proposals,** each as its own step once decided. P6 is the largest: it puts residents on the shared planner, removes drawn wants, `heardWant`, `fillWants` and stall revision, and merges `awayPlan` into the planner.

## Open questions

1. Does a quest fact passed on second-hand by Talk turn the card face up, or only the owner's own telling? The knowledge system tells facts on by default (`reserveKnowledge`, `knowledge.mjs:259-301`).
2. Does an unplayed avatar (rules 169) carry only its arcanum and work on others' cards, or does it also show a resident card from its pack wants?
3. Do an away avatar's planned plays prove its person's arcanum?
4. Is one level one step on the 0-21 track, or one rank? Above level 5, the bands stretch ranks (`card-game/level-tiers.mjs:6-12`).
5. What is XII The Hanged Man's new proof?
6. Does an escort asker bind as a companion on Talk, or only through Accompany?
7. Who trusts the completer of an item's or a place's card: its holder, the place's residents, or nobody?
8. When an entity has no next card, does it have no card, or a repeatable one?

## Prior art

- **Persona 3-5:** each Social Link (Confidant in Persona 5) stands for one arcana and ranks from 1 to 10, mostly through time spent together, and since Persona 3 the protagonist has been associated with the Fool ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant), [megatenwiki: The Fool](https://megatenwiki.com/wiki/The_Fool)).
- **Fire Emblem:** supports between pairs usually rise C, B, A through acting together, and in most games each level has its own conversation ([Fire Emblem Wiki: Support](https://fireemblemwiki.org/wiki/support)).
- **Hades and Hades II:** prophecies appear on the Fated List as their prerequisites are met, and Hades II tracks progress before then. Keepsakes rank up from rooms cleared while they are equipped ([Hades Wiki](https://hades.fandom.com/wiki/Fated_List_of_Minor_Prophecies/Hades_II), [Fextralife: Keepsakes](https://hades.wiki.fextralife.com/Keepsakes)).
- **Guild Wars 2:** renown hearts are anchored to an area, appear when you walk into range or a scout tells you, and need no NPC interaction to start ([GW2 Wiki: Renown Heart](https://wiki.guildwars2.com/wiki/Task)).
- **Stardew Valley:** completing the Community Center's bundles restores it, with no accept step. The Help Wanted board is accepted and timed ([Stardew wiki mirror: Community Center](https://wiki.stardewvalley.net/Community_Center), [Stardew wiki mirror: Quests](https://wiki.stardewvalley.net/Quests)).
- **Outer Wilds:** the ship log keeps rumor facts, heard in dialogue, apart from explore facts, learned about a place ([New Horizons docs: Ship Log](https://nh.outerwildsmods.com/guides/ship-log)).
- **Minecraft:** a villager has five career levels, and trades fill its experience bar ([Minecraft Wiki: Trading](https://minecraft.fandom.com/wiki/Trading)).
- **Death Stranding:** players can add resources to another player's structures and earn likes for it ([GameSpot](https://gamespot.com/gallery/death-stranding-multiplayer-guide-explaining-how-t/2900-3159/)).
- **Oblivion:** Radiant AI residents killed a quest's merchant before the player arrived, and Bethesda toned the behaviour down ([GamesBeat](https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/)).
- **Mount & Blade II: Bannerlord:** lords follow the same rules as the player and weigh factors such as distance to choose an action ([GameSpace](https://www.gamespace.com/all-articles/news/mount-blade-ii-bannerlord-campaign-ai-dev-blog/)).
