# Quests belong to avatars, items and places

Written against rules 187 (`65cfa23ad`). Paths are relative to the repository root; `card-game/` means `v2/card-game/` and `rust/` means `v2/orchestrator-rust/src/`.

Today a quest is something a person takes. Offers stand at boxes, residents, homes, places and the Listener (`OFFER_KINDS`, `card-game/world/offers.mjs:24`). Accept moves one into a stack of up to three held quests (`MAX_HELD`, `card-game/want.mjs:126`), and Discard sets one down. The arcana spread shares those slots. Residents run a separate machine: one want each, drawn from the world or copied from rumours, which only they pursue.

This design removes taking. Every avatar, item and place can have one quest card, and completing it levels its owner. Characters the world runs and avatars people steer play by the same rules.

## Decisions

1. **Quests are never taken.** Accept, held quest slots (`MAX_HELD`, `under`, `slotsUsed`), quest offers and setting a quest down are removed. A quest belongs to its owner; nobody holds it.
2. **One card per entity.** Each avatar, item and place is able to have a single quest card. Completing it raises its owner one level. An entity need not have a card.
3. **A person's avatar has one face-down arcanum,** like the Fool today (`giveFool`, `card-game/world/arcana.mjs:481-494`). Its proof latches while it is face down, and the Listener turns it.
4. **Everyone else's card sits face down behind them.** A Talk teaches you the speaker's quest and the quests of the items they hold. Once you know a quest, its card is face up for you.
5. **Learning a quest is a knowledge fact.** It uses the knowledge system (`card-game/knowledge.mjs`) that books use; see `docs/design/books.md` on branch `docs/books-design`.
6. **Residents follow the same rules as avatars people steer.** The only difference is who chooses the play: a person or the world's planner. Residents learn quests by Talk, complete any card they know, and level the same way. This replaces quest offers for players, and drawn wants and rumour wants for residents.

## The model

### The card behind each entity

- A resident's card sits after that resident's group in the hand, where the locked card from rules 187 sits today (`besideHolders`, `card-game/quest-card.mjs:269-278`). An item's card sits behind the item, and a place's card behind the place.
- Face down, it shows the locked back (`LOCKED_BACK`, `card-game/locked-box.mjs:18`). Face up, it shows the existing quest face (`questFrame`, `card-game/app.mjs:3634-3708`), worded for the viewer by `questFor` (`card-game/talk-quest.mjs:39-87`).
- Face is per viewer. The same card is face up for everyone who knows it and face down for everyone else.
- There is no quest log. The face-up cards behind their owners are what you know.
- The client reuses `want-card`, `card-back`, `place-edge` and `quest-fold`. Any new class goes through the UI inventory (`card-game/ui-inventory.json`).

### A person's avatar

- The Listener deals the avatar one arcanum, face down, behind the avatar.
- Its proof latches `done` while face down, as `settleSlots` does today (`card-game/world/arcana.mjs:641-662`).
- A Talk with the Listener while called turns it. If it is done, it unlocks, the level rises by one and the next card is dealt face down. If not, it turns face up with its terms and unlocks the moment its proof holds.
- The arcana deck is the avatar's stack. `deckOrder` (`arcana.mjs:290`) already deals the Fool first and the World last. `nextSpread` (`arcana.mjs:401`) becomes a one-card deal: a card not yet unlocked while any remain, otherwise a known card at the current scale (`card-game/arcana.json:20-29`).
- The avatar holds no other quest. Your things' cards sit behind your things.

### Learning a quest

