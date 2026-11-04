# Dialogue beats and the depth stack

The dialogue box shows **what is happening now**. It is not a chat log that
scrolls forever. Remembering the past is a choice the player makes: they step
back through the stack, or they open Memory.

## Beats

A beat is one character's moment in the scene:

- their spoken line for that turn, or "…" when their voice did not come;
- the effects that happened while it was the current card, as short italic
  captions with an icon, inscribed onto it.

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

| Icon   | Captions                                                                            |
| ------ | ----------------------------------------------------------------------------------- |
| ➜      | arrivals, departures, travelling with someone, the viewer's own arrival or boarding |
| ⌛     | a wait, a sleep and its wake: "Vale waited a turn.", "Vale woke at dawn."           |
| ⚔     | threaten, brace, strike and how the blow landed, a standoff ending                  |
| ↳      | a defeat on the loser's beat: "Vale was beaten and sent home.", "You came to at …"  |
| ⇄      | give, trade and ask, including refusals                                             |
| ✦      | discoveries, a want met, a pack choice                                              |
| ⛽     | refuelling                                                                          |
| ✋ ◌ ♪ | take or put down, light or snuff, ring                                              |

Each glyph is the caption's data key. The table draws it as a line-art SVG in
the toolbar's style (`beatIcons` in `app.mjs`): a hand for take, a smoking
candle for snuff, a bell for ring, a drop over a lamp for refuelling.

A card the scene holds is written in its card's colour wherever a line or
a caption names it: the tier colour of its level, the same token as its
edge (`level-tiers.mjs`). "Pip" and "the Lamp" in a line take Pip's and
the Lamp's colours. It is a text colour only, with no underline, tooltip
or marker. Names match whole words and exactly: a person's name as
written, so avatars called Ash, Oak, Rue or Sage never light "ash" or
"oak", and a thing or place in any case ("the Lamp", "lamp"). Covered
cards and cards elsewhere stay plain. Every tier colour reads at least
4.5:1 on the beat card and on black. The reveal writes the coloured
letters like any other (`card-names.mjs` wraps its own letter spans), so
its timing, caret and inscriptions are unchanged.

A play's effect never makes a card of its own: it is inscribed onto the card
current when it happened, under its line, writing in letter by letter with
the dialogue's reveal at a quicker beat, 300 to 900 ms a caption (instant
with reduced motion; a tap finishes it). Most plays are like this: only Talk,
Ask and the rules' speech occasions speak (see the card guide), so a silent
play, a Wait included, writes its caption onto the line in front, and the
Thinking card or reply follows as a new card. A new card comes only with a
new line, so "● live" counts lines, never inscriptions. Only an effect with no
card before it in the visit, such as the viewer's own arrival ("Vale boarded
the Greek ship.", "Vale arrived from the Agora."), stands as a card: the
portrait and the caption, which names who acted. Talk is the speech itself
and leaves none. Fights keep a beat for each step (see below).
An inscription counts as revealing: the action beat waits until it is done.
A card shows its latest three effects; Memory keeps them all.

Only events at the player's current place, during the current visit, become
beats: what the player's avatar could witness. Beats are read from committed
journal events and published speech. They add nothing to saves or the shared
journal, so local and shared play group the same events the same way.
`v2/card-game/beats.mjs` owns the grouping; `test/card-beats.test.js` checks it.

Speech beats follow speaking order. An effect is written onto the card
before the reply that followed it, so a departure stays on the card it
interrupted. While a reply is being written, the front card is the waiting
speaker with Thinking; the play's effect is on the card behind it.

## The depth stack

Beats are cards in depth, not rows in a scroll:

- The current beat is the front card, at full size.
- Exactly one earlier beat is a card behind it in depth: the same card,
  scaled to about 94%, dimmer and raised so one line of its top edge peeks
  out above the front card, which casts a soft shadow on it. That line is the
  speaker, the speech and its latest effect, truncated.
- The front card puts the name on top at every size: portrait and name share
  the header row, the speech runs the full width below, and the action
  captions sit under the speech. The card grows to show the whole line, up to
  about seven lines (fewer on a short phone screen), with no scrollbar. On a
  phone only the latest effect shows, as one truncated line.
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
- A new line never pulls a player who stepped back forward: it raises the
  live count, and the exchange waits to write it until they return. Only the
  player's own play or a journey returns them to live.
- The stack holds the whole current visit, as far as the log window reaches
  (the latest 100 rule events and 100 lines), so the last exchange stays a
  few steps back after the next play. A journey starts a new visit; earlier
  visits are in Memory.
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
- When the stack clears (a new game), it fades out over 200 ms instead of
  vanishing: a copy fixed over the page (`fixedGhost`) of the whole panel,
  or of the front card when a ready play keeps the panel, fades and is
  released while the real panel hides at once.
