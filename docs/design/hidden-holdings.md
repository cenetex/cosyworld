# Hidden holdings and place items

Status: Later. Design folded from
[#1575](https://github.com/cenetex/cosyworld/issues/1575) on 2026-11-01. No
engine code yet. Card backs (#1566) become a core mechanic: what other
characters hold and what lies in places is face-down until **each player**
discovers it.

## Owner decisions (2026-10-31)

- Items held by other characters are covered until discovered. Select a
  covered card held by someone present and **Talk** → a chance to reveal it.
  Chance = **trust + rarity** (rarity from level, Fibonacci tiers).
- Knowledge is **per player** (each human in shared play discovers
  independently).
- **Places with hidden items** are part of the design: loose items in a place
  are covered until discovered.
- Opening cards also start covered (#1572); reveals play a "New card"
  animation on click.

## Play

- **Show that something is hidden and how rare.** The card back shows the
  rarity tier (a carved border ring per tier). A per-player "Known" list shows
  e.g. "Hollis carries 2 covered cards". Players may tag a guess on a covered
  card.
- **Inquire** (Talk with a covered card selected) uses a seeded deterministic
  roll (hash of actor:item:turn:seq, like `want.mjs`), with no reroll in the
  same turn. Starting numbers, to tune in play:
  p = 0.30 + 0.15×trustTier − 0.10×(rarityTier−1), clamped to 0.05–0.85;
  +0.15 per failure for that player and card; guaranteed on failure
  #(1 + rarityTier); reset on success; one attempt per card per scene, lifted
  early when trust rises or a related fact is learned.
- Every failure gives a visible reason ("She's not ready to show you") and one
  hint (kind of thing, or which want it fits), voiced by the character. No
  permanent failures. Odds show as words ("likely", "slim"), not percentages.
- **Search** is played on the place card and draws from its hidden pile (no
  pixel-hunting). A lit **lamp** shows how many hidden items a place holds and
  their tiers, and improves search and inquire by one tier.
- **Witnessing reveals.** Everyone present learns an item when it is given,
  traded, asked for, dropped, used, taken, or dropped in defeat. A told fact
  names its items (`items:[]`) and the listener learns them. Overheard lines
  reveal to every human present.
- **Residents use the same knowledge.** Their quests and trades target only
  items they have seen or heard about, seeded with their home place; gossip
  spreads knowledge. No fallback (mystery over reachability).

## AI without leaks

The rules decide reveals; the model only voices them. Per-speaker context
(inside the #1537 Weltgeist frame) holds only what that speaker knows plus a
rules-chosen `mayReveal` (revealed or hint). Hidden facts never enter the
prompt. A per-hearer validator rejects a line naming an item the hearer has not
discovered unless this event reveals it, and allows hint descriptors. Today's
leaks to filter are in `narrative.mjs` and `card_narrative/custody.rs`.

## Rules and shared play

- `knowledge.items[actor][itemId] = {how, turn, seq}`, seeded with own
  holdings and the opening set; `validateWorld` checks it.
- New offers `inquire` and `search`. Ask, trade and threaten are offered only
  for known items. `availableCards` shows unknown items covered; covered cards'
  aria and preview text lose their names.
- Items need a meaningful level (today every item resolves to level 1).
- Shared play redacts on the server: `privateView` drops undiscovered items
  and sends opaque placeholders, not real ids. The journal keeps full truth
  plus `discovered{actor,item,channel}` events, so replay is deterministic.
  Spectators get the public view. Today hiding is cosmetic: shared responses
  send the whole world and covered state is client localStorage.
- This is a real engine change with a rules version. Old journals replay on
  pinned bundles; alpha saves start with an empty map seeded from current
  co-location.

Risks: soft-locks (authored and opening items stay known; reveals are
guaranteed eventually), AI leakage (prompt scoping plus validator), shared
fairness (late arrivals miss witnessed reveals, documented), and name leaks
through ids, art or aria.

## From client amnesia to rules knowledge

The interim client-side amnesia (#1602) keeps the covered set in browser
localStorage (`SEEN_KEY.covered`). Vale's first line waits until his player has
uncovered both Vale and his place, because the Rust transcript always names the
speaker and location. `speech-knowledge.mjs` `forgetCovered` strips covered
items from the local speech request, and the `known()` validator rejects a line
that names one. Shared lines are not filtered; each viewer only holds playback
until their avatar and place are uncovered. To turn this into rules knowledge:

1. Seed `knowledge.items[actor]` (and `knowledge.self/places`) empty for a new
   avatar. Uncovering becomes a journaled rules play (`uncover`, no turn cost)
   that writes `{how:"uncover"}`.
2. `narrativeContext` reads that store per speaker; `forgetCovered` moves into
   `narrative.mjs` as the speaker-scoped filter (engine bump). The client stops
   passing `limit`.
3. Rust: send `self_known`/`place_known` flags so `transcript_sections` says
   "I" or "this place" instead of the name. The opening then no longer waits
   for both uncovers. The validator rejects a covered name unless this event
   reveals it.
4. Shared: `privateView` redacts per viewer from the store; `SEEN_KEY.covered`
   and the client hold go away.

## PR sequence (each about 400 lines)

1. Known-items store, seeding, witness rules, validation, tests; engine bump.
2. `inquire`, the trust×rarity seeded roll, item levels, gating of ask, trade
   and threaten, replay test.
3. Place `search`, hidden loose items, lamp effect; defeat drops known to
   witnesses.
4. Client: covered state from rules, name-leak removal, reveal animation,
   Known list.
5. AI: speaker-scoped context, custody filter, leak validator test.
6. Shared: server-side redaction, two-player independent discovery test,
   client/server agreement.
7. Quests (#1506) read the known-items store.

Related: #1566, #1572, #1537, #1506, #1548, #1549, #1550.
