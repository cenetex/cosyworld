# Talk is a conversation

Status: Decided by the owner (2026-11-02), with
[#1537](https://github.com/cenetex/cosyworld/issues/1537) and
[#2016](https://github.com/cenetex/cosyworld/issues/2016). The Talk caption
changes in rules 91; the prompt and validator changes follow without a rules
version.

Talk used to read "Vale asks Dione what they want." The words went into both
speakers' prompts, so the asker echoed them ("What would you like, Dione?")
and the reply recited a fact as a rule. Of 13 recorded asker lines on .dev,
8 to 10 were a generic "what do you want" or repeated the caption.

- The Talk offer and its log entry read "Vale has a conversation with
  Dione." The play is the same: the actor speaks first and the other replies.
  Nothing about wants, knowledge or quests changes; those still come from
  the Talk play itself (`wantHeard`, `talkKnowledge`).
- The caption is not spoken. Talk's speech beats carry no caption (see
  [dialogue beats](../../v2/docs/card-table/dialogue-beats.md)).

Replay: the caption is rules text, so it changes in a new bundle. Journals
before rules 91 replay on their own bundles and keep the old wording in their
logs.

## Between us

Status: built for [#2078](https://github.com/cenetex/cosyworld/issues/2078),
with no rules version.

On a return visit, a speaker sees a little of its history with the person it
faces, as its own first-person paragraph after what it knows. It decides nothing; it only
shapes what is said.

- **Sources.** `between-us.mjs` builds one entry per other voice in the scene
  from committed state only: up to two threats between the pair that the
  speaker knows of, from both sides (its grievances against the other, and
  the other's against it), newest incident first; a keepsake the other gave
  it, worded by `lifeFacts`; and the last line each said where the other
  heard it, before this turn. A threat is told in the speaker's own words
  with its age band: "Pip threatened me over the Lamp, a little while ago.",
  "I threatened Pip over the Black cloth, some time ago.", or "Pip picked a
  fight with me, long ago." with no item. A dormant one still shows, told by
  its age. A repaired one adds who made it right (" Pip made it right." or
  " I made it right.") when the speaker knows the repair fact that answers
  it, and is left out when it does not. Only threats show: the other's taste,
  light or noise grievances would say what it dislikes, and the other's
  private inner life never appears. The rules' third-person account of a
  told threat and its repair ("I witnessed this …: Pip threatens Vale …")
  is then left out of what it knows.
- **Shown.** The story service shows the entry for the speaker's listener:
  at most 3 lines and 240 characters, in this order while they fit: the
  newest incident (or the keepsake), their last words, the other facts, then
  mine ("Some time ago, Pip said to me: "…""), with a rough age in the
  knowledge facts' bands. Words already in the talk heard here, or the line
  being answered, are left out, and a fact shown here is removed from what
  it knows. With no shared history there is no paragraph.
- **Trust.** Shared scenes build it from the journal's world in the narrator.
  A local scene's facts must match the facts catalog, and its lines must
  carry the line envelope the service signed, whose turn must be the line's,
  with at most one line from each side
  ([untrusted input](../../v2/docs/card-table/shared-worlds.md#untrusted-input)).
  The line envelope names the speaker, text and turn but not the listener,
  so a local save could quote a line its speaker said to someone else. The
  words are still the service's own; binding the listener needs an envelope
  format change.
- **Validator.** The retired "Between us:" label read back is a scaffold
  echo. Saying a whole line of the history back is an echo, and a six-word
  run of a quoted line is a repeat,
  as for the talk here. Using the history in one's own words, or saying
  "between us" in speech, is fine.
- **Budget.** The offline voice eval's return visit (`returnVisit` in the
  eval fixture) runs at the station, where the last words are already in
  the talk heard there, and again at the pond, where they show. Speech mean
  stays 271 and p95 331, with a max of 354; the conversation p95 is 337
  (#1537).
