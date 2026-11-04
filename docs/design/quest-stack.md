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
  before. A rest step anywhere in the stack counts on waking.
- **Enough for now.** Rules 90 (owner decision): an ordinary quest met with
  nothing beneath leaves the avatar content (`actor.content: true`,
  `want: null`, `contentOf`) instead of drawing at once. A player draws its
  next quest on waking from any Sleep (`renewWant`); a resident, which never
  sleeps, after a day (`CONTENT_TURNS`) as a want left empty always did. A
  finished level quest still draws at once, and dropping or setting aside a
  quest works as before. Any quest pushed on top (a level quest, a story
  quest) ends contentment. A content resident takes the plays it takes with
  no quest: it waits, and still answers threats, talk and its pack rules.
- **Drop.** The player's `drop` play with no item names a quest index
  (`quest`). An ordinary quest costs nothing; its target goes into `gaveUp`.
  A level quest costs `dropCost`: 1 XP for the first level quest, 2 for
  the next, and so on, never below `questXp` of the current level, so the
  level stays (owner, 2026-11-04; rules 98, which replaced rules 90's
  halving). The Drop button says "Drop quest (−N XP)" from the same
  function; at no cost it says "Drop quest". Dropping the last quest draws
  a new one at once.
- **Focus.** The player's `focus` play moves a quest from beneath to the
  top. Owner decision, 2026-11-01: choosing the card is the whole act, with no
  Pursue button. Local and shared play journal focus like any play, but it
  takes no turn: `play` bumps the revision, reorders the stack and logs it,
  and the world does not move on. Residents are never offered either play.
- **Stall.** A player's refused Asks and Trades never count against its
  quest (rules 98), so they cannot redraw a level step for free.
  A resident's stalled or thrice-refused quest moves to the
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
- **Talk gives a quest** (#2196, rules 99, `talk-quest.mjs`). A player's Talk
  that reveals the other avatar's top want gives the player one ordinary
  quest for it, when that want is new to them: `actor.heard` keeps, per
  avatar, the last want it told this player (`"kind:target"`), so re-hearing
  it adds nothing. An item want X gives `give(X, them)` (an item quest with
  step `give` to them); a place want P gives `bring(them, P)` (a person quest
  with step `bring` at P, met when they are at P in the player's company);
  a person want Q gives `introduce(them, Q)` (step `bring` to Q, met when
  they are with Q). A connect want, or a want Talk does not say
  (`revealed` in `want-talk.mjs`), gives nothing. The quest's own shape
  names whom it serves (`talkQuestFrom`), so the stack holds no extra
  record. It is pushed like any quest, so one with the same kind and target
  already held moves up instead; under a level or story quest on top it goes
  second. A level step that is the very same quest already asks it. After
  every play and round, a Talk quest whose want they no longer hold on top
  (met by someone else, set aside) leaves the stack, with no refusal and no
  cost (`pruneTalkQuests`). Met, it is an ordinary want met: one point to
  the player, and so a step toward the level's gap of ordinary wants.
  Residents who keep to their scene are the ones a player brings: a
  traveller often walks to its wanted place alone first, which meets its want
  and lifts the player's quest.

## Client

The quest card code builds one card per stack entry (`questCards`). The folded
card behind the avatar shows the top quest. Choosing the folded card fans the
stack out. In the fan, the top quest is chosen and offers Drop quest. Tapping a card
beneath plays focus, which brings it to the top, and the fan stays open on it.
Tapping the chosen card folds the fan. The rules remove a met
quest at once. The browser reads `want_met` events after the last event it saw
(`metQuests`) and keeps those quests as sealed cards until the player clears
them, in any order.

A content player has no quest cards (`questCards` is empty). Not built yet:
the client should read `contentOf(world, actor)` and show a resting quest
card ("Enough for now") in place of the fold until the next Sleep.

## Engine

This is a rules change (`engine` label). It lands in one batch with #1829 and
the other rules PRs, and that batch mints one shared engine. Released bundles
keep replaying their own journals. During alpha, saves without `under` load
unchanged.