- A quest is a fact in `world.knowledge` with a new source kind, `quest`. Its id names the owner and the card. Its text is the owner's want in one sentence, within `FACT_TEXT_LIMIT` (180 characters).
- When the owner tells it in a Talk, the listener records it as `heard` with the owner as teller (`known[actor][fact]`, `knowledge.mjs:565-580`).
- A Talk teaches the speaker's card and the cards of the items the speaker holds. The gates in `revealed` stay, including authored `minTrust` (`card-game/want-talk.mjs:79-108`).
- The `heard` map (`want.mjs:892-908`) and `toldWant` (`talk-quest.mjs:131-134`) are replaced by reading the fact. II The High Priestess (`arcana.json:74-86`) counts owners whose quest you learned from them.
- A live card's fact does not age out. The store evicts the oldest non-topic fact when full (`knowledge.mjs:76-133`), so quest facts are spared the way topic facts are. When a card completes, its fact may age out and the next card is a new fact.
- Residents learn the same way. `talkQuest` stops requiring a player (`talk-quest.mjs:120-129`).
- Knowledge validation is exact-shape (`validKnowledge`, `knowledge.mjs:470-622`), so the new source kind is a rules change.

### Completing a card

- After each play, the rules check the live card of each entity the play touched, with the existing `questMet` and `stepMet` (`want.mjs:500-568`). State verbs read the world; act verbs need the play.
- The completer is the play's actor; for a give, the giver. A card already met before the play pays nobody (rules 150).
- The owner rises one level. The next card in its stack becomes live, face down for everyone.
- The `want_met` log entry (`card-game/world.mjs:765-785`) gains `ownerId`. The Listener's calls, place levels and the voice authority read that entry.
- A card whose target is gone for good is passed over without a level (`lostOf` and `settleLost`, `want.mjs:264-275,777-791`). The trust lost when a wanted thing is lost in its owner's sight stays.
- There are no timers. Stalled wants are no longer revised (`reviseStalledWants`, `want.mjs:724`), so a card stays until it completes or is lost.

### Residents

- The planner (`wantPlan`, `world.mjs:3096-3305`) chooses among the cards the resident knows: its own first, then the cards it has learned from others.
- Away and unplayed avatars use the same planner. `awayPlan` (`world.mjs:2996-3045`) reads known cards instead of `heldOf`.
- A resident's stack is its authored `want`, then its staged `wants` in authored order, each gated by its `when` (`want-talk.mjs:22-43`).
- `fillWants` (`want.mjs:811`), the draw from `wantCandidates` and `heardWant` (`card-game/world/rumours.mjs:143-201`) are removed. Rumours no longer make wants.
- `levelAtHome` stays: a completion's level is banked until the resident reaches its home (`want.mjs:95-110`).

## Proposals

These are not decided. Each names the research that supports it.

### P1. Completing another's quest earns their trust, and trust feeds the arcana