- The copies come from `card-ghost.mjs`, which other leaving cards reuse:
  `pinGhost(card, zIndex)` pins a copy over the card's box with a short list
  of its computed looks (`lookAlike` makes the copy unplaced, for a layer,
  as the hand's falling cards do), `fadeGhost(ghost, keyframe, ms, delay)`
  plays it out and releases it, and `releaseGhost`/`releaseGhosts` drop copies at once, as a
  new game or another tab's save does. A release lets go of the copy's
  pictures before the copy leaves the page, because Chromium never frees an
  image let go after it left. The beat-stack smoke steps back and forward a
  dozen times and checks that the page holds no more nodes than before.

## The action beat

A ready play is a beat too: the action beat, in front of the
stack. It is one row, vertically centred: on the left who acts and what it
acts on, drawn as the quest card pairs them (borderless cut-out figures with
a drop shadow, a little over each other, facing; an item or place a small
borderless picture); in the middle what the play will do ("Vale takes the
Burial Decree.", up to two lines) and the status line; on the right its
buttons (the play, Nudge or Look). Its border takes the level
tier colour (`level-tiers.mjs`) of the rarest card in the play: actor,
target, item or place. A play of Common cards keeps the plain border. The buttons are flush
segments of the box itself, not boxes inside it: full height, split from
the words and from each other by a thin divider, a serif verb centred,
tinting the whole segment on hover, focus and press, with a focus ring for
the keyboard. Where the row is too narrow the buttons wrap into a strip
along the foot under the same divider; the fixed box over the hand on a
phone keeps them on the right and wraps their words instead. ☰ borrows the
same beat for a chosen avatar ([avatar menu](avatar-menu.md)). The spoken beat settles behind it as one dimmed line: the card behind. With
a card chosen the player still steps through the stack: use ↑ and ↓ (from
the hand too), the wheel or a swipe anywhere on the stack, and "● live"
returns. The line crossfades as it steps. A tap on the dimmed line
moves the lines on; it never steps back. Nothing steps back in time without
the player's input. The action beat shows only while choosing
([what is in front](#what-is-in-front)).

When a play commits, its box folds into the stream: it eases down onto the
front card, the beat the play became (its caption line, or the Thinking card
when a reply is coming), and fades as that card arrives, in the stack's
300 ms. The earlier beat recedes behind. Reduced motion crossfades. The
folded line is a beat read from the committed event, so Memory shows it too.
A chosen play's box leaves at once. Until its scene starts (after any scene
being read), the play is one Thinking card: the speaker's portrait,
"Thinking…" and no button. The first tap reads "Tap again to cancel" and the
second cancels; three seconds, Escape or a tap elsewhere puts it back. A play
still waiting is withdrawn and its button returns. A committed one (a shared
play resuming on the server, or a local play awaiting its words) stays saved:
its caption shows with no line, never "undone". Once a
play commits (a local play, or a shared play the room is playing) the beat
leaves and its reply types into the full-size front card. After a play the
beat rests until the player chooses a card or taps the raised hand. Choosing a quest in the open fan takes no
turn, so it does not rest the beat: the chosen top quest still offers Drop
quest. A shared play the server refused or did not
confirm brings the beat back with its button, so the player can try again.
The hand never moves for it.

Combat keeps its stage animations. Each fighter's step also becomes a beat as
it lands, for example "⚔ Pip struck Vale. Vale stumbled.", and the defeat lands on
the loser's beat.

## What is in front

One phase decides what the dialogue box shows (`phase()` in
`v2/card-game/presentation.mjs`, #2017). In order of precedence:

| Phase     | When                                                                          | In front                                   |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| choosing  | the hand has a choice and its play is ready or past the thinking grace        | the action beat, the spoken beat behind it |
| revealing | the live line is being written, or the exchange has more                      | the line, in its full-size card            |
| thinking  | a play is queued, or committed less than 5 s ago, and its words have not come | the Thinking card                          |
| reviewing | the player stepped back behind live                                           | the earlier beat, with ● live              |
| idle      | otherwise                                                                     | the latest beat                            |

The action beat shows while choosing. Choosing cards brings their action
forward while speech keeps writing behind it. The same rule applies to a shared
refusal. A tap on the spoken card finishes its current line.
A reload shows a line already begun in full, and a play whose words were
still on the way asks again, quietly, with its Thinking card. Words that
failed are not asked again. Clicking off the cards, like Escape, clears the choice: the action beat
fades and the full dialogue card comes back.

Every play in flight is one Thinking card with the speaker's portrait: queued
here, sent or waiting at a shared table, or committed with its words still on
the way. A play chosen in an exchange's last reading pause skips the pause,
so its Thinking card comes at once. Cards chosen meanwhile wait behind it.
The Thinking chip shows only on that card, never on a line. Dialogue never
holds play for long: five seconds after a play commits, its slow words stop
holding the hand. The Thinking card stays, a choice comes forward over it,
and the late line types in when it arrives. A play made from that choice
never drops the late line: it waits behind it with its own Thinking card,
locally as at a shared seat, and runs once the line has typed into its beat
or fallen silent, so the next scene is asked after it and the lines keep
their order.

## Words that fail

There is no failure state, note or Retry. Words that do not come (a provider
error, a timeout, a reply the validator or the shared rules refuse, a worker
lost mid-scene) are silence: each avatar due to speak shows "…" on its own
beat, like a quiet JRPG line, and play goes on at once. The "…" is never
voiced or saved, and nothing asks again for it. A line either arrives whole
or is "…": a beat never carries both. The browser makes one quiet automatic
attempt for a temporary error inside the scene's budget before it falls
silent. A busy 429 with a short `Retry-After` is asked again at most twice
inside the five-second Thinking grace; a longer limit is not retried. The metrics still count each outcome as
`voice.failed` or `voice.silent`, with no UI. A reply the scene outgrew while
it was written (its revision moved, so the table drops it) also counts
`voice.mismatch`, and each speaker left "…" by an otherwise good reply counts
`voice.speaker_silent`. The server's `card voice scene` log and `/meta`
`card_voice.scenes` count the rest per speaker, shared plays included.

The server's check (`Check` in `card_narrative.rs`, with `framing.rs`)
refuses meta-talk and narration, not plain speech
([#2016](https://github.com/cenetex/cosyworld/issues/2016)). Assistant
framing is a whole phrase about the chat itself ("as an AI", "the user",
"continue the story"), a sentence that hands over work ("Here is Pip's
line.") or one that notices the player writing ("It seems like you're
creating…"). "It seems so.", "I cannot leave the lamp." and "Of course! Take
it." are speech. A line that names its own speaker is narration unless it
introduces them ("I'm Vale", "call me Vale", "Vale here"). A narration tag
is a speaker and a speech verb after a closing quote (`," I say`); a
quotation inside speech keeps its words. The corpus in `framing.rs` lists
lines that must pass and lines that must fail.

The check flags by default (owner, 2026-11-03). It **blocks** only:
an empty reply; one over its size cap or unfinished (`shape`); an
instruction aimed at a model (`instruction`); system talk (`assistant`); a
run of ten or more words from the prompt's own instructions (`echoed
brief`); and a false world claim (`observable_state`, `custody`,
`story_outcome`); and an answer whose quoted words are all someone else's
(`other speaker`). A blocked reply is retried once, and the retry's system
message ends with a short first-person correction for that reason, such as
"I stay in this moment and speak as myself." (`CORRECTIONS` in
`framing.rs`). Everything else is **flagged**: self-narration, stage
action, narration tag, repeat, atmosphere, a short read-back of a label or
the instructions, third person, an unknown name or item, and an
unpunctuated or cut line. A flagged reply is published as written on its
first attempt, and the server logs `card voice flagged` with its `reasons`
and counts it under `/meta` `card_voice.flagged`.

Before those checks the reply is trimmed, never retried for its shape. A
reply cut at the token cap keeps its complete sentences; only one with none
is `shape`. A line that is only a stage direction ("(I strum my lyre.)") is
passed over, and a stage direction inside a line goes; both flag `stage
action`. A character whose reply opens in narration speaks from its first
line, then its first sentence, that talks to someone ("The rain has begun.
Come in, Pip." publishes "Come in, Pip."), unless the narration tells its
fact. The heard line said back first goes too. An answer in quotes, as the
local model and Mistral continue an opening quote after a heard line, keeps
only the speaker's own spans (`speech.rs`), without their tags or the
narration between them. A span tagged to someone else ("Then stay,” Pip
says), a span that says the heard line back, and the untagged spans after
them until the speaker acts again ("I nod.") are theirs; a reply that keeps
some words of its own publishes them flagged `other speaker`. Speaking first,
a reply in quotes gets the same trim when a dialogue tag follows its words
(`“Menelaus,” I say, my voice low. “You’re here.”` publishes "Menelaus.
You’re here."), flagged `narration tag`; a quotation with no tag ("Keep it
lit," my mother said) is speech and keeps its words. Narration that never talks
(two or more sentences to no one, or a gesture such as "I shift my weight")
is published flagged `self-narration`. A fact the speaker already
witnessed is not added to its view again as the fact it may tell.
A missed fact is still published as `untold`. Facts, the scene and memories
are background any line, thought or persona may say.

In shared play the server finishes a play whose words failed as a silent
scene: no speech op is journaled (exactly as for words that never came, so
replay and the rules are unchanged), the scene record has no lines, lists
the due avatars under `silent`, marks `failed: true` and names the play's
last event in `after`, and the seat frees at once. The table renders that
record, and any older failed record, as "…" (`withSilence` in
`v2/card-game/shared.mjs`).

## Memory

The Memory panel replaces the Conversation chat log. It is opened on purpose
from the toolbar. It shows the same beat cards, grouped by visit with the
place's name, newest visit first, below the avatar's inner life. It has no
title or export button, only a quiet × close in the corner; Escape also
closes it. Settings → Save backup still writes the local world, its log
included; there is no separate transcript export.

## Accessibility

The live region announces only the newest beat when it arrives, never a beat
the player stepped back to. The behind card and the front card are buttons, so
earlier beats are reachable by keyboard. ↑ and ↓ work while focus is in the
stack. A play leaves focus on the hand card that made it.

A chosen play waits for the hand's swap deadline. If the timer wakes early,
it checks the clock again and stays due until the hand has settled.
