# Quest stack

Owner decisions, 2026-11-01 (#1831):

- Never wipe a quest that is still open. Add the new one to the stack instead.
- Let players drop quests.
- Quests can name items, avatars and places the player doesn't know about yet.

## Model

`actor.want` stays the top of the stack: the quest the avatar pursues, that the
folded quest card shows and that Talk says. `actor.under` holds the quests
beneath it, next first. It is absent while the stack holds one quest, so a
single-quest save keeps its shape. `questsOf(s, id)` reads the whole stack, top
first.

- **Push.** Every source adds to the top through `pushQuest`: pack content
  (`hide_item` marks its quest `story: true`), the level quest offered on
  waking, and a fresh draw. A quest the avatar already holds moves to the
  top. Nothing else changes the stack, except a level quest moving on a step
  in place.
- **Limit.** The stack holds at most three quests (`QUEST_LIMIT`), for
  residents and players alike. When a fourth arrives, the oldest ordinary
  quest beneath the top leaves. A level quest never leaves this way. A story
  quest leaves only when everything beneath the top is a level or story
  quest; in that case the oldest story quest leaves. An avatar holds one
  level quest at a time, so a fourth quest always finds one to drop.
- **Meet.** Every quest in the stack is checked after each play, and a play
  can meet several. A met quest leaves the stack and earns one point, as
  before. A new quest is drawn only when the stack is empty. A rest step
  anywhere in the stack counts on waking.
- **Drop.** The player's `drop` play with no item names a quest index
  (`quest`). An ordinary quest costs nothing; its target goes into `gaveUp`.
  A level quest also costs half the experience and keeps the level. Dropping
  the last quest draws a new one at once.
- **Focus.** The player's `focus` play moves a quest from beneath to the
  top. Owner decision, 2026-11-01: choosing the card is the whole act, with no
  Pursue button. Local and shared play journal focus like any play, but it
  takes no turn: `play` bumps the revision, reorders the stack and logs it,
  and the world does not move on. Residents are never offered either play.
- **Stall.** A resident's stalled or thrice-refused quest moves to the
  bottom of the stack with `since` reset and refusals cleared. A lone quest
  gets a newly drawn one above it. A level quest still turns into another
  step of the same level.
- **Unknown targets.** Every other draw for a player uses the wide pool. For a
  player, the wide pool is the whole world: any active place or person, and
  any item another avatar holds or that lies somewhere. A target only needs to
  exist (`entityActive`). Level quest steps already draw from the wide pool.
  Residents keep their earlier pools, because they pursue a quest by walking
  routes they know. A resident that keeps to its scene stays scene-bound. When
  this was tried, putting dropped items on the ground into residents' pools
  let them pick up story items from the scene.
- **Talk.** `wantFact` says the top quest only and adds a count of the rest.

## Client

The quest card code builds one card per stack entry (`questCards`). The folded
card behind the avatar shows the top quest. Choosing the folded card fans the
stack out. In the fan, the top quest is chosen and offers Drop quest. Tapping a card
beneath plays focus, which brings it to the top, and the fan stays open on it.
Tapping the chosen card folds the fan. The rules remove a met
quest at once. The browser reads `want_met` events after the last event it saw
(`metQuests`) and keeps those quests as sealed cards until the player clears
them, in any order.

## Engine

This is a rules change (`engine` label). It lands in one batch with #1829 and
the other rules PRs, and that batch mints one shared engine. Released bundles
keep replaying their own journals. During alpha, saves without `under` load
unchanged.
