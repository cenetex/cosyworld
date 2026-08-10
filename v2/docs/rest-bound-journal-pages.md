# Rest-bound Journal pages

Status: design contract for implementation

## Decision

The player Journal is an in-world, actor-scoped storybook. It does not update
after every committed event. Rest is the ritual that gives experience a written
form:

- a **short rest** adds one concise sentence to the open leaf;
- a **long rest** closes the waking cycle and publishes one full story page;
- one waking cycle permits at most **three short rests** before another long
  rest is required;
- the full page is narrated from frozen, authoritative evidence by an LLM, with
  a deterministic fallback when inference is unavailable;
- generated prose is a durable derived artifact. It never grants items, changes
  clocks, establishes facts, or becomes the replay source of truth.

The Journal opens as a full-screen reading mode and covers the transcript,
scene cards, and card selector. The room returns intact when the book closes.

## Player experience

### While awake

The book may show the current place and concrete open threads, but it does not
stream a chronological event log. The open leaf shows its existing rest notes
and the next empty ruled line. Ordinary actions remain unwritten until rest.

### Short rest

At a short rest, the game first commits all mechanical recovery and danger
effects. It then freezes the actor-visible story evidence since the previous
rest and queues a note-writing job.

The open leaf immediately gains an `ink drying` line. Once publication
succeeds, that line becomes one sentence of at most 32 words. The note names a
concrete moment or change; it does not summarize mechanics or claim an emotion
the player did not express.

After the third short-rest note, the leaf reads `ready to bind`. Short-rest
recovery is no longer offered until a long rest begins a new waking cycle.

### Long rest

A long rest is available only where the server grants lodged or hearth rest.
It may be taken before all three short rests have been used. Long rest:

1. commits its recovery and world consequences;
2. freezes all actor-visible evidence since the prior long rest;
3. closes the open leaf;
4. queues a full-page narration job;
5. resets the short-rest allowance to zero;
6. opens a fresh blank leaf for the next waking cycle.

The closed page initially reads `The ink is drying.` It becomes a title and
roughly 180–240 words of close third-person storybook prose. The existing short
rest sentences remain visible as marginal notes and are supplied as anchors to
the page writer.

Long-rest mechanics never wait for prose generation. A provider outage cannot
prevent recovery, consume a second rest, or leave the rest transaction half
committed.

## Rest rules and existing rest grades

The existing server-owned entitlement grades map cleanly onto the new cadence:

| Entitlement | Rest choices | Journal result |
| --- | --- | --- |
| Camp | short rest only | one sentence; frontier danger may still advance |
| Lodged | short or long rest | one sentence or one completed page |
| Hearth | short or long rest | one sentence or one completed page; full recovery remains authoritative |

The client submits `rest_kind: short | long` against a certified action offer.
It never chooses or upgrades the recovery grade. The server continues to derive
the entitled grade from place, lodging, sanctuary, and equipped shelter.

A long rest may happen with zero, one, two, or three short-rest notes. The
three-rest limit is a ceiling, not a requirement to grind rests before sleep.
Worldpack validation must guarantee a reachable lodged or hearth recovery path
before a campaign can make exhaustion or the three-rest ceiling consequential.

## Voice of the book

The Journal is an enchanted chronicler, not a puppet for the player character.
Its voice is:

- close third person, warm and concrete;
- attentive to places, people, carried things, promises, and consequences;
- willing to leave uncertainty unresolved;
- never omniscient;
- never written as the player's private opinion unless the player explicitly
  authored that opinion in a visible action or message.

Good:

> Rati tucked the Story Button away, and four travelers carried the small
> moment with them.

Bad:

> Rati finally understood that the button represented their fear of change.

The second sentence invents interiority and symbolic meaning not present in the
committed evidence.

## Authoritative model

Journal prose is actor-scoped because two players may witness different parts
of the shared world. Its evidence may include:

- public events the actor was present to observe;
- the actor's own actions and outcomes;
- public speech visible to that actor;
- the actor's own explicitly published thoughts or dreams;
- durable world changes learned through play.

It excludes resident-private context, moderation data, hidden topology,
unrevealed checks, other actors' private reflections, provider reasoning, and
events after the rest checkpoint.

