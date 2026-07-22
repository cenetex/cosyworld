# Story and seventh-visit metrics

CosyWorld measures whether the world gives a player a reason to return. These
signals are diagnostics for product and world health, not player scores. They
must never become streaks, leaderboards, rewards, eligibility rules, or social
rankings.

## Operational definitions

- **Visit:** one authenticated human actor active in the official world on one
  UTC calendar day. Repeated reads, reconnects, and retries on that day remain
  one visit. The seventh distinct day emits `seventh_visit_reached` once.
- **Return:** a later visit by the same pseudonymous player within 30 days of a
  qualifying visit. Cohorts group players by the UTC week of their first visit
  and report first-to-second, first-to-third, and first-to-seventh conversion.
- **Meaningful action:** a successful, player-authored canonical action with a
  durable world effect. Presence, arrival, movement, hand dealing, dice rolls,
  turn bookkeeping, resets, and background system work are excluded.
- **Co-presence:** at least two active human actors share the action's room.
- **Reciprocity:** a human-directed interaction is followed within 30 days by
  an interaction in the reverse direction.
- **Friend/Bond:** a canonical friend or bond relationship change involving
  the player.
- **Pact:** a successful player contribution to a shared craft.
- **Public trace:** the fact that a meaningful action entered the public room
  journal. The event records no narration or prose.
- **World beat seen/answered:** a supported `world.*` beat is seen only after a
  client presents its non-empty authored prose and the server accepts the
  client's exposure receipt. A later successful, meaningful action in that
  room answers the most recent previously seen, unanswered beat. Returning a
  beat from `/state`, polling in the background, or rendering it behind Menu
  does not count.
- **Job/front:** a player contribution to a canonical job update.
- **Stranded/recovered:** the system drops an inactive holder's item, then a
  player later recovers that item.
- **Entitlement denial/hosted entry:** a player cannot enter a gated room, or
  enters through an active host's grant.
- **Solo visit:** a visit with a meaningful action and no co-presence signal.

The protected report compares 30-day return after solo visits, co-presence,
pacts, bonds, and answered beats. Rates use only players whose full 30-day
window has elapsed; each comparison also reports complete and pending window
counts. It also reports unanswered beats, jobs with no update over 128
canonical events, unrecovered stranded items, and rooms with no meaningful
action in the last seven days.

## Privacy contract

Story metrics use scoped, one-way SHA-256 references. Player references are
derived from the official world, its epoch, and the internal actor handle;
session references add the UTC visit day. Locations, other players, items,
jobs, beats, and crafts receive separate scoped references. References are
stable within this schema version but are not portable identifiers.

The table does not store avatar names, account or wallet identifiers, IP
addresses, actor-session tokens, private chat, room speech, narration, journal
prose, prompts, or generated text. Event attributes are a small allowlist of
non-prose booleans, counts, transport names, state revisions, and versioned
exposure ids. The canonical world journal remains the source of truth; story
metrics never change game outcomes.

Operators can delete one player's metric rows with:

```text
POST /moderation/activation/{player_ref}/delete
Authorization: Bearer <COSYWORLD_MODERATION_TOKEN>
```

The route deletes events where the reference is either the player or the
interaction target. It accepts only a `player:v1:` reference returned by the
protected report.

## Delivery and lifecycle

Metric event ids are deterministic. A command retry, repeated render,
reconnect, refresh, or second browser tab therefore resolves to the same row
and cannot inflate a count. Most live metrics are written in the same SQLite
transaction as the canonical journal; the presentation-dependent
`world_beat_seen` signal is written only after its separate receipt is
validated. Instrumentation errors are logged and fail open so analytics cannot
block a world action. The versioned backfill derives supported non-exposure
signals from canonical events without copying event prose and commits its
first-run work in one rollback-safe SQLite savepoint. Canonical events remain
the repair source if metrics are lost, but exposure is deliberately not
inferred from historical delivery.

Exposure ids have the canonical form `world-beat:v1:<journal-sequence>`. The
receipt endpoint accepts `browser`, `cli`, or `agent` transport and rejects an
unknown beat, a stale state revision, a non-renderable event, a mismatched actor
session, or an event outside the actor's visible location. `/state` never
writes an exposure row. The browser acknowledges only after the transcript row
is actually visible in a foreground document; CLI and agent clients
acknowledge after printing or otherwise presenting the authored beat.

Readers include only schema version 2. Version 1 delivery-based exposure rows
and rows with any other schema are excluded from every result and counted as
`unsupported_schema_event_count`. This starts a clean receipt-based cohort
without rewriting old delivery into exposure.

Rows expire after `COSYWORLD_STORY_METRICS_RETENTION_DAYS`, defaulting to 400
days. Purging runs at boot and daily. Set the variable to `0`, `off`, `none`, or
`disabled` for an explicit operator-managed retention policy. Production
Terraform accepts 1–3650 days.
