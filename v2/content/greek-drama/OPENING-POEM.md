# Before the Burial: exact card and poem text

This is the full copy list for the opening implementation. It contains all
15 card faces and the one verse that appears only in the collected poem.
The lines are authored in `v2/card-game/quest-cards.mjs`. Saved choices select
them. The earlier design proposal supplies the direction; this list records
the exact implemented wording, including the added return after burial.

Each card face has a title and two lines. Its completion label is shown
during its closing moment. The **Poem** button appears after the first earned
verse. It opens the earned verses in the order the deeds happened.

## A place at the table

| When | Exact card text |
| --- | --- |
| Dione has been met; her jar is still due | A jar of water for her hands.<br>A place beside her bread. |
| Her jar has been returned | I set the water by her hands.<br>She kept a loaf of bread for me. |

Returning the jar earns the second pair of lines. Completion label: **Fulfilled**.

## Before the burial

| When | Exact card text |
| --- | --- |
| Antigone has been met or the decree heard; the choice is open | Antigone stands beyond the gate.<br>Her brother waits for earth. |
| Creon grants permission; the rite remains open | Creon has granted this one grave.<br>Her brother waits for earth. |
| Burial in defiance has happened | I laid her brother in the earth.<br>The king's words crossed the wind. |
| Burial under permission has happened | Creon gave leave for this one grave.<br>I laid her brother in the earth. |
| The traveler declines Antigone's request | I told her I would turn away.<br>Her brother waited by the wall. |
| The traveler reports the plan to the guard | I gave the guard the hidden plan.<br>He held it with the king's command. |

Each committed response earns its own pair of lines. Permission earns a
verse while the burial card stays open. The later rite adds a second verse.
Completion labels: **Fulfilled**, **Declined**, or **Reported**, matching the
chosen result.

## What the courtyard knows

| When | Exact card text |
| --- | --- |
| A response has been chosen; Dione is waiting for its first report | Dione keeps a place for me.<br>What shall I bring beside the bread? |
| The burial in defiance has been reported | I spoke of earth beside her table.<br>Dione heard me through. |
| Permission has been reported before the burial | I spoke the promise of a grave.<br>His body waited in the sun. |
| Permission has been reported and the burial has happened; Dione is waiting for the grave report | Her brother rests beneath the earth.<br>Dione waits to hear of him. |
| The completed permitted burial has been reported | The grave I promised holds him now.<br>I brought that word to Dione. |
| Withdrawal has been reported | I told her how I turned away.<br>She kept a place beside her table. |
| The guard's warning has been reported | I told her what the guard had heard.<br>My words lay open on the table. |

Completion label: **Shared**. The fourth row is new wording added during
implementation. It introduces the final report to Dione. The matching
action is **Tell Dione about the grave**.

If permission is first reported after the rite, the poem earns this pair:

> I told her of the king's consent.\
> She heard the leave that he had given.

The card then uses the fourth row until the traveler reports the completed
burial. This keeps the permission report and the grave report distinct.

## Order and saved history

- Returning water late puts its verse later in the poem.
- An early permission report keeps its original wording after the burial.
- A later rite adds a verse and reopens the return card with its grave text.
- Each report earns its verse once. Reload, rest, and travel preserve it.
- Older saves use the same choice receipts. A completed permitted burial
  with permission already shared opens the new grave report.
- Verse order follows the durable choice receipts. Conversation history can
  grow or be trimmed while the poem keeps its earned lines.

The permission route can therefore read: water, permission, permission
report, burial, grave report. It can also read: water, permission, burial,
permission report, grave report. The other three branches each keep their
own response and public-return verses.