The action journal remains canonical. Journal pages are persisted projections
with exact evidence references and can always be deleted and rebuilt from their
frozen generation inputs without changing world state.

## Projection state

Each actor has one `JournalVolumeState`:

```text
JournalVolumeState
  actor_id
  cycle_number
  short_rests_since_long       0..3
  observed_after_seq
  open_leaf
    leaf_id
    opened_by_long_rest_seq
    status                     open | ready_to_bind
    notes[0..3]
      note_id
      rest_event_seq
      source_event_seqs[]
      observed_through_seq
      location_id
      status                   pending | published | fallback
      content_id?
      text?
  pages[]
    page_id
    page_number
    long_rest_event_seq
    source_event_seqs[]
    observed_through_seq
    location_id
    note_ids[]
    status                     pending | published | fallback
    title_content_id?
    body_content_id?
    prompt_version
    ai_publication_receipt?
```

The runtime snapshot stores this projection. Every mutation that changes it is
also journaled, versioned, and replay-tested.

The player state response exposes a bounded view:

```json
{
  "journal": {
    "protocol": "cosyworld.journal.v1",
    "short_rests_since_long": 2,
    "short_rest_limit": 3,
    "open_leaf": {
      "status": "open",
      "notes": [
        { "status": "published", "text": "..." },
        { "status": "published", "text": "..." }
      ],
      "empty_lines": 1
    },
    "pages": [
      {
        "page_number": 7,
        "status": "published",
        "title": "The path under rain",
        "body": "...",
        "marginal_notes": ["...", "..."]
      }
    ]
  }
}
```

Only a bounded recent suffix is sent with room state. Older pages use a
paginated actor-authorized endpoint.

## Committed events and mutations

The implementation adds explicit event vocabulary rather than inferring rest
boundaries from incidental tag clears:

- `rest.completed` — actor, rest kind, entitled grade, location, cycle number;
- `journal.note.requested` — frozen evidence boundary for a short-rest note;
- `journal.note.written` — published or deterministic-fallback content;
- `journal.page.requested` — frozen evidence boundary for a long-rest page;
- `journal.page.written` — published or deterministic-fallback title/body.

`rest.completed` is committed in the same transaction as recovery. Requested
events and queued jobs are inserted atomically with that rest. Written events
arrive later through an actor-consequence journal record.

Stable idempotency keys are derived from canonical identity, never wall time:

```text
journal-note:<world-id>:<epoch>:<actor-id>:<cycle>:<slot>:<rest-seq>
journal-page:<world-id>:<epoch>:<actor-id>:<cycle>:<long-rest-seq>
```

Retry, reconnect, journal replay, or two workers claiming the same job cannot
publish duplicate notes or pages.

## Frozen generation input

The rest transaction stores a compact `JournalWritingJob` containing:

- actor and Journal cycle identity;
- rest kind and rest event sequence;
- source location and authored location description;
- `observed_after_seq` and `observed_through_seq`;
- the exact admitted source event sequences;
- curated `JournalBeatView` headlines in chronological order;
- names and content references needed to ground those headlines;
- existing short-rest notes for a long-page job;
- prompt version and publication policy version.

The worker never queries `whatever is recent now`. That would let events after
the rest leak backward into an earlier page and make retries nondeterministic.

## LLM publication contract

### Short-rest note

- one sentence;
- 12–32 words;
- one concrete moment, relationship change, discovery, or consequence;
- no title;
- no mechanics, category labels, event types, rolls, IDs, or instructions;
- no invented dialogue or interiority.

### Long-rest page

- title of 2–8 words;
- 180–240 words in 3–5 short paragraphs;
- chronological enough to remain understandable, but allowed to group related
  evidence into a narrative movement;
- includes at least one concrete place or person when evidence supplies one;
- may end on an unresolved thread already present in the evidence;
- does not manufacture closure, causality, motives, dialogue, or discoveries.

The existing certified-voice route can supply model routing, safety checks,
bounded attempts, and an `AiPublicationReceipt`, but Journal writing needs its
own feature and prompt versions:

