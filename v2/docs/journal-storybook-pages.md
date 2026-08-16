# Daily Journal Images

The player Journal is an avatar-private gallery of generated daily page images.
It is not an event log, spreadsheet, progress dashboard, open-thread list, or
room-memory view.

## Cadence

- Camp and lodged rests are short rests for the current Journal cadence. They
  append newly observed semantic beats to the avatar's hidden Journal context.
  Nothing new appears in the book.
- A hearth rest is a long rest. The first long rest for an avatar on a UTC day
  freezes all hidden context accumulated since the preceding generated page and
  queues one page-writing job.
- Further long rests by that avatar on the same UTC day cannot create, replace,
  or revise another page. Later hidden updates remain available for a future
  day's page.
- The stable artifact identity is derived from world, epoch, avatar, and UTC
  day. Retry, reconnect, snapshot restore, and journal replay therefore converge
  on the same page.

## Voice and image

The Journaler LLM receives only bounded, actor-visible semantic updates frozen
at rest. It writes one 55–95 word entry in the avatar's own first-person voice.
The publication gate rejects mechanical vocabulary, IDs, prompt references,
and output without first-person language. Provider failure uses a grounded
first-person fallback derived from the same frozen updates.

When an image-generation capability is configured, it paints those accepted
words and their grounded moments into one immutable portrait Journal-page
image. The deterministic illustrated SVG compositor is the offline fallback,
so page publication never depends on a provider. In either case, the single
page image is the only Journal content shown to the player: there are no
separate prose rows, captions, counters, meters, tables, or logs. Alternative
text preserves the accepted words for accessibility.

## Projection

The actor-scoped state response exposes only the bounded page gallery:

```json
{
  "journal": {
    "protocol": "cosyworld.daily-journal.v1",
    "pages": [
      {
        "actor_id": 5000,
        "day_index": 20600,
        "page_index": 3,
        "artifact_id": "<sha256>",
        "rest_kind": "long",
        "status": "ready",
        "image_url": "/assets/generated/journal-pages/<sha256>.image",
        "image_alt": "The avatar's daily Journal, in their own words: …",
        "style_revision": "cosyworld-hand-painted-page/2"
      }
    ]
  }
}
```

Raw `JournalBeatView` values, room memory, short-rest updates, source sequences,
and Journaler prompts remain server-side inputs. They are not serialized as the
player Journal.

## Failure and replay

- Rest commits before generation and never waits for the Journaler.
- An unavailable Journaler uses deterministic first-person words; an
  unavailable image model uses the deterministic illustrated SVG fallback.
- A pending page is invisible until it is ready; the Journal shows a quiet empty
  state when no generated page exists.
- Publication is a journaled actor-consequence mutation. Replay restores the
  accepted entry and never calls a model.
- Snapshot state contains the hidden accumulator, daily identities, pending
  jobs, and ready pages.
- The generated page route serves only ready artifacts under an unguessable
  SHA-256 identity with private immutable caching.

## Acceptance

- The visible Journal contains at most one generated long-rest image per
  avatar-day.
- Short rests never add visible rows or pages.
- Room memory, raw logs, clocks, progress meters, growth sheets, and open
  threads never appear in the Journal.
- Generated words use `I`, `my`, or `me` and do not read like a system summary.
- Repeated long rests, retries, and replay cannot duplicate a daily page.
