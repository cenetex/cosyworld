# Books teach what they say, and characters remember it

A book is a rare item that a character finds and reads. Reading teaches the reader a few claims, and each claim stays tied to the book and its in-world author. The reader keeps those claims after the book is gone and can tell them to others. When two books disagree, their readers end up believing different things.

This design replaces the holder-context lore of rules 186 (#3077). It covers every text item in the packs, the knowledge changes, risks, saves and a plan of small PRs. Quests are designed in `docs/design/quests.md` (branch `docs/quests-design`). The two docs share the knowledge store: there, learning a quest is a knowledge fact, and here a book can teach a quest (proposal 1).

`card-game/` means `v2/card-game/` and `rust/` means `v2/orchestrator-rust/src/`. Other paths start at the repo root. "The prompt" is the text the Rust text route builds and sends to a language model. "Narration" is the text the model generates from it.

## Decisions

- No canon is injected into characters. A character knows only what it witnesses, is told, or reads. Canon is not a goal in itself, and pushing it into entities is wrong.
- Books are rare and discoverable.
- Every text item is accounted for. That includes the writ, the burial decree, petitions, accounts, records, tablets, labels, slips and maps as well as the six lore books.
- A book a character finds becomes something that avatar remembers. The knowledge outlives the object and can be told on, so books that disagree leave their readers disagreeing.
- Packs carry no hand-authored prose. Narration is text a language model generates, so a book is not pages of prose.
- Claims that contradict each other belong to different branches of the story (2026-11-24). Truth follows the world's branch, not canon, and a character learns it only by witnessing (see Branch truth).
- The holder-context design of rules 186 (#3077) is replaced, not extended. Under it, pages reach the prompt by custody and nobody remembers them. The design returns to the principle of #1629 (2026-10-31): lore lives in books that are found and read, and nothing is injected.

The proposals were accepted on 2026-11-23, with the defaults under Open questions. Held item text is removed (open question 9).

## Where things stand

Rules 187 is in force (`rust/card_shared/engine.rs:16`).

- 32 items carry writing: 19 Greek, 8 Hoppy Cat, 2 RatiRadio and 3 Willows. Lonely Forest, Badger Forest and the hub have none. Six of the 32 are lore books with 253 pages and 42,339 characters. Five are Greek, and the sixth is the Willows River Notebook.
- Books are not rare and nobody finds them. The Chorus Elder starts out holding the Chronicle, the City Roll and the Songbook. Myrto the Shipmaster holds the Guide and the Cargo List. The River Notebook lies face up on the Willows camp floor. No item in any pack is `sealed`, so the rules put no text item face down (`card-game/pack-schema.mjs:1394-1403`).
- Lore reaches the prompt by custody. Each turn `lorePages` gives up to 3 pages and 2,400 characters to the holder, to the book itself and to the place it lies in (`card-game/pack-registry.mjs:362-388`, `card-game/narrative.mjs:676`). Nobody reads anything and nothing is remembered. When the book changes hands, the pages go with it.
- The pages are the old card prose under a new name. The Chronicle is the former choice text, with one page for each of the 78 Greek choices. The City Roll is the former avatar text, the Guide the former place text and the Cargo List the former item text. The five Greek books wear the art of retired documents, such as the Marathon Record and the Guard's Tablet.
- Pages skip three filters: the covered-card blur (`card-game/speech-knowledge.mjs:185-258`), the unfound-name blur (`:324-360`) and the Rust known-names set (`rust/card_narrative.rs:1688-1768`). A covered book's pages still reach its holder's prompt while the book's name is listed as concealed.
- Residents are kept away from books only in part. They cannot take, drop, give, ask for or eat one (`card-game/world.mjs:1521`). They can still carry books, trade them and threaten over them, and they get the pages as holders.
- The knowledge system already provides the remembered half: saved facts, memory for each person, and one fact told per Talk, for residents and avatars alike (`card-game/knowledge.mjs`, `card-game/world.mjs:885-927`). It has no "read" kind. A fact is one sentence of at most 180 characters, and the whole world stores 256 facts.

## What a book is

Proposal. Without pages of prose, a book needs something else to carry. An authored book has three parts:

- **An in-world author.** This is an avatar of the pack or a named issuer, such as a city or a household. The claims are the author's.
- **One to three claims.** Each claim is one sentence within the 180-character fact limit, with a stable id. A claim states what its author asserts, never what is true in the world. It can be `about` a place, person or item. A book can also carry a quest card's fact (proposal 1).
- **A face, a title and a lifecycle.** The face is the card art. The lifecycle says whether reading uses the book up (proposal 4).

That is all a pack authors for a book. The research supports keeping it this small. The makers of The Case of the Golden Idol kept clue text to what a solution needs, and a written will that stated the answer made one case trivial ([Game Developer, Golden Idol](https://www.gamedeveloper.com/design/case-of-the-golden-idol)). Caves of Qud shows one event of a sultan's history per shrine, painting or engraving ([Grinblat 2017](https://pcgworkshop.com/archive/grinblat2017subverting.pdf)). Bethesda keeps its lore deniable: it comes from in-world points of view that may conflict, and the studio avoids declaring one of them true ([UESP, The Loremasters](https://app.uesp.net/wiki/General:The_Loremasters,_How_developers_keep_their_fictions_straight)).

Two more kinds of book come from play, not from a pack:

- **Records.** The rules write a record from what happened. The Burial Account already lists the three choices it records (`records`, `card-game/pack-registry.mjs:985-1003`). Its claims become those choices' log sentences, such as "Vale gives the Burial Shovel to Antigone at Polynices' Hollow.", which are already valid facts. The witness tablets are gated by choices, so each one exists only after a branch choice has picked its account.
- **What characters write.** A character holding a writable item, such as a label, a letter or a blank page, writes down one fact it knows. The item gains a claim with the writer as its author. Hoppy Cat's choices already describe this ("Penny writes Ledger's name", "Static signs"), but today the written words exist only in the choice text, which runs to several sentences.

## Proposals

### 1. A third way to learn: read

Proposal. Add a memory kind `read` beside `witnessed` and `heard`, and a fact source kind `claim`.

How a fact was learned and what it is about stay separate. The memory kind records how: `witnessed`, `heard` or `read`. The source kind records what: an `event`, `topic`, `lane`, `ending` or `repair` today, plus `claim` here and `quest` in `docs/design/quests.md`. So a quest, like any fact, can be witnessed, heard or read.

- A claim fact is `{id, text, source: {kind: "claim", book, claim, author, ...}}`. Its id is stable: `claim:<pack>:<book>:<claim>` for authored claims and `record:<seq>` for written ones. Every reader of a claim shares the same fact.
- A reader's memory is `known[reader][fact] = {kind: "read", teller: null, book, eventSeq, learnedTurn}`. It is valid for claim facts and for quest facts a book carries, and only for an actor in the read event.
- A book teaches a quest by carrying that quest card's fact. The reader knows the quest as `read`, and under `docs/design/quests.md` its card is then face up for the reader. Told on, it becomes `heard`, as there.
- Telling does not change. A reader who tells a claim on Talk makes the listener remember it as `heard`, with the reader as teller. The fact still names its book and author, so every retelling keeps the chain.
- The prompt renders each kind with its source, for example "I read this today in Creon's Writ: …" or "Vale told me this yesterday, from Creon's Writ: …". It always gives a claim as its author's claim and never as world fact.

Why. The Outer Wilds ship log has two kinds of fact: rumor facts, heard in dialogue or seen from far off, and explore facts, learned by exploring ([ship log docs](https://nh.outerwildsmods.com/guides/ship-log)). `witnessed` and `heard` already match those two, and `read` adds a third source. In Dwarf Fortress adventure mode, characters know only what they have been told and react to the retelling, not to the event ([DF wiki, Rumor](https://www.dwarffortresswiki.org/index.php/Rumor)). In the code, `known` does not depend on custody, so knowledge already outlasts objects. But `heard` needs an actor as teller and `witnessed` needs a witness (`card-game/knowledge.mjs:566-578`), so a book needs a kind of its own.

### 2. Reading is an event that teaches the book's claims

Proposal.

- `read` is a play, like give or trade. A character reads a book it holds or one lying face up in its place. The play is a rules log entry, and the reader learns at once every claim it can open and any quest fact the book carries.
- Others present see the reading but not what the book says. With `read` among the news verbs (`card-game/knowledge.mjs:135-142`), "Vale reads Creon's Writ" becomes a witnessed fact. A resident can therefore learn that Vale knows something without learning what it is.
- Book text never enters the prompt. Only learned, attributed claims do, through the same `knowledgeFacts` slots as every other fact (`card-game/knowledge.mjs:405-450`). The change removes `lorePages`, `Entity.lore`, `rust/card_narrative/lore.rs` and the lore lines in speech and place captions (`rust/card_narrative.rs:2024`, `rust/card_narrative/atmosphere.rs:35`).
- Learned claims go through every filter that facts go through. Names in a learned claim join the known-names set, so the reply check stops rejecting names that the prompt itself supplied (`rust/card_narrative.rs:2995-3006`).
- A read claim can also satisfy a `knows` condition (`card-game/pack-rules.mjs:139-142`), which content already uses as a gate ten times. So a book can open a quest step as well as teach a quest.

Why. When the payout comes from opening a book, the text is optional. Skyrim gives a skill book's benefit as soon as the player opens it, and a Baldur's Gate 3 character only has to page through a book ([UESP, Reading a Video Game](https://en.uesp.net/wiki/General:Reading_a_Video_Game_-_The_Books_of_Skyrim); [Dot Esports, BG3](https://dotesports.com/baldurs-gate/news/what-to-do-with-books-in-baldurs-gate-3)). A claim pays out later, in what the avatar can say, ask about and unlock. Generative Agents puts only the top-ranked memories that fit into a prompt ([Park et al.](https://ar5iv.labs.arxiv.org/html/2304.03442)). Claims compete for the same slots as everything else instead of taking 2,400 characters per holder.

### 3. Residents read by the same rules

Proposal. Residents read the way avatars do. As in `docs/design/quests.md`, the only difference between a resident and an avatar a person steers is who chooses the play.

- The read play is a legal action for both. Books become ordinary items again, and the four #3077 exclusions go: zero weight (`card-game/world.mjs:584-588`), never the held item (`card-game/held-item.mjs:5-15`), no resident item plays (`card-game/world.mjs:1521`) and no place in learning counts (`card-game/adaptive-learning.mjs:53-55`).
- Read events have a budget. A resident reads a book it holds or one handed to it, or hears one told aloud on Talk. It reads a given book once. At most one resident reads per world turn.
- Residents already witness, hear and tell (`card-game/world.mjs:3153-3156`, `:2723`). A resident who reads a claim passes it on under the existing rule of one fact per Talk.

Why. Dwarf Fortress residents read in libraries, and books spread art forms and values through a world ([DF wiki, Library](https://dwarffortresswiki.org/Library)). The same system lets one shelved necromancy book turn a whole fortress ([DF wiki, Book](https://dwarffortresswiki.org/Book)), which is why reads have a budget. In Oblivion, reading is one of the goals residents pursue, beside eating and sleeping ([Wikipedia, Oblivion](https://en.wikipedia.org/wiki/The_Elder_Scrolls_IV:_Oblivion)).

### 4. Used up, or passed hand to hand

Proposal. Each book has a `lifecycle`: `kept` (the default), `spent` or `fixed`. Each option trades something away:

- **Spent when read.** Skyrim destroys a spell tome once it has taught the spell ([Nexus Mods](https://www.nexusmods.com/skyrimspecialedition/mods/4924)), and the Oghma Infinium leaves the inventory after use ([UESP](https://content2.uesp.net/wiki/Skyrim:Oghma_Infinium)). The reader becomes the only carrier, so the claim survives only by being told. This is the purest form of knowledge outliving the object. The cost is one reader per book: a resident who reads it first takes it from the player, and a rare book becomes rarer still. The rules can already use an item up: Aethra's urn consumes the Truce (`greek-ash-urn.locked.consumes`).
- **Kept and passed on.** In Book of Hours, reading a book gives a memory and a skill, and the book stays on the shelf to be read again ([KosGames](https://kosgames.com/book-of-hours-how-to-be-an-efficient-librarian-44143/)). The book keeps its value as an object that can be wanted, traded or lent. The cost is that every reader gets the same claims from the source, so beliefs converge and the chain of tellers matters less.
- **Fixed in place.** Tablets and public notices stay where they are, and anyone present can read them. That gives the world common knowledge while true books stay rare.

`kept` is the default because rarity already limits how many people read a book. Letters and one-shot books are `spent`. Open question 1 asks whether that default holds.

### 5. Books start face down

Proposal. A book lies face down where content puts it: in a place or at a seeded spot. Only its back shows until it opens. No item is face down or sealed today.

- The rules have pieces to build on. A `sealed` item with `requires` is a face-down box, shut where it lies until its `requires` hold (`card-game/pack-schema.mjs:1394-1403`, `card-game/world/boxes.mjs:1-20`). It must lie in a place of its pack, not inside another item. It opens when its conditions hold, not when someone turns it, so turning a book needs a condition a play can meet there, or a small new rule.
- `hide_item` is a choice effect that moves a thing to a place picked by a hash of the choice, the actor and the turn (`card-game/pack-registry.mjs:680-690`, `:918-933`). It also makes the choice's subject want the thing back, which a hidden book may not need.
- The client draws a card face down until the player first meets it (`card-game/app.mjs:615-617`), but that is presentation, not rules.
- A face-down book is not in the hand, on the floor or in any prompt. Turning it shows the title and author, and reading it teaches the claims.
- Each pack puts at least one book in a fixed spot, so rare never means none.

Why. Skyrim's skill books are rare because they are placed by hand and never appear as random loot ([UESP](https://pt.uesp.net/wiki/Skyrim:Skill_Books)). Harvey Smith argues that some things must be missable for finding them to mean anything ([Nieman Storyboard](https://niemanstoryboard.org/2011/01/14/harvey-smith-on-environmental-storytelling-and-embedding-narrative/)), and Henry Jenkins that essential story information must be presented redundantly across spaces and artifacts ([Jenkins](https://web.mit.edu/~21fms/People/henry3/games&narrative.html)).

## Branch truth

Decided on 2026-11-24 and built in rules 200 (`card-game/claims.mjs`).

- **The condition comes from the claim's subject.** A claim's truth condition is the `choice` conditions on the pack's `continuity.groups` that its `about` entity `requires`. Helen's Egypt claim is about Proteus's Tomb, which requires `greek-helen-account: egypt`. Authors write no separate condition, so a claim can never name one branch while its subject exists on another. A claim whose subject carries no branch condition stays a plain claim.
- **Open, true or false.** A claim is open while its branch is uncommitted, true once the condition holds and false once the branch has committed elsewhere. In a world committed to Egypt the tablet's Troy claim is false, and in one committed to Euripides the Atreid record's tomb and palace claims are.
- **Learned only by witnessing.** Reading and hearing still teach every claim as a belief. A character settles a claim it knows by being present at the play that commits the branch, while it still remembers that event, or by standing later at a place, or with a resident, that exists only on the committed branch. Nobody is told the truth, and telling a settled claim passes on only the claim.
- **Memory.** The memory gains `status: "confirmed"` or `"disproved"`, on read and heard claims alike. Validation accepts a status only when it agrees with the branch as the world has it. No status means a belief, so older saves load unchanged. On load, a status whose claim no longer has that truth is dropped.
- **Narration.** "I read this in Helen's Account Tablet, by The Bard, and I know it is true: …" for a confirmed claim, and "I read in Helen's Account Tablet, by The Bard, that …; it was wrong." for a disproved one, with shorter forms that keep within the 240-character line cap.

## Every text item

That every text item is accounted for is decided. What each one becomes is a proposal, except that the card-prose books go, which follows from the decision that packs carry no hand-authored prose. The list covers every text item in `v2/content/*/card-world.json`, grouped by what it becomes.

**Keys, writs and decrees** keep their lock or quest role and teach a claim when read.
- Creon's Writ (`greek-creon-writ`): in the Guard's hands it opens the Gate to Battlefield. It keeps the lock and gains one claim by Creon.
- The Herald's Truce (`greek-olive-branch`): opens the same gate and is consumed by Aethra's urn. It keeps both roles and gains one claim.
- The Burial Decree (`greek-decree`): Creon wants it, the Guard holds it and his wants turn on keeping it, and the Elder values it. It keeps those roles and gains one claim, the official side of a pair with the Mothers' Petition.
- Station Key (`ratiradio-station-key`): opens the Staff Kitchen. It keeps the lock. Its "STAFF" tag is a one-claim label, and the play instruction leaves its `text`.
- Household Token (`greek-household-token`): a quest object for Ismene. It keeps that role, and its seal is a one-claim label.

**Documents with a quest or route role** keep the role and teach their claims.
- The Mothers' Petition (`greek-burial-petition`): one claim by the mothers, the private answer to the Decree.
- Teucer's Written Plea (`greek-ajax-plea`): one claim by Teucer. When he signs his account, his testimony is written onto it as a record.
- Helen's Account Tablet (`greek-helen-accounts`): two claims that disagree, one for Egypt and one for Troy.
- Record of the House of Atreus (`greek-atreid-record`): three claims that disagree, one for each way in.
- Request Slip (`ratiradio-request-slip`): RATi holds it once awake. Its lost-property note, the clue to what to bring home, becomes one claim.

**Records of play** become generated books.
- Burial Account (`greek-burial-account`): its claims are written from its three `records` choices.
- The five witness tablets (`greek-egypt-`, `-troy-`, `-tomb-`, `-palace-` and `-farm-testimony`): each appears only on its branch and keeps its delivery role, with one claim by its witness.
- Maker's Label, Visit Seed, Invitation Home, Mira's Draft, Evening Programme and Sol's Reading (Hoppy Cat): the choice that writes on one or signs it adds a claim with the actor as author, taken from the first sentence of its log line, such as "Penny writes Ledger's name beside the display."

**Inscriptions** get one claim each or keep their name only.
- Rill's Compass (`hoppycat-concordance-compass`): one claim for the names scratched on its case, keeping its choice roles.
- Glim's Place Ring (`hoppycat-loop-token`): the name is its label, and it keeps its quest role.
- River Map (`willows-map`): one claim for the margin note.
- The Swede's Pipe (`willows-pipe`): one claim for the inscription, or its name only.

**The old card-prose books** go or are reduced to claims.
- The Theban Chronicle (78 pages of former choice text, opened by world receipts): removed. Records written in play replace it, and each record belongs to whoever saw it made.
- The Roll of the City (35 pages of former avatar text): removed. Characters learn about people by meeting them.
- The Chorus Songbook (30 couplets): removed. The Bard's recital already builds its poem from receipts (`card-game/pack-recital.mjs`).
- A Guide to Thebes and Attica (70 pages of former place text): removed. Its ship page (`greek-guide#49`, 730 characters) explains ports and cargo rules. That text belongs in the rules and the interface, not in a book.
- Myrto's Cargo List (27 pages of former item text): reduced to a manifest of up to three claims by Myrto, or removed. Five pages (`greek-cargo-list#18-#22`) end in prompt directions such as "Describe its actual holder and recorded use.", and those go with the pages.

**The first real book**
- The River Notebook (`willows-notebook`): face down at a fixed spot in the camp. It holds up to three paraphrased claims instead of 13 verbatim passages, and content names its author. Its card already uses `assets/willows/notebook-book.png`. The page and chapter art (`notebook-page-1..3.png`, `notebook-chapter.png`) ships without being wired to anything (`card-game/public-assets.mjs:187-194`) and becomes the Read view.

The Bell's Heart names a bell but carries no writing of its own, so it does not change. Writing in scenery is not an item and stays as visible description; open question 7 covers it. Examples are the station timetable in the hub and the exhibit source cards and bed labels in Hoppy Cat's place text. The retired text items (the Guard's Tablet, Marathon Record, Pyre Account, Refuge Tablet and Return List) stay retired.

## Canon outside lore

Three other paths deliver authored text to a character without the character learning it. The no-canon decision covers each. How each one changes is a proposal.

- **Held item text** (`rust/card_narrative/custody.rs:63-80`). Whenever a turn has an outcome, a holder gets "From the X: <card text>", up to 240 characters, for every uncovered held item that has `text`. The same lines feed the known-names set and dreams (`rust/card_narrative.rs:1754`, `rust/card_narrative/dream.rs:54`). They include inscriptions (River Map, the Swede's Pipe) and play instructions (RatiRadio's beanie, thermos and glass). Proposal: remove these lines. Writing on an item becomes a claim learned by reading, and play instructions leave item `text`. A holder then still knows what it holds: each item's name from the custody lines ("I'm carrying …", `custody.rs:17-61`, and "Holding: …" in `card-game/narrative.mjs`), its visible state from observations such as a lit lamp, what it has witnessed done with it, and any claim it has read on it. It no longer gets the card's description of the thing. Open question 9 asks whether a short physical description stays, since seeing what you hold is witnessing. Built in step 6: the lines are gone from speech, thoughts, dreams and the known-names set, and no physical description stays (open question 9). The play instructions and repeated inscriptions left the card `text` of the Station Key, the River Map, the Swede's Pipe, the Red Beanie, the Thermos, the Raven Figurine, the Glass, the Request Slip and Rill's Compass. Card text is now only what the card face shows a player.
- **Authored topics** (`card-game/knowledge.mjs:227-257`). When a speaker talks at a topic's place and the topic's conditions hold, the speaker becomes a "witness" of an authored sentence it never saw happen (`card-game/world.mjs:885-927`). There are 37 topics. Proposal: give each one a source in the world, in one of three ways. A topic can rest on a rules event the speaker took part in. It can move into a text item the speaker holds or has read: the Guard's `greek-hear-decree` moves into the Burial Decree, and Teucer's account topics into his plea. Or it is cut. A resident who starts out holding a text item reads it in a recorded event before play, the way a new world's ten days of history (rules 181, `card-game/world-history.json`) already give residents knowledge. Built in step 6 (rules 201): a topic is what its speaker says at the Talk that commits its choice. The speaker witnesses it there and the listener hears it, and either can tell it on later, one fact per Talk; a topic that applies to the listener is told before other news. Nine topics have such a choice and stay: the three shield testimonies, Teucer's plea, his three signed accounts and the two walkers. The Guard's decree and the mothers' request were already claims on the Burial Decree and the Mothers' Petition. The other 26 have no source in the world and are cut: Badger's two, Adrastus and the pyre, the seven Colonus and Marathon tales, Oak's night watch, RATi's kettle and her eight buttons, RatiRadio's three and the Swede's two. Saved topic facts follow content at any pack revision, as claims do, so a cut topic is forgotten on load. Teucer's accounts stay topics said when he signs, not records on his plea: a record's claim is its choice's log line, and Greek choices carry no prose, so a signing would read "Vale talks with Teucer at the Greek Camp." Moving them needs a record book that words each recorded choice itself.
- **The Discord channel route** (`rust/card_narrative/channel.rs:309-365`). A resident's prompt gets its own card `text` (its backstory), its likes and sores, its home, the paths from home, and the place's text, persona or seed. Proposal: make this match the card table. Home, paths and what the resident sees and holds stay, because they are world state. The backstory, the place text and the tastes go; tastes already left card speech in ec33ee3c5. The resident's learned facts are added from the same knowledge store. Built in step 6, from the owner's decision of 2026-11-24 that Discord residents use the card table's Talk engine. A Discord message is a Talk with the resident. Its facts are its own want, favour and mood and the knowledge lines a table Talk gives it, with the same attribution and branch-truth statuses, read from the server's world through the shared narrator (`talkKnowledge` in `card-game/narrative.mjs`). Its place, what it holds, what lies there and who is with it become the Talk's outcome. The card text, home, tastes, paths and place text are gone. Without a server world the resident stands at home with what it starts with and knows nothing.

Proposal: avatar seed sentences (`rust/card_narrative.rs:1601-1618`) stay as identity. Open question 6 asks whether a seed may state world facts.

## Knowledge-system limits

Proposal. These limits in `card-game/knowledge.mjs` have to change:

- **`FACT_TEXT_LIMIT = 180`** (`:7`) stays. A claim is one sentence within it, so it validates like any other fact (`:34-38`), and no page ever becomes a fact. The rendered line adds the book and the teller, so the 240-character line cap (`card-game/narrative.mjs:681`, `card-game/knowledge.mjs:445-448`) must leave room for the attribution instead of cutting the claim short.
- **The 256-fact world store** (`:4`). The 253 lore pages alone would almost fill it. Content bounds authored claims (few books, at most three claims each), so they are kept the way topic facts are and never age out (`retainFact`, `:112-133`). Written records count toward the store and age like events. A written book keeps its claims in item state, so evicting the fact never empties the book. `docs/design/quests.md` spares live quest facts too. If spared facts fill the store, `retainFact` keeps no new fact at all, so the spared kinds need a shared cap (open question 10).
- **Positional page refs.** Refs are `"<item>#<index>"` (`card-game/pack-registry.mjs:373`). They are harmless while nothing saves them. Once a memory saves one, a content edit would point the memory at different text. Claims get stable ids instead, and the schema rejects duplicates. A removed or reworded claim follows `reconcileTopics`: it takes the current wording or is forgotten (`card-game/legacy-saves.mjs:295-318`).
- **Validation and version.** `validKnowledge` accepts exactly two memory kinds and five source kinds (`:470-622`), and it runs inside the rules bundle (`card-game/world.mjs:3617-3626`). The new kinds, the read play and the lifted exclusions need the next free rules version after 187 (`npm run v2:card:shared:next`). That means a frozen bundle, new constants in `rust/card_shared/engine.rs` and rules 187's bundle hash pinned in `test/card-released-rules.test.mjs`. `KNOWLEDGE_VERSION` stays 1. The `lane` and `repair` kinds were added the same way, by widening the validator, so saved knowledge still validates. The authored-text catalog is rebuilt for the new wording (`v2/scripts/build-card-authored-text.mjs`).
- **Slot policy.** `knowledgeFacts` fills heard facts first and then up to two witnessed ones (`:405-430`). Read facts get at most two slots. Claims `about` something in the scene go first, then recent ones.

## Compared with the Elder Scrolls

In the Elder Scrolls, what a book says stays in the player's head. The game records only the side effects of reading. The first read of a skill book raises a skill by one point ([UESP](https://pt.uesp.net/wiki/Skyrim:Skill_Books)). A spell tome teaches its spell and is destroyed ([Nexus Mods](https://www.nexusmods.com/skyrimspecialedition/mods/4924)). Opening some books adds a quest to the journal ([UESP](https://content3.uesp.net/wiki/Category:Skyrim-Quest_Books)). Skyrim's co-lead designer Kurt Kuhlmann said in 2011 that the game has no way to track who reads its books ([UESP](https://en.uesp.net/wiki/General:Reading_a_Video_Game_-_The_Books_of_Skyrim)). ESO adds each lore book read to a library in the game menu for rereading ([UESP, Lorebook](https://content1.uesp.net/wiki/Online:Lorebook)), but that archive belongs to the player's menu and nobody in the world knows about it. The series does have texts that disagree, such as the short, sanitized biography of Barenziah by the Imperial Scribe and the longer The Real Barenziah ([UESP](https://app.uesp.net/wiki/Lore:The_Real_Barenziah)). The disagreement exists only for the player.

In CosyWorld the character holds what the book says. The claim outlasts the book, others hear it, residents read too, and readers of opposed books carry opposed beliefs into later narration. Side effects still happen: a claim can meet a `knows` condition or teach a quest, as a Skyrim quest book does.

## Risks

- **Readable fatigue.** Players weigh the time a text costs against a benefit that is hard to judge ([Game Developer](https://www.gamedeveloper.com/design/how-to-remove-the-frustration-of-reading-in-games)), and notes that come too often stall play ([Vice](https://vice.com/en/article/i-hate-reading-notes-in-the-last-of-us-part-ii)). Mitigation: there are no pages. The Read view shows at most three one-sentence claims, and the knowledge works whether or not the player reads them. Books are rare, and every text has an in-world author with a reason to write it, as Josh Sawyer asks of any character who tells a story in Pentiment ([Kotaku](https://kotaku.com/pentiment-obsidian-josh-sawyer-interview-xbox-gamepass-1849932260)).
- **Prompt bloat.** Today a holder's prompt can carry 2,400 characters of pages, and the book's and the place's prompts can each carry 2,400 more. Mitigation: claims share the existing fact slots and the 16-line cap (`card-game/narrative.mjs:681`). Read facts take at most two slots, chosen by relevance to the scene and then by recency ([Park et al.](https://ar5iv.labs.arxiv.org/html/2304.03442)). An identical claim from two sources is stored as one fact.
- **The model filling gaps from myth in its training text.** In Generative Agents, one agent described a neighbour as the author of a famous book, from the language model's general knowledge ([Park et al.](https://ar5iv.labs.arxiv.org/html/2304.03442)). This risk is sharpest in the Greek pack, because the model's training text includes a standard version of every play the pack draws on. Mitigation: the prompt lists what the speaker knows and says it knows nothing else. Claims are always attributed. Learned names join the known-names check, so a reply that names someone the speaker has not met, been told about or read about is rejected (`rust/card_narrative.rs:2995-3006`). A small evaluation of Greek scenes with sparse knowledge catches replies that bring in plot nobody listed. These steps reduce the leak but cannot remove it.
- **Rare books feeling absent.** Hollow Knight's makers accept that players miss things ([Kotaku, Team Cherry](https://kotaku.com/the-makers-of-hollow-knight-are-fine-with-players-missi-1828721254)), but players should sense that books exist. Mitigation: every pack puts at least one book in a fixed spot. Reading is news that others witness, so titles travel in told facts. A title works as something to ask anyone about, as a heard word does in Morrowind ([UESP, Dialogue Notes](https://content2.uesp.net/wiki/Tes3Mod:Dialogue_Notes)). Fixed tablets and notices can be read by anyone present.
- **News spreading too fast.** In Generative Agents, news of a party reached 13 of 25 agents in two game days ([Park et al.](https://ar5iv.labs.arxiv.org/html/2304.03442)). Mitigation: one fact per Talk stays (`card-game/world.mjs:885-927`). A claim read or heard this turn passes on only on a later turn, as told facts already do (`card-game/knowledge.mjs:270-274`; #3058 applied the same rule to sea lanes). Resident reads have a budget (proposal 3).

## Saves and receipts

- **No recorded saves.** `scripts/check-recorded-saves.mjs` rejects new world-state files, and its allow-list only shrinks. Book tests build state by play: `createWorld`, journeys (`test/journeys`) or helpers such as `funeralJourney` (`test/card-lore.test.mjs:33`).
- **Receipt-gated pages.** Receipts belong to the pack and the world (`card-game/pack-rules.mjs:123-124`), so in a shared world one traveller's choices open pages for every holder. Rules 186 added the `receipt` condition, and only lore pages use it: all of the Chronicle and the Songbook, and 12 of the 13 notebook passages. With those pages gone, no content uses it. Receipts stay in saves and keep their other uses, and none is dropped. Released bundles keep the condition kind. Records written in play take over from receipt pages, and a record belongs to the people who saw it made.
- **Migration in place on load.** Removed books go through the existing content reconciliation: an item id that content no longer defines is removed, and anything it held goes to its keeper (`card-game/legacy-saves.mjs:146-156`). A book that only moves keeps its saved holder (`:126-136`), so the River Notebook needs an explicit step when the Willows revision rises. If the notebook still lies at the camp with no history, it moves face down to its new spot. If someone holds it, it stays. Saved knowledge loads unchanged. No read memories are invented for past holders, because holding a book under rules 186 was not reading it. Saved reflections may still echo page wording (`card-game/narrative.mjs:730-754`). They are the avatar's own inner life, and they stay.
- **Old rules and shared worlds.** Released bundles stay as they are, and no saved world is retired. Shared worlds replay old content revisions by hash (`rust/card_shared/content.rs`). The shared dialogue-context bundle is rebuilt from current sources (`rust/card_shared/narrator.rs:1-6`), so it stops sending page ids straight away. `Entity` rejects unknown fields (`rust/card_narrative.rs:410-417`), so the text route keeps accepting and ignoring an `Entity.lore` field for clients still on rules 187.
- **Regression coverage** plays rules-187 content and checks local reload, shared upgrade, repeated reload, old receipts, knowledge and removed items, as `docs/design/open-door-save-compatibility.md` did.

## Plan

Proposal. Each step is one PR under the 400-line budget (`scripts/change-budget.json`), which counts lines added plus lines deleted. Pack content under `v2/content/`, `packs.json`, the frozen rules bundles and the authored-text catalog do not count. `app.mjs`, `world.mjs`, `pack-schema.mjs`, `style.css`, `card_narrative.rs` and `channel.rs` sit at their line ceilings (`scripts/line-ceilings.json`), and lines deleted there lower the ceiling instead of making room. New code therefore goes in new modules: the claim and read rules in their own `card-game/` module, the book schema in its own checker, and the Read view as a view module like `card-game/sleep-view.mjs`.

0. **Floor-items smoke.** `v2/scripts/smoke-card-floor-items.mjs:22-27` expects a bare Willows camp floor, but #3077 put the notebook there (`v2/content/willows/card-world.json:345`). The assertion at `:24` fails before any browser starts, which is one of the failures listed in #3085. The fix is a stale assertion: expect `["willows-notebook"]` and correct the comment at `:14-15`.
1. **Knowledge with read memories.** The `claim` source, the `read` memory, quest facts a book carries, rendering with attribution, the slot policy, the authored-text rebuild and a new rules version. No content changes. Tests build state by play.
2. **Books and the read play.** Schema for `author`, `claims` and `lifecycle`. The read play for avatars and residents, with its budget. The #3077 exclusions lifted for claim books. A Read view that shows the claims.
3. **The River Notebook.** Claims replace the passages, the notebook lies face down at a fixed spot, the page art goes into the Read view, the save step is added and the smoke's camp-floor expectation is updated again.
4. **The lore path removed.** `lorePages`, the `LORE_*` constants, `Entity.lore` handling, `lore.rs` and the caption lines go. So do the five Greek books, with the Cargo List reduced or dropped. Tests are updated.
5. **Text items teach claims.** Claims for the writs, decrees, petitions, tablets, records and labels. The Burial Account and the Hoppy Cat writables write theirs from play, and characters can write down what they know. Step 5c settles claims on different branches by witnessing, as under Branch truth.
6. **Canon outside lore.** Held item text, the 37 topics and the Discord route, as decided under open question 9 and the proposals above. This may take two PRs.

## Open questions

Each has a default, settled on 2026-11-23 so building can start. Any of them can be reopened.

1. Lifecycle defaults to `kept`, letters and slips included. A pack marks a book `spent` explicitly.
2. The Read view shows only the claims. No generated page.
3. Every character can read. Literacy and being read to wait.
4. No reader-specific gates. A claim depends on nothing but the book.
5. A character writes down only claims it knows. It can still pass on a false claim it read or heard.
6. No avatar seeds. Avatars start knowing nothing about the world.
7. Writing in scenery stays out of scope for now.
8. Residents tell claims regardless of side until factions exist.
9. A holder keeps the item's name, its visible state and the claims it has read. No physical description.
10. Topic, claim and live quest facts share one cap of 128, half the 256-fact store. Past it, the oldest of them ages out.
11. A quest read in a book turns its card face up, as `docs/design/quests.md` settles for second-hand telling.

## Prior art

- **The Elder Scrolls.** Most books on Skyrim's shelves are randomly generated, but skill books are placed by hand. Reading one records only a skill point, a spell or a quest, and the text stays with the player ([UESP, Skyrim books](https://en.uesp.net/wiki/Skyrim:Books); [UESP, Skill Books](https://pt.uesp.net/wiki/Skyrim:Skill_Books)).
- **Morrowind topics.** A word the player has heard or read becomes a topic to raise with anyone who has an answer, and the answer depends on who is asked ([UESP, Dialogue Notes](https://content2.uesp.net/wiki/Tes3Mod:Dialogue_Notes); [UESP, Generic Dialogue](https://en.uesp.net/wiki/Morrowind:Generic_Dialogue)).
- **Caves of Qud.** Secrets go in the journal, and each can be traded only once in the water ritual. Each sultan event has a gospel account and a tomb inscription that usually flatters the sultan more ([Secret](https://wiki.cavesofqud.com/wiki/Secret); [Sultan history](https://wiki.cavesofqud.com/wiki/Sultan_history)).
- **Dwarf Fortress.** Every historical figure keeps its own knowledge list, fed by books, observation, rumor and apprenticeship, and residents read in libraries ([Knowledge](https://dwarffortresswiki.org/Knowledge); [Library](https://dwarffortresswiki.org/Library)).
- **Book of Hours.** Reading a book gives a memory and a skill, and the book stays behind to be reread ([KosGames](https://kosgames.com/book-of-hours-how-to-be-an-efficient-librarian-44143/)).
- **Outer Wilds.** The ship log separates rumor facts from explore facts, and knowledge is the only progress that survives each loop ([ship log docs](https://nh.outerwildsmods.com/guides/ship-log); [Game Developer](https://www.gamedeveloper.com/design/live-die-repeat-how-i-outer-wilds-i-piques-curiosity-in-an-ambivalent-solar-system)).
- **Heaven's Vault.** A translation is a guess, and the game never says whether it is right; evidence builds up instead ([The Sixth Axis](https://www.thesixthaxis.com/2018/04/27/interview-talking-with-inkles-about-deciphering-ancient-language-in-heavens-vault/)). Emily Short notes that the game often treated a text as unread even when its meaning was plain to her ([Emily Short](https://emshort.blog/2019/07/23/heavens-vault-inkle/)).
- **Pentiment.** The game never confirms whether the player picked the right killer, and the town's records disagree while its council argues over what history to show ([PC Gamer](https://pcgamer.com/in-obsidans-murder-mystery-pentiment-dont-expect-to-know-if-you-idd-the-right-killer); [AV Club](https://www.avclub.com/pentiment-preserving-history)).
