# Quests belong to avatars, items and places

## Tarot direction — 25 November 2026

Revealing a new tarot adds it to the avatar's reusable pack while its current
level proof can still be open. Later level spreads draw from that pack,
introducing at most one unfamiliar card per deal. Known cards can return with
fresh proofs.

Pack membership, collection and level progress are separate. The level comes
from the spread's required proofs. Collect claims the available reward.
Face-down and locked slots keep their backs until their reveal conditions hold.
The individual tarot website proposal (#3166) is closed. The cards belong in play.

The quest baseline is rules 187 (`65cfa23ad`). Tarot behavior is checked against
rules 212. Paths are relative to the repository root. `card-game/` means
`v2/card-game/` and `rust/` means `v2/orchestrator-rust/src/`.

Today a quest is something a person takes. Offers stand at boxes, residents, homes, places and the Listener (`OFFER_KINDS`, `card-game/world/offers.mjs:24`). Accept moves one into a stack of up to three held quests (`MAX_HELD`, `card-game/want.mjs:126`); home and Listener offers are held without it. Discard sets one down. The arcana spread shares those slots. Residents run a separate machine: each has one want, authored, staged, taken from a rumour or drawn from the world (`nextWant`, `want.mjs:439-467`), and the world's planner pursues it.

This design removes taking. Every avatar, item and place can have one live
owner quest card, and completing it levels its owner. A person's tarot spread
tracks their own level. The decisions and the newer tarot direction set the
design, with the proposed defaults under P1–P6 and Open questions.

## Decisions

1. **Quests belong to their owners.** Replace quest Accept, offers, Discard and the shared held-quest slots with owner cards. Keep the tarot Collect action.
2. **One live owner quest per entity.** Each avatar, item and place can have a quest card. Its completion raises its owner one level.
3. **A person's tarot spread draws from a reusable pack.** The Listener deals the first Fool face down. Later spreads reuse revealed cards and introduce at most one unfamiliar card.
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

- The Listener deals the first Fool face down behind the avatar. A Talk with
  the Listener while called turns it over.
- Later spreads have up to three cards. A spread can include a known card at
  the current scale, a known bonus and an unfamiliar locked card. If the
  unfamiliar pool is exhausted, a known card can return locked at the next
  scale. The World is reserved for level 20 after the rest of the pack.
- A reveal admits a card to the reusable pack. Level progress follows the
  required proofs in the spread. Bonus slots are optional.
- Quests attached to your things sit behind those things. The tarot spread
  has room of its own.

### Tarot in rules 212

The current rules expose a reward when a slot's proof is fulfilled or the
Listener turns the introductory Fool. Collect records ownership in
`upgrades`, records the proof if earned and resolves the slot. It can
trigger a level rise when that resolves the final required slot. This
includes the first Fool, whose Collect completes level 1 while its later
proof stays open. See `nextSpread`, `collectTarot` and `settleSlots` in
`card-game/world/arcana.mjs` and `test/card-arcana-pack.test.mjs`.

### Learning a quest

- A quest is a fact in `world.knowledge` (`card-game/knowledge.mjs`), the store Talk already uses to pass facts on, with a new source kind, `quest`, beside `event`, `topic` and the rest. How a character learned it stays the separate memory kind (`witnessed`, `heard`, or the `read` kind proposed in `docs/design/books.md`, #3088), so a book can teach a quest.
- The fact's id names the owner and the card. Its text is the owner's want in one sentence, within `FACT_TEXT_LIMIT` (180 characters).
- When the owner tells it in a Talk, the listener records it as `heard` with the owner as teller (`tell`, `knowledge.mjs:302-318`; the entry's shape is checked at `:565-580`).
- A Talk teaches the speaker's card and the cards of the items the speaker holds. The gates in `revealed` stay, including authored `minTrust` (`card-game/want-talk.mjs:79-108`).
- The `heard` map (`validHeard`, `want.mjs:890-908`) and `toldWant` (`talk-quest.mjs:131-134`) are replaced by reading the fact. II The High Priestess (`arcana.json:72-84`, a count of `heard`) counts owners whose quest you learned from them.
- A live card's fact does not age out. When the store is full, `retainFact` evicts the oldest fact that is neither a topic nor pinned grievance evidence (`knowledge.mjs:112-133`), so quest facts are spared the way topic facts are. When a card completes, its fact may age out. Topic, book-claim and live quest facts would all be spared, so they need one shared cap below the 256-fact store; otherwise `retainFact` stores no new fact once they fill it.
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

Accepted on 2026-11-23, with the defaults under Open questions. Each names the research that supports it.

### P1. Completing another's quest earns their trust, and trust feeds the arcana

- Completing another actor's card raises the owner's trust in the completer by one, capped at 3 (`gainTrust`, `card-game/world/company.mjs:79-84`). Rules 176 already does this when someone meets a resident's want (`helped`, `want.mjs:641-662`). Arcana use their own proof and level rules.
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

### P4. Depth comes from a stack of owner quests behind one active card

- Each owner can have an ordered stack of quest cards. Only the top card is live, and the next one comes up after a level.
- The edges behind the top card (`stackEdges`, `app.mjs:1769`) show how many cards remain, face down.
- Stacks come from what exists:
  - residents: the staged wants, or the single authored want;
  - places: the missing things from `placeWant` (`offers.mjs:83-113`), one at a time, which already gives one level per thing laid back (`placeRank`, `want.mjs:87-88`);
  - items: authored cards.
- Persona links run through ranks 1-10 ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant)). Minecraft villagers have five career levels, shown by the badge they wear, and each trade adds to the villager's own experience bar ([Minecraft Wiki: Trading](https://minecraft.fandom.com/wiki/Trading)).

### P5. Rules for residents completing what a person was working toward

These apply only with P6.

- **Shared credit.** When a card completes, everyone who knew it gains the owner's trust, not only the completer. The level goes to the owner as always.
  - Guild Wars 2 gives everyone seriously involved in a fight the full experience and loot ([GW2 Wiki: Design Manifesto](https://wiki.guildwars2.com/wiki/Guild_Wars_2_Design_Manifesto)).
  - In Death Stranding, players can add resources to another player's bridges or roads and earn likes for it ([GameSpot](https://gamespot.com/gallery/death-stranding-multiplayer-guide-explaining-how-t/2900-3159/)).
- **Personal arcana usually require the traveler's deeds.** Residents can supply
  a condition, such as trust for V The Hierophant. The replacement proof for
  XII explicitly uses another actor's completion of a quest the traveler knew.
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
| Listener | Fetch quests held automatically during a sale, or while a face-up card asks for something given up (`fetchPool`, `offers.mjs:173-184,230-271`). | Remove fetch quests and the price. The Listener still deals the Fool and later spreads. |
| Place | Taken by Accept when you stand there (rules 174). `placeMet` is the level. | The place's card asks for one missing thing laid back. Laying it back levels the place (with P2, whoever does it). |
| Dream | "Rest at home", held after a level rise (`sleepQuest`, `want.mjs:216-226`). | Not a quest. A level rise sets a pending dream on the arcana record, and waking at home gives the glimpse (`wake`, `want.mjs:227-249`). |
| Arcana spread | Up to three cards, priced by a Give to the Listener, filling quest slots. | A separate spread of up to three cards from the reusable pack, with at most one unfamiliar card. |

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

- XII currently checks for a `drop` without an item, which is the action for
  setting down a quest or a tarot. See `card-game/arcana.json`.
- The default replacement proves XII when another actor finishes an owner's
  quest the traveler already knew. The `want_met` entry identifies the quest
  and its owner and completer, both of whom are other actors. Give that
  achievement its own proof key and ship it with the new desire before or
  alongside removal of the Discard plays that satisfy the old proof.
- Alternative: give away the most valuable thing you carry.
- XIII The Nameless Card keeps its proof: anything given up for good. `owesGiving` (`arcana-record.mjs:75-78`) opened the fetch quests for it, and it goes with them.

### The Listener's paid spread

- After the Fool, a sale currently asks for a Give for good. Remove the price,
  the sale and the related fetch quests. Keep the reusable spread, fresh
  proofs for known cards and the limit of one unfamiliar card per deal.
  See `price` in `card-game/arcana.json` and `nextSpread` in
  `card-game/world/arcana.mjs`.

### The spread shares the quest slots

- `slotsUsed` adds `tarotsHeld`, so a full spread fills every slot. See
  `card-game/want.mjs`.
- `dealSpread` releases every held quest, and `giveFool` releases the last held
  quest until there is room. See `card-game/world/arcana.mjs`.
- The spread keeps its own deal size and progress. Remove the shared slot
  accounting and both quest eviction paths.

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
  - Keep every valid arcana `spread` slot, including its face, binding and
    proof progress, with the record's `need`, `done`, `level`, `proved`,
    `did`, `calls` and `callers` and the avatar's `upgrades`. When
    `sale` and `paid` are retired, preserve any pending deal and deal it
    for free when the spread is ready. A waiting reward stays collectable.
    Migrate ownership, waiting rewards and earned proofs as separate records.
  - Preserve earned XII rewards, proofs and levels. Check unfinished XII
    slots against the replacement proof using its own evidence.
  - A resident's `want` stays as its live card. With P6 it loses `from`, and a drawn want stays until it is met or lost; then the resident's authored cards take over.
  - `placeMet` stays. An item with no saved level reads `startLevel`.
- Shared worlds get the migration through a new rules version (`npm run v2:card:shared:next`, which mints the next free bundle; the books design needs one too). The `upgrade` op loads the save through the target bundle's load path first (`card-game/shared-world.mjs:203-214`), so the same install-time migration applies. `FLOOR` (`rust/card_shared/full_floor.rs:23`) stays.
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
  - in `world.mjs`, the quest Accept and Discard plays, `dropOpenedBoxQuests` and `settleQuests`. Tarot Collect keeps its play and its no-turn path. Remove tarot Discard once the replacement XII proof is available.
  - in `app.mjs`, the offer card and its Accept, Discard and Confirm buttons. Preserve tarot Collect and remove tarot Discard with the rule change.
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
5. **Remove quest offers from the client.** Remove the offer card and quest Accept, and rewrite the quest `accept` steps in `smoke-card-quest.mjs` and the `quest-cards` journey. Keep tarot Collect and retain quest and tarot Discard until the proof change in step 6.
6. **Give tarot its own spread.** Keep the reusable pack and remove the price, sale and fetch quests. Make the dream pending. Before changing the rules 212 sequence, decide what reveals a newly dealt locked card ahead of its level proof and how the first Fool advances under the separate reveal and proof rules. Ship XII's replacement proof, desire, migration and tests before or alongside removal of quest and tarot Discard from the client. Test both a saved XII reward awaiting Collect and a fresh play of the new proof.
7. **Delete the offer tests and the offers smoke.** First rewrite the five other importers of `test/helpers/accept-quest.mjs`. Then delete the helper, the seven test files and most of the offers smoke in pure-deletion PRs, at least four of them.
8. **Remove quest acceptance from the rules.** Remove quest Accept, quest Discard and the remaining offers, then `MAX_HELD`, `under`, `closed` and `accepted()`. Keep tarot Collect. `awayPlan` reads known cards in the PR that removes `under`. Each PR carries its on-load migration and hand-built tests. The offers file alone is about 200 deleted lines, so this step takes two or three PRs.
9. **Item levels and item cards.** Add the saved item level, its validator and the optional pack field.
10. **Proposals,** each as its own step once decided. P6 is the largest: it puts residents on the shared planner, removes drawn wants, `heardWant`, `fillWants` and stall revision, and merges `awayPlan` into the planner.

## Open questions

Each has a default, settled on 2026-11-23 so building can start. Any of them can be reopened.

1. A quest fact learned second-hand, told on by Talk or `read` in a book, turns the card face up, the same as the owner's own telling. Knowing is knowing (`reserveKnowledge`, `knowledge.mjs:259-301`).
2. An unplayed avatar (rules 169) carries its tarot spread and works on others' quest cards.
3. An away avatar's planned plays prove its person's arcanum, as P6 implies.
4. One level is one step on the 0-21 track (`card-game/level-tiers.mjs:6-12`).
5. XII The Hanged Man is proved when someone else finishes a card you knew.
6. An escort asker binds as a companion only through Accompany.
7. An item's holder trusts the completer of the item's card. A place's card earns no trust; the place's level is the reward.
8. An entity with no next card has no card.

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
