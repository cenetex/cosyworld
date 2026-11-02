# Dialogue beats and the depth stack

The dialogue box shows **what is happening now**. It is not a chat log that
scrolls forever. Remembering the past is a choice the player makes: they step
back through the stack, or they open Memory.

## Beats

A beat is one character's moment in the scene:

- their spoken line for that turn, or "…" when their voice did not come;
- their own committed actions that turn, as short italic captions with an icon.

Each caption is one plain sentence, worded from the committed event's fields
with no AI: sentence case, closing punctuation, short enough for one phone
line (it truncates with an ellipsis). For example "Pip asked Vale for the Lamp,
but was refused.", "Vale offered the Black cloth for the Oil flask, but the
keeper refused.", "The keeper left for the station." and "Vale found the
Lamp." A blow is described, never counted: "Pip struck Vale. Vale
stumbled." The number stays in the resolve pips. Each severity has a small
fixed word set (1: stumbled, staggered back; 2: fell, took a hard knock; 3 or
more: took a big hit, went down hard), picked by the event's seq so replay
shows the same words. A guarded blow is "braced and took only a glancing
blow", a yield is "gave way", and the defeat is "was beaten and sent home".

| Icon   | Captions                                                                           |
| ------ | ---------------------------------------------------------------------------------- |
| ➜      | arrivals, departures, travelling with someone                                      |
| ⚔     | threaten, brace, strike and how the blow landed, a standoff ending                 |
| ↳      | a defeat on the loser's beat: "Vale was beaten and sent home.", "You came to at …" |
| ⇄      | give, trade and ask, including refusals                                            |
| ✦      | discoveries, a want met, a pack choice                                             |
| ⛽     | refuelling                                                                         |
| ✋ ◌ ♪ | take or put down, light or snuff, ring                                             |

Each glyph is the caption's data key. The table draws it as a line-art SVG in
the toolbar's style (`beatIcons` in `app.mjs`): a hand for take, a smoking
candle for snuff, a bell for ring, a drop over a lamp for refuelling.

An action with no speech is a beat with only the portrait and its caption.
A character's actions join their first spoken beat of that turn.

Only events at the player's current place, during the current visit, become
beats: what the player's avatar could witness. Beats are read from committed
journal events and published speech. They add nothing to saves or the shared
journal, so local and shared play group the same events the same way.
`v2/card-game/beats.mjs` owns the grouping; `test/card-beats.test.js` checks it.

Speech beats follow speaking order. An action-only beat sits at its first
action, which is before that turn's speech, so a departure peeks behind the
reply that followed it. While a reply is being written, the front card is the
waiting speaker with Thinking and their committed actions; their action-only
beat folds into it.

## The depth stack

Beats are cards in depth, not rows in a scroll:

- The current beat is the front card, at full size.
- Exactly one earlier beat is a card behind it in depth: the same card,
  scaled to about 94%, dimmer and raised so one line of its top edge peeks
  out above the front card, which casts a soft shadow on it. That line is the
  speaker, the speech and its first action, truncated.
- The front card puts the name on top at every size: portrait and name share
  the header row, the speech runs the full width below, and the action
  captions sit under the speech. The card grows to show the whole line, up to
  about seven lines (fewer on a short phone screen), with no scrollbar. On a
  phone only the first action shows, as one truncated line.
- On phones and tablets, and on wide screens while the hand is raised, the
  stack sits in a fixed box over the hand's foot.
  The card behind peeks out inside the box, one dimmed line as on wide
  screens, and the front card takes the rest; a long line scrolls inside it.
  Tap the card behind, swipe or use the arrow keys to step back in time.
- A new beat arrives in front. The front card recedes into the behind slot and
  the old behind card fades away deeper.
- Going back is going back in time. Tap the card behind to step back; it comes
  forward and the beat before it appears behind. Tap the front card to step
  forward, or to finish the line at once while it is still being written.
- One "● live" control appears only when the player is behind live. It counts
  the newer beats: "● live · 3". There are no previous and next arrows.
- Desktop also steps with ↑ and ↓ and the wheel over the stack. Phones swipe:
  down brings the earlier card forward, up steps toward live.
- Steps fade and settle in about 300 ms, eased out, with 2D transform and
  opacity only. The new front card fades in as it eases into place. The old
  front card is an inert copy at its exact box that fades out as it eases
  back into the behind slot, or forward out of the way when stepping back, so
  nothing pops, reflows, or shifts the stack's layout. Reduced motion
  crossfades: the old cards' copies fade out over the new ones in 160 ms.
- The front and behind cards are buttons, so they move by CSS keyframes named
  in `data-motion`, never `element.animate()`: after a modal dialog closes,
  Chromium can give an animated card a style cached while the page was inert,
  and the card stops taking clicks. Only the leaving copies, which never take
  pointer hits, use Web Animations, and they rest invisible and are removed
  when their fade ends. `v2/scripts/smoke-card-beat-stack.mjs` checks both
  directions frame by frame and that the front card takes clicks afterwards.

## The action beat

A ready or pending play is a beat too: the action beat, in front of the
stack, with small cards of who acts and what it acts on, what the play will do ("Vale takes the
Burial Decree.") and its buttons (the play, Cancel play, Nudge or Look) under
the status line. The spoken beat settles behind it as one dimmed line that
still takes taps. When the play commits or is cancelled the action beat leaves
and the spoken beat returns; after a play it rests until the player chooses a
card or taps the raised hand. A shared play the server refused or did not
confirm brings the beat back with its button, so the player can try again.
The hand never moves for it.

Combat keeps its stage animations. Each fighter's step also becomes a beat as
it lands, for example "⚔ Pip struck Vale. Vale stumbled.", and the defeat lands on
the loser's beat.

## Memory

The Memory panel replaces the Conversation chat log. It is opened on purpose
from the toolbar. It shows the same beat cards, grouped by visit with the
place's name, newest visit first. Save conversation still exports the spoken
lines.

## Accessibility

The live region announces only the newest beat when it arrives, never a beat
the player stepped back to. The behind card and the front card are buttons, so
earlier beats are reachable by keyboard. ↑ and ↓ work while focus is in the
stack. A play leaves focus on the hand card that made it.
