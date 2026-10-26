# Before the Burial: cards and the bard

## Exact quest card text

Each card shows its art, a small Quest or completion label, and one line.
The same line remains through each branch and its closing moment.

| Quest  | Exact line                      |
| ------ | ------------------------------- |
| Water  | A place beside the bread.       |
| Burial | Her brother waits for earth.    |
| Return | What words will you bring home? |

Card lines live in `v2/card-game/quest-cards.mjs`. The poem lives in the
Greek pack's `recital` descriptor in `card-world.json`.

## Meeting the bard

The existing singer becomes **The Bard**, with his existing portrait. A
completed quest leaves a visit pending for the player who completed it.
On that player's next journey, he waits in the destination room. He stays
there until another completed quest brings him to a later destination.
Waiting, talking, and reloading preserve a pending visit.

His conversation context carries the whole earned poem through his latest
visit. Each verse names the traveler whose deed earned it. The bard sings
an earned couplet when addressed. His voice uses spare, vivid epic verse.

Permission earns a verse while the burial quest remains open. Reporting
permission completes the return quest. A later burial opens that return
again, with the same card line, so Dione can hear about the finished grave.

## Exact verses

| Earned deed                     | Couplet                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| Return the water                | I set the water by her hands.<br>She kept a loaf of bread for me.           |
| Receive permission              | Creon has granted this one grave.<br>Her brother waits for earth.           |
| Bury in defiance                | I laid her brother in the earth.<br>The king's words crossed the wind.      |
| Bury with permission            | Creon gave leave for this one grave.<br>I laid her brother in the earth.    |
| Decline the burial              | I told her I would turn away.<br>Her brother waited by the wall.            |
| Tell the guard                  | I gave the guard the hidden plan.<br>He held it with the king's command.    |
| Report the burial               | I spoke of earth beside her table.<br>Dione heard me through.               |
| Report permission before burial | I spoke the promise of a grave.<br>His body waited in the sun.              |
| Report permission after burial  | I told her of the king's consent.<br>She heard the leave that he had given. |
| Report the refusal              | I told her how I turned away.<br>She kept a place beside her table.         |
| Report the warning              | I told her what the guard had heard.<br>My words lay open on the table.     |
| Report the permitted burial     | The grave I promised holds him now.<br>I brought that word to Dione.        |

## Saved history

The song follows the durable choice receipts. An early permission report
keeps its words after a later burial. Returning the water late places its
verse later in the song. Each branch keeps its own outcome and report.

When addressed, the bard recites the latest earned couplet exactly. The
speech service checks his reply against the authored verse in his scene
facts. Each character request can repair a reply that changes those words.
Both local and shared speech pass this check before players hear the verse.

The pack save adds a `recitals` record beside its existing receipts. Each
verse records the acting human and, for a completed quest, the turn of the
bard's visit. Older saves receive pending visits for their earned deeds.
Available choice logs identify the original human; older trimmed logs use
the saved player. The existing story choices, items, and flags are preserved.

Shared worlds use rule version 4. Versions 2 and 3 keep their original
bundles for older journal entries. A recorded upgrade adds the pending
visits while preserving the earlier deeds and conversations.

Both local and shared games use the same rule. Shared visits belong to the
human who completed the quest. The shared journal replays the arrival and
its poem context. The world validates each visit against its earned choice.

The opening tests cover all four branches, both permission-report orders,
late water, pending visits, reload, log pruning, shared play, and journal
replay. Browser checks cover the single-line face and talking to the bard
at desktop, phone, small-phone, and landscape sizes.
