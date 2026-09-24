# Room conversation history

Each room has a shared conversation. Reloading, returning to a room, and
activity elsewhere preserve the saved speech and public story beats.

`GET /room-history?location_id=<id>&limit=80` returns the latest page for one
room, in oldest-to-newest order. `before=<next_before>` reads an earlier page.
The response includes `has_more`. Page size is between 1 and 200 events.
The browser offers **Earlier conversation** and keeps the reader's place
when the page arrives. Live replies join the same ordered conversation.

The endpoint uses the shared public event policy from `/events`. It checks
the room exists. The browser still applies muted-avatar and transcript
visibility rules. A failed storage read returns 503 and offers a retry.

Speech, image and model replies, published avatar reflections, and public
story beats remain in `world_events`. The indexed query and cleanup share
the event list in `room_history.rs`. Worker progress, hand refreshes, and
other temporary events keep the existing replay limit. Public history grows
with play; the volume checks in [release.md](release.md) still apply.

The schema update indexes existing saved events. Previously deleted messages
need a backup for recovery. A deliberate development world reset clears the
history with the rest of that world. Older releases use the old cleanup rule;
use a forward fix, or disable persistence compaction before a rollback.

Tests cover 25,000 later events, cleanup, reopening the store, room isolation,
backward paging, live replies during paging, movement during a pending read,
world reset, failed reads, and retry.
