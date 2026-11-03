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
faces, under "Between us:" after "What I know". It decides nothing; it only
shapes what is said.

- **Sources.** `between-us.mjs` builds one entry per other voice in the scene
  from committed state only, in this order: the latest incident between the
  pair that the speaker knows (its own grievance first, then the other's
  against it; active, dormant or repaired), worded by the knowledge fact
  template ("I witnessed this some time ago at Empty station: Vale threatens
  Pip over the Black cloth."); a keepsake the other gave it, worded by
  `lifeFacts`; and the last line each said where the other heard it, before
  this turn. The other's private grievances and inner life never appear: an
  incident shows only when the speaker holds its fact.
- **Shown.** The story service shows the entry for the speaker's listener:
  at most 3 lines and 240 characters, the incident, the keepsake, their last
  words, then mine ("Pip last said to me, some time ago: …"), with a rough
  age in the knowledge facts' bands. Words already in "Recent talk here", or
  the line being answered, are left out, and a fact shown here is removed
  from "What I know". With no shared history there is no section.
- **Trust.** Shared scenes build it from the journal's world in the narrator.
  A local scene's facts must match the facts catalog, and its lines must
  carry the line envelope the service signed, whose turn must be the line's
  ([untrusted input](../../v2/docs/card-table/shared-worlds.md#untrusted-input)).
- **Validator.** "Between us:" is a scaffold label. Saying a whole line of the
  section back is an echo, and a six-word run of a quoted line is a repeat,
  as for the talk here. Using the history in one's own words, or saying
  "between us" in speech, is fine.
- **Budget.** The offline voice eval's return visit (`returnVisit` in the
  eval fixture) measures 304 and 321 tokens. Speech p95 stays 331 and the
  conversation p95 337 (#1537).
