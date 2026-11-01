# Before the Burial: cards and the bard

## Exact story lines

Each story has one line. The hand shows no quest cards; the cast uses this
line in Talk context. The same line remains through each branch.

| Quest  | Exact line                      |
| ------ | ------------------------------- |
| Water  | A place beside the bread.       |
| Burial | Her brother waits for earth.    |
| Return | What words will you bring home? |

Card lines live in `v2/card-game/quest-cards.mjs`. The poem's verses, their
deeds and summons live in the Greek pack's `recital` descriptor in
`card-world.json`. The couplet text lives in
[`lore/bard-couplets.json`](lore/bard-couplets.json), keyed by verse choice.

## Meeting the bard

The existing singer becomes **The Bard**, with his existing portrait. New
worlds place him at the harbor. Existing saves keep his actual position.
The latest completed quest gives him a journey to its saved completion site.
He takes one legal travel action on each resolved world turn, including while
he is away from the player. Doors, route knowledge, and sea passage shape his
journey. A blocked route creates a shared help card. He stays after arrival
until a later quest completion gives him a new destination.

His conversation context names the poem and the travelers whose deeds it
holds, including verses earned while he travels. It carries no couplet text:
he speaks in his own voice from world state.

Permission earns a verse while the burial quest remains open. Reporting
permission completes the return quest. A later burial opens that return
again, with the same card line, so Dione can hear about the finished grave.

## Exact verses

The Bard no longer sings these couplets. They are lore, kept intact in
`lore/bard-couplets.json`; a follow-up makes them readable book items in the
world. The permission report used its alternate couplet when the permitted
burial came first.

| Earned deed                     | Couplet                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| Return the water                | I set the water by her hands.<br>She kept a loaf of bread for me.           |
| Receive permission              | Creon has granted this one grave.<br>Her brother waits for earth.           |
| Bury in defiance                | I laid her brother in the earth.<br>The king's words crossed the wind.      |
| Bury with permission            | Creon gave leave for this one grave.<br>I laid her brother in the earth.    |
| Tell the guard                  | I gave the guard the hidden plan.<br>He held it with the king's command.    |
| Report the burial               | I spoke of earth beside her table.<br>Dione heard me through.               |
| Report permission before burial | I spoke the promise of a grave.<br>His body waited in the sun.              |
| Report permission after burial  | I told her of the king's consent.<br>She heard the leave that he had given. |
| Report the warning              | I told her what the guard had heard.<br>My words lay open on the table.     |
| Report the permitted burial     | The grave I promised holds him now.<br>I brought that word to Dione.        |

## Saved history

The song follows the durable choice receipts. An early permission report
keeps its words after a later burial. Returning the water late places its
verse later in the song. Each branch keeps its own outcome and report.

The bard's prompt holds one fact: the poem's title and the travelers whose
deeds it holds. He chooses his own words. Authored `recital.claims` links
factual phrases to the earned choices that support them. The same speech
check reads this metadata for every pack. Ordinary story, observation, and
custody checks ground his spoken response.

The pack save keeps a `recitals` record beside its choice receipts. Each
verse records the acting human or AI and the bard's visit turn when known.
Available choice logs identify the original actor. A pruned old receipt keeps
unknown authorship and uses “an earlier traveler” in the poem context.
Existing story choices, items, and flags remain intact.

Shared worlds use rule version 7. Versions 2 through 6 keep their original
bundles for older journal entries. Recorded upgrades use their recorded target
reducer. The current upgrade adds saved journeys and route knowledge while
preserving earlier deeds, positions, and conversations.

Local and shared games use the same travel rule. Human and AI completions
share a durable ledger with their exact sites. The shared journal replays
movement, help, arrival, and poem context. Journey and help cards retain their
causal family so the next destination comes from a fresh meaningful deed.

The opening tests cover all four branches, both permission-report orders,
late water, reload, log pruning, shared play, and journal replay. Travel tests
cover legal steps, blocked passages, shared help, changing destinations, and
arrival. Browser checks follow a fresh harbor journey on desktop and phone.
Separate poem scene fixtures cover the single-line face and conversation at
desktop, phone, small-phone, and landscape sizes.