- Completing another actor's card raises the owner's trust in the completer by one, capped at 3. Rules 176 already does this for residents (`helped`, `want.mjs:641-662`). Arcana stay outside it, because nobody else can complete them.
- Each distinct owner whose trust you earn this way counts toward the Listener's call (`countResidentQuest`, `card-game/world/arcana-record.mjs:47-54`, `CALLS = 3`). This replaces "three accepted resident quests".
- Later, an arcanum could bind to a resident who trusts you. `bindingOf` (`arcana.mjs:226`) already pins roles per card.
- Fire Emblem supports grow when a pair acts together, step through C, B and A, and open each step with a conversation. That is a close match for trust 0-3 ([Fire Emblem Wiki: Support](https://fireemblemwiki.org/wiki/support)).
- Persona ties each bond to an arcanum, and bonds are what make the protagonist stronger. A rival who refuses bonds cannot grow ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant), [megatenwiki: Wild Card](https://megatenwiki.com/wiki/Wild_Card)).

### P2. Completing a quest without knowing it was one still counts

- A card met by someone who did not know it still completes. It turns face up for the completer as it completes, showing the deed that met it.
- The log line names the deed, and the narration, which a language model writes from the prompt, can tell it.
- This is already true for a resident's trust and rank-up: `helped` checks neither `heard` nor Accept. It is not true today for the Listener's call, place levels, `closed` or companion binding.
- Hades II tracks a prophecy's progress before the prophecy is shown, so nothing has to be redone once it appears ([Hades Wiki: Fated List (II)](https://hades.fandom.com/wiki/Fated_List_of_Minor_Prophecies/Hades_II)).
- Stardew's Help Wanted board is the opposite case. Gathering requests count only items gathered after accepting ([Stardew wiki mirror: Quests](https://wiki.stardewvalley.net/Quests)). That is the friction this design removes.

### P3. A place shows its card when you stand in it, and a loose item when you pick it up

- Standing in a place makes you a witness of its card, recorded as a `witnessed` fact. Taking a loose item does the same for the item's card. A held item's card is taught by its holder's Talk (decision 4).
- Guild Wars 2 renown hearts stay hidden until a scout tells you or you walk into range. Entering the area shows the tasks, and there is no accept step ([GW2 Wiki: Renown Heart](https://wiki.guildwars2.com/wiki/Task)).
- This is the least settled point. Today a place offer needs you to stand there and select the place card (`placeOffer`, `offers.mjs:132-144`). Take creates no knowledge (`knowledge.mjs:135-163`).
- The alternative is that a place's card is taught by a resident who lives there, and a loose item's card by whoever saw it last.

### P4. Depth comes from a stack of cards behind one active card

- Each entity has an ordered stack with one card per level. Only the top card is live, and the next one comes up after a level.
- The edges behind the top card (`stackEdges`, `app.mjs:1769`) show how many cards remain, face down.
- Stacks come from what exists:
  - residents: the authored want and staged wants;
  - places: the missing things from `placeWant` (`offers.mjs:83-113`), one at a time, which already gives one level per thing laid back (`placeRank`, `want.mjs:87-88`);
  - avatars: the arcana deck;
  - items: authored cards.
- Persona links run through ranks 1-10 ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant)). Minecraft villagers have five career levels, each shown by a badge, and any player's trades fill the bar ([Minecraft Wiki: Trading](https://minecraft.fandom.com/wiki/Trading)).

### P5. Rules for residents completing what a person was working toward

- **Shared credit.** When a card completes, everyone who knew it gains the owner's trust, not only the completer. The level goes to the owner as always.
  - Guild Wars 2 gives full reward to everyone who meaningfully contributes ([GW2 Wiki: Design Manifesto](https://wiki.guildwars2.com/wiki/Guild_Wars_2_Design_Manifesto)).
  - Death Stranding credits players who help with someone else's structure ([GameSpot](https://gamespot.com/gallery/death-stranding-multiplayer-guide-explaining-how-t/2900-3159/)).
- **A person's own arcanum is proved only by their own deeds.** Residents can only help indirectly, for example by trusting them for V The Hierophant.
  - Bethesda pulled Oblivion's Radiant AI back after residents killed a quest contact before the player arrived ([GamesBeat](https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/)).
- **The planner ranks a card that a person knows below its other choices.** Mount & Blade II lords follow the player's rules and choose by scoring actions ([GameSpace](https://www.gamespace.com/all-articles/news/mount-blade-ii-bannerlord-campaign-ai-dev-blog/)).
- **A resident's completion turns up the next card.** The person loses one goal and sees a new one. When an Animal Crossing favor lapses, the villager fetches the thing and says so ([Nookipedia: Favor](https://www.nookipedia.com/wiki/Favor)).

## What exists and what changes, per source

| Source | Today | Under this design |
|---|---|---|
| Box | An offer at a shut box that is not your door, taken by Accept (rules 159). It asks for the lock's goal (`boxWant`, `card-game/world/boxes.mjs:473`). | The box's own card is its lock's goal. Completing it opens the box (`creditOpened` still feeds I The Magician and XVI The Tower) and levels the box. |
| Resident | Told by Talk, then taken by Accept (rules 146, 187). | The resident's live card. Talk teaches it, and nobody takes it. |
| Home | Held automatically at your own door: bring your belonging home (`offers.mjs:157-167`). | The belonging's own card, known to its avatar. |
| Listener | Fetch quests held automatically during a sale (`fetchPool`, `offers.mjs:230-271`). | Removed with the price. The Listener turns the arcanum and asks for nothing. |
| Place | Taken by Accept when you stand there (rules 174). `placeMet` is the level. | The place's card asks for one missing thing laid back. Laying it back levels the place, whoever does it. |
| Dream | "Rest at home", held after a level rise (`sleepQuest`, `want.mjs:216-226`). | Not a quest. A level rise sets a pending dream on the arcana record, and waking at home gives the glimpse (`wake`, `want.mjs:227-249`). |
| Arcana spread | Up to three cards, priced by a Give to the Listener, filling quest slots. | One face-down card. |

## What depends on an accepted quest today

- **The Listener's calls.** `countResidentQuest` fires only for a traveller's met `quest:from:` quest (`want.mjs:674`). It fires from the `want_met` owner instead: any completed card whose owner is another actor, or with P1, any owner whose trust you earned.
- **Place levels.** Only a met, held `quest:place:` quest adds to `placeMet` (`want.mjs:675-680`). The place card's completion adds the laid thing, whoever laid it.
- **Companion binding.** `bindAsker` (`world.mjs:1899-1930`) binds an escort quest's asker on Accept when they trust you at 2 or more. It binds on the Talk that teaches an escort card instead, with the same checks. `pinnedCompanion` (`talk-quest.mjs:108`) reads the known card instead of the held one.
- **The `closed` record** (`want.mjs:173-189`). Its job of stopping repeat offers goes with the offers. `closedBy`, `closedAny`, `MAX_CLOSED` and `validClosed` are removed. Its two Rust readers change:
  - `rust/card_voices/authority.rs:16-41` (`quest_residents`) voices residents whose `closed["quest:from:<id>"]` turn is this turn. It reads `ownerId` from this turn's `want_met` entries instead.
  - `rust/card_narrative/imported.rs:246-258` admits `closed` keys with offer prefixes in imported saves. It keeps admitting them, because old exports still carry `closed` and loading deletes it.
- **The stall guard.** `accepted()` (`want.mjs:773-776`, rules 175 and 178) keeps a resident's want while a player holds it. It goes with stall revision.
- **Away avatars.** `awayPlan` works through `heldOf`. It moves to the shared planner.

## Conflicts to resolve

### XII The Hanged Man

- XII is proved only by a `drop` without an item (`arcana.json:418-441`), which means setting down a quest or a tarot. With no Discard, nothing proves it.
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
- Per-level art (`rarityForm`) exists only for two Hoppycat avatars (`card-game/rarity-portraits.mjs:8-24`), and the pack schema has no field for an item form. Items level without new art at first, and an item form field is later content work.
- Item cards come from a new optional pack field. No item has a card until content authors one.

## Saves

- Old saves migrate in place on load, as rules 134, 136 and 141 did. The save schema is not bumped: bumping `SAVE_SCHEMA` (`card-game/legacy-saves.mjs:18`) retires every local save, and `carryLocalProgress` (`:40-69`) keeps only `xp`, `level` and `upgrades`. Per-world arcana levels (`arcana.level` and `proved`) would be lost.
- The migration runs at install time, before validation, because `validateWorld` (`world.mjs:3596`) rejects any field the new validators refuse. It lives in a new install module called from `installWants` and `installArcana`.
- What the migration does:
  - A human's `want` and `under` lose their held quests. A held dream quest becomes the pending dream.
  - `from`, `closed`, `gaveUp` and `offered` are deleted.
  - A `heard[them]` entry that still matches their live want becomes a quest fact heard from them.
  - The arcana `spread` keeps one slot. A face-down slot keeps its `done`; otherwise the first unproved card of `need` stays, face up. `sale` is deleted, and an open sale deals the next card at once. `level`, `proved`, `calls`, `callers` and `upgrades` stay.
  - A resident's `want` stays as its live card, minus `from`. A drawn want stays until it is met or lost, and then the stack takes over.
  - `placeMet` stays. An item with no saved level reads `startLevel`.
- Shared worlds get the migration through a new rules version (`npm run v2:card:shared:next`, which mints `engine-v188.js`). The `upgrade` op runs the target bundle's load path (`card-game/shared-world.mjs:205-214`), so the same install-time migration applies. `FLOOR` (`rust/card_shared/full_floor.rs:23`) stays.
- No new recorded-save fixtures are allowed (`scripts/recorded-saves-allowlist.json` only shrinks). Migration tests build old shapes by playing on the old rules bundle, or by hand.
- Journey checkpoints (`test/journeys/checkpoints.json`) and the released-rules pins change with each rules version. The `quest-cards` journey's `accept` steps are rewritten.

## Scope

- `card-game/app.mjs` (6313) and `card-game/world.mjs` (4197) sit at their line ceilings (`scripts/line-ceilings.json`). Deleting the offer code lowers those ceilings, so the freed lines do not become room for new code. New code goes in new modules:
  - `card-game/quest-deck.mjs`: stacks, live cards, completion and levels;
  - `card-game/quest-learn.mjs`: quest facts;
  - `card-game/world/quest-plan.mjs`: the planner over known cards;
  - `card-game/quest-hand.mjs`: card placement in the hand.
- **Deleted:**
  - `world/offers.mjs`, except `placeWant`, `placeMet` and `validPlaceMet` (about 200 of 271 lines), and `card-game/offer-chance.mjs`;
  - in `want.mjs`: `MAX_HELD`, `under`, `slotsUsed`, `holdQuest`, `releaseQuest`, `dropQuest`, the `closed` helpers, `from`, `accepted`, stall revision and `fillWants`;
  - in `world.mjs`: the Accept plays and the quest and tarot Discard plays (`1677-1726`), the Accept branch (`3354-3366`) and `settleQuests` (`1873-1898`);
  - in `app.mjs`: the offer card (`555-587`), the Accept, Discard and Confirm buttons (`2947-3000`, `3091-3095`) and Accept's no-turn path (`2183-2195`, `880`);
  - labels at `card-game/cards.mjs:517-522`, and the `quest.accept` and `quest.abandon` metrics (`card-game/metrics.mjs`, `rust/play_metrics.rs:46`);
  - tests `card-quest-offers`, `card-quest-slots`, `card-resident-offer`, `card-box-quest-accept`, `card-quest-stack`, `card-quest-stack-edges` and `card-quest-stack-shared`, plus the Accept half of `card-quest-cards` and `test/helpers/accept-quest.mjs`;
  - most of `v2/scripts/smoke-card-quest-offers.mjs` (470 lines), and its entries in `scripts/fast-smokes.json`.
- **Rewritten:**
  - the arcana flow, place completion, the planner, `awayPlan` and companion binding;
  - the Rust voice authority, `rust/card_shared/quest_loop_tests.rs` and `rust/card_shared/world_life_tests.rs:143`, which fakes a held quest to keep Creon home;
  - the six tests that import `test/helpers/accept-quest.mjs`;
  - `v2/scripts/smoke-card-quest.mjs` and the journeys.
- Deleted lines count toward the 400-line budget (`scripts/change-budget.json` counts lines added plus deleted). The tests and smokes alone come to about 1,500 lines, so deletions are spread across the phases that make them obsolete.

## Plan

Each step is one PR under the 400-line budget. Each step that changes the rules mints the next rules version, with its migration.

1. **This doc.**
2. **Quest facts.** Add the `quest` source kind. A Talk teaches the speaker's and their held items' cards, and residents learn too. `heard` migrates and the High Priestess recounts. The client reads facts for face up and face down.
3. **Completion by owner.** `want_met` names its owner. The Listener's calls and place levels read it instead of `from`. The Rust `quest_residents` reads the log. Companions bind on Talk.
4. **No Accept in the rules.** Remove the Accept and quest Discard plays, `MAX_HELD`, `under`, `closed` and the offers, with the on-load migration and tests built by hand.
5. **No Accept in the client.** Remove the offer card and the Accept and Discard buttons, and place cards behind their owners.
6. **Delete the dead tests and the offers smoke.** These are pure deletions and take two or three PRs.
7. **One arcanum.** The spread becomes one card, and the price, the sale and the fetch quests are removed. XII gets its new proof, and the dream becomes pending.
8. **Residents on the shared planner.** Remove drawn wants and `heardWant`, and merge `awayPlan` into the planner.
9. **Item levels and item cards.** Add the saved item level, its validator and the optional pack field.
10. **Proposals,** each as its own step once decided.

## Open questions

1. Does a quest fact passed on second-hand by Talk turn the card face up, or only the owner's own telling? The knowledge system tells facts on by default (`reserveKnowledge`, `knowledge.mjs:259-301`).
2. Does an unplayed avatar (rules 169) carry only its arcanum and work on others' cards, or does it also show a resident card from its pack wants?
3. Do an away avatar's planned plays prove its person's arcanum?
4. Is one level one step on the 0-21 track, or one rank? Above level 5, the bands stretch ranks (`card-game/level-tiers.mjs:6-12`).
5. What is XII The Hanged Man's new proof?
6. Does an escort asker bind as a companion on Talk, or only through Accompany?
7. Who trusts the completer of an item's or a place's card: its holder, the place's residents, or nobody?
8. When an entity's stack runs out, does it have no card, or a repeatable one?

## Prior art

- **Persona 3-5:** each bond is an arcanum that ranks up through time spent together, with no quest accepted, and the protagonist is the Fool ([megatenwiki: Confidant](https://megatenwiki.com/wiki/Confidant), [megatenwiki: The Fool](https://megatenwiki.com/wiki/The_Fool)).
- **Fire Emblem:** supports between pairs rise C, B, A through acting together, and each step opens with a conversation ([Fire Emblem Wiki: Support](https://fireemblemwiki.org/wiki/support)).
- **Hades and Hades II:** the Fated List is never accepted. Hades II counts progress before a prophecy is shown, and keepsakes rank up while carried ([Hades Wiki](https://hades.fandom.com/wiki/Fated_List_of_Minor_Prophecies/Hades_II), [Fextralife: Keepsakes](https://hades.wiki.fextralife.com/Keepsakes)).
- **Guild Wars 2:** renown hearts belong to a place, show themselves when you walk into range, and have no accept step ([GW2 Wiki: Renown Heart](https://wiki.guildwars2.com/wiki/Task)).
- **Stardew Valley:** the Community Center is a place whose needs level it with no accept step. The accepted, timed Help Wanted board is the filler ([Stardew wiki mirror: Community Center](https://wiki.stardewvalley.net/Community_Center), [Stardew wiki mirror: Quests](https://wiki.stardewvalley.net/Quests)).
- **Outer Wilds:** there are no quests. The ship log keeps facts heard in dialogue apart from facts learned by going there ([New Horizons docs: Ship Log](https://nh.outerwildsmods.com/guides/ship-log)).
- **Minecraft:** a villager's career level is a bar that any player's trades fill ([Minecraft Wiki: Trading](https://minecraft.fandom.com/wiki/Trading)).
- **Death Stranding:** anyone's materials level a shared structure, and helpers are credited ([GameSpot](https://gamespot.com/gallery/death-stranding-multiplayer-guide-explaining-how-t/2900-3159/)).
- **Oblivion:** residents who pursued their own goals killed quest contacts, and the system was pulled back ([GamesBeat](https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/)).
- **Mount & Blade II: Bannerlord:** lords follow the player's rules and choose by scoring actions ([GameSpace](https://www.gamespace.com/all-articles/news/mount-blade-ii-bannerlord-campaign-ai-dev-blog/)).
