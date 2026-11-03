# Occasion voices publish in shared speech

Status: Fix for a live .dev failure (2026-11-02). The speech check changes in
rules 92; the server's fail-fast and the table's Thinking grace need no rules
version.

Speech occasions (`v2/card-game/speech.json`) name who speaks for a play. A
threat voices only its target, a refusal or a new companion only the target,
a new place only the place, and up to three speakers and the place can speak
together. The shared `speech` operation still accepted one or two lines and
required a lone line to be the acting avatar's. On .dev, Rue threatened Pip
over the Black cloth: Pip's reply came back in under two seconds, and the
rules refused it ("Each line needs a present speaker or the room, and clear
text."). The play then held its seat and the world's worker for the
60-second working lease, and its Retry failed the same way.

- From rules 92, an exchange has one to four lines. Each line still needs a
  present speaker or the room and clear text in the speaker's authored form;
  a lone line may come from any of them.
- When the rules refuse a play's words, the server fails the play at once
  with "The play is saved. Its words need another moment." The committed
  play stays, and the seat is free for Retry or the next play.
- At the table, a committed play's words hold the hand for five seconds at
  most (`THINKING_GRACE_MS`). The Thinking card stays in front; a later line
  types in when it arrives, and the action beat never covers a typing line.

Replay: journals before rules 92 replay on their own bundles. Every speech op
they accepted is still accepted, and the refused ones were never journaled.
