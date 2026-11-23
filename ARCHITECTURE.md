# How CosyWorld is built

CosyWorld is a card game about a world that persists. The browser shows the table. One rules program decides every solo play and every shared play. A language model writes dialogue, place captions, and private thoughts after a play has already been accepted.

## The table

A player acts by playing a card. A card is a legal action the rules are offering now: wait, talk, give, travel, and whatever else this world allows. The page in `v2/card-game` draws the place, the hand, and the lines. Solo play runs those rules in the browser. Shared play sends the chosen card to the server.

A shared table has eight player avatars. A room holds at most four who are present. A passkey binds a person to the avatar they take in that world, and they return as that avatar.

## One rules text, two hosts

The rules are JavaScript modules under `v2/card-game`. The browser imports them. The server plays the same program through `v2/card-game/shared-world-entry.mjs`, bundled into a versioned file and executed in QuickJS.

QuickJS is a C interpreter. The Rust service in `v2/orchestrator-rust` hosts it with rquickjs, passes one JSON request in, and reads one JSON result out. The host removes `Date` and makes `Math.random` throw, so the interpreter has no clock and no randomness of its own. It also has no filesystem and no network. Rust owns the database, the HTTP API, and every model call. One rules call is limited to 96 MiB of memory, a 1 MiB stack, and a two-second interrupt. Past that, the call stops and the world is unchanged.

This QuickJS host is the bounded C interpreter named in the engine. CosyWorld did not invent a separate language for it.

A second, smaller C file stands beside it. `v2/core-c/src/card_table.c` is compiled into the server. After the rules run, `ct_shared_guard` checks the session: claims are 0 or 1, someone present is claimed, a command changes only the acting avatar's claim and presence, room ids are bounded strings, and no room holds more than four present avatars. The header states the split in one sentence: the authored rules execute inside the bounded QuickJS interpreter, and this guard owns claim, presence, and capacity. Shipping shared play calls `ct_shared_guard`. The same file still contains `ct_apply`, an older nine-room table.

Views of a world may be cached. Commands always run in the interpreter.

## What the model is allowed to do

A shared card is saved before anyone speaks. The journal records the play, the rules reducer applies it, and the new world is the result. The server then asks a model for lines about that committed scene.

Accepted lines return as a `speech` operation. The rules append them to the log with `generated: true`. Items, places, and wants stay as the play left them. A later `reflect` operation may store a private thought, persona, or dream. That path writes private memory. The play's outcome is already fixed.

The words can still disagree with the cards. The server refuses a missing or absent speaker, control characters, the wrong expression form, prompt-injection shapes, and some invented item nouns inside inner life. The offline voice eval records that `false_claim` is not a validator reason yet, so a fluent line can still contradict who holds what. When words fail, nothing is journaled for them, the rules stay as the play left them, and each voice that was due shows "…".

The reliable layer is the card text, the action the rules accepted, and the world messages that are not generated. The History view uses `witnessed`, which returns false for every generated line. The log keeps generated words in their own limit so they cannot push authoritative events out of the window the rules read. Both limits are 100. The dialogue-context bundle that prepares a scene for the model is rebuilt from current sources and is never itself a journal input. A live world upgrades onto the current rules when it loads.

Production dialogue goes out through the model gateway configured for [lonelyforest.com](https://lonelyforest.com). A local app can point the same gateway at a downloaded model. In both cases the model sits outside the reducer.

## Shared worlds

Each shared world is a SQLite journal. Writers for one database take a single turn, then the rules and the C guard accept or refuse the command. Replaying the journal rebuilds the world. The world stores the rules version it was written with. The current version is `full-card-world/187`. Bundles from `full-card-world/133` through that version are compiled into the server, so an old journal still reduces on the rules that wrote it. A rules change mints the next bundle (`npm run v2:card:shared:next`). Released bundle bytes stay fixed.

The browser follows a bounded, hashed chain of changes to that player's view. The chain projects the journal for that player.

## Opening history

A new shared world is created with `history: true`. The rules then apply the checked-in patch in `v2/card-game/world-history.json`.

That patch is produced by `v2/scripts/world-history.mjs`, which plays resident life forward from a fixed seed and keeps a result only when `refusal` is empty. The run is refused if it changes the opening cast, their trust toward protected people, items near the opening, which boxes are open, or the first legal cards. Residents may already have wants, trust among themselves, and memories. The player's first hand stays the hand a fresh world would deal.

## Wants, trust, and residents

Each avatar holds one want: an item, a place, or a person. The rules decide when it is met and pay experience on that play. A resident's next want is a function of the world and the run seed, so a replayed journal draws the same one. A player's want is never drawn. The player takes a quest by a tap.

Trust is a number on a relationship. A gift that meets the recipient's want can raise it. A threat or a strike lowers it by a fixed amount, and companionship needs enough trust to hold. A bond also ends if the traveler is away from a shared world for a day, or in the other ways `v2/card-game/world/company.mjs` lists.

Residents have a home, a range, a sleep, and sometimes a post they guard. They walk in id order. The host has no clock and makes no random draw. Offstage life is capped at a fixed number of steps on each play, so a busy world stays cheap. Home, sleep, and guard are the world-life rules.

## World packs

The hub and the places beyond it are data. `v2/worlds/card-table.json` mounts six packs: `badger-forest`, `greek-drama`, `hoppycat-archive`, `willows`, `lonely-forest`, and `ratiradio`. Each pack is a world document under `v2/content/<id>/` plus a bridge under `v2/worlds/<id>/` that says which crossings join it to the hub. `v2/scripts/build-card-worldpacks.mjs` compiles them to `v2/card-game/packs.json`. The browser and the server's text path both read that file, so names and ids cannot drift.

A pack supplies places, residents, items, and the conditions those things name. `v2/card-game/pack-rules.mjs` applies the general rules. New fiction is meant to land as pack data. A change that reaches the shared rules engine mints a bundle the journal will keep forever, and CI warns when that change lacks the `engine` label.

## Authoring

The packs above are compiled from the repository. Separately, a signed-in passkey can keep private authoring drafts on the server: card text, images, and a launch place. A model may propose the first cards. The proposal prompt forbids claiming new powers, earned rewards, changed custody, or opened routes. Those outcomes need authored rules and a play. The live table mounts the six compiled packs. A private draft stays on the author's account.

## Why this shape matters

Two people can share a world only when the same card produces the same world. A model is a poor store for that fact. It can be slow, it can disagree with itself, and a sentence can be untrue of the table. CosyWorld lets the model talk, and lets the rules decide.

Keeping every released rules bundle means a world saved under an older version still replays. Keeping shores as pack data means a new place does not have to be a new rules version. Keeping speech out of the authoritative log means a fluent wrong line does not move the lamp.

## Where to start reading

- `v2/card-game/world.mjs` — rules the browser runs, including the split between generated lines and the log the rules read
- `v2/card-game/shared-world.mjs` — create, play, speech, and reflect, as the interpreter sees them
- `v2/orchestrator-rust/src/card_shared/engine.rs` — the QuickJS host and the versioned bundles
- `v2/core-c/include/card_table.h` — what the C session guard is responsible for
- `v2/orchestrator-rust/src/card_shared/full.rs` — journaled shared play, and where speech is attached
- `v2/orchestrator-rust/src/card_narrative/` — dialogue after a committed scene, and what a reply is refused for
- [DECISIONS.md](DECISIONS.md) — five choices and the reason for each