```text
feature: journal_short_rest_note | journal_long_rest_page
prompt:  journal-short-rest-v1 | journal-long-rest-v1
mode:    prose
```

The publication gate additionally verifies:

- every named person, place, and item is grounded in the frozen input;
- output contains no dotted machine keys, sequence numbers, roll notation, or
  second-person commands;
- short note sentence and word limits;
- long page title, paragraph, and word limits;
- no statement turns an unresolved or failed event into success;
- generated text does not duplicate an earlier page for the actor.

## Deterministic fallback

Inference is optional. After bounded provider attempts, the job publishes a
fallback derived from the same curated beats:

- short rest: the highest-salience new beat as one complete sentence;
- long rest: a deterministic title from the dominant category, followed by
  chronological beat sentences grouped into short paragraphs and capped to the
  page limit.

Fallback content is marked `fallback` in internal projection state but is not
apologetic player copy. The page still belongs in the book. A later provider
recovery does not silently rewrite it; explicit regeneration would be a
separate, audited operation.

## UI contract

The full-screen Journal contains:

1. **Book header** — title, current volume, location, and close control.
2. **Current leaf** — up to three short-rest sentences and empty ruled lines.
3. **Bound pages** — one full page per long rest, newest first on open, with
   earlier/later page turns.
4. **Bookmark** — current place and open threads, visually separate from the
   authored history.

The UI never reconstructs page cadence with local storage and never asks an LLM
from the browser. It renders only server-projected Journal state. Pending jobs
show in-world copy such as `The ink is drying.` Raw `journal_beats` remain an
internal projection and may support moderation or diagnostics, but leave the
production reading surface once `cosyworld.journal.v1` is available.

Opening the Journal hides the transcript, room art, status strip, and card
selector. Closing it restores the same hand and focus without recomposition.
Escape closes the book. Page-turn controls remain keyboard accessible.

## Failure, privacy, and replay rules

- Rest commits before generation and succeeds independently of generation.
- A failed job cannot roll back recovery or advance the rest count again.
- Job retries use frozen input and the same generation key.
- Journal pages never enter group chat or the public room memory.
- Another player cannot fetch an actor's Journal without that actor's session
  or an explicit future sharing action.
- Snapshot replay produces byte-equivalent Journal cadence and page identity.
- LLM output is replayed from committed content; replay never calls a model.
- Compaction retains page content and its evidence boundary as part of the
  actor projection.
- Dev reset clears Journal projections with the rest of the local world.

## Implementation sequence

### Slice 1 — rest vocabulary and cadence

- add certified `short` and `long` rest choices;
- commit `rest.completed` explicitly;
- persist `JournalVolumeState` and the three-short-rest ceiling;
- project the empty current leaf and deterministic pending entries;
- verify journal replay and snapshot round trips.

### Slice 2 — durable writing jobs

- add `JournalWritingJob` to the existing actor-job queue;
- atomically insert note/page jobs with the rest transaction;
- publish deterministic fallbacks first;
- add actor-authorized page pagination.

### Slice 3 — certified LLM prose

- add the two prompt envelopes and publication gates;
- store AI publication receipts and exact evidence references;
- exercise provider failure, retry, duplicate claim, and restart recovery.

### Slice 4 — finish the book UI

- replace live chronological beats with `state.journal`;
- render the current leaf, pending ink, bound pages, and rest cadence;
- add focus restoration, larger-text, screen-reader, and mobile checks;
- keep raw history in operator tooling only.

## Required tests

- zero, one, two, and three short rests before a long rest;
- early long rest and short-rest ceiling enforcement;
- camp cannot request long rest; lodged and hearth can;
- rest mechanics commit when inference is absent or rejected;
- events after the rest checkpoint never appear in that note or page;
- one rest creates exactly one job and one published artifact across retries;
- restart between requested and written states resumes safely;
- replay never invokes inference and reproduces page identity/content;
- one actor cannot read another actor's pages;
- no hidden event, resident-private memory, debug key, or unsupported name is
  admitted to a prompt or published page;
- full-screen Journal covers chat and cards at desktop and mobile sizes and
  restores them unchanged when closed.
