# Decisions

Five choices that shape CosyWorld, as the code and its checks implement them. The layout they produce is in [ARCHITECTURE.md](ARCHITECTURE.md).

## A deterministic core, and a model afterwards

Shared play has to agree. The card a player sends is reduced by the authored rules, in the browser for solo play and in QuickJS on the server for a shared world. The model is called only after that reduction has been journaled.

Putting the model in the reducer would make two tables diverge whenever a completion differed, and it would make an old journal impossible to replay. The cost of the split is that speech can be late, missing, or untrue of the cards. That cost is accepted. A missing line is "…". An untrue line does not move the world.

## The player plays a card

The player chooses among actions the rules have already judged legal. The server accepts that structured card for the claimed avatar, and the reducer applies it only when it is legal.

A card is checkable, replayable, and the same object in solo and shared play. Free text stays in the dialogue layer, so a wrong sentence stays a sentence. The hand is the command surface. The place is the scene behind it.

## Released rules stay

Each shared world records a rules version (`full-card-world/N`). The server still contains every bundle from 133 through the current 187, and reduces a journal on the version that wrote it. A change to those rules mints the next file. A rebuild that would overwrite a bundle already on main is refused.

Replay is the reason. A world saved under an older bundle has to reduce to the same state when its journal is applied again. The cost is a larger binary and a deliberate release step, `npm run v2:card:shared:next`, in place of editing the live bundle. Pack content can move on its own. A change to the rules mints a new version.

## Speech is not state

Generated lines are marked `generated: true`. History ignores them. Several rules that read the recent log skip them, and the log trim gives them a separate limit so they cannot evict the events the rules use. Reflections write private memory and are not outcomes.

The model is still checked. Speakers must be the ones the play named, text has a length and a form, prompt-injection shapes are refused, and inner life is kept off item nouns the scene does not know. None of that makes the sentence authoritative. The voice eval records that a false claim is not yet a reason to refuse a line. Anyone reading a scene should trust the card and the world message first.

## New fiction prefers pack data

The seven mounted worlds are documents and bridges, compiled into one `packs.json` that the browser and the server both read. General rules interpret the conditions a pack names. CI warns when a pull request touches the shared rules engine without the `engine` label, and the warning text asks for pack data when the feature can live there.

A new resident or shore can ship without freezing another rules bundle for every future replay. A change to how wants, trust, or travel work is an engine release, because every saved world will meet it.
