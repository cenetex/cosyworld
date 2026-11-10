# Continue dialogue after a hand change

A quiet hand choice keeps the committed play and every published line. Local
pending words rebuild from current hand and light facts and ask only entities
that have not published this turn. The remaining Talk speaker receives the
original line as conversation, not a regenerated replacement. Validated stream
lines carry their signed envelopes immediately, including when their transport
is aborted before its final reply. Older unsigned words stay outside prompts.

Request tickets, revisions and turns still fence stale local results. Repeated
choices coalesce. A reload with a pending marker resumes the missing voices;
completed or failed scenes do not restart. New lines can add heard events to a
speaker's memory, but never rewrite that speaker's previously published text.

Shared speech publishes atomically. A hand change while generation is pending
causes its result to be discarded and the same play to be requeued with fresh
facts. A journal hold sequence detects this without confusing unrelated
revision changes with hand changes. A queued/recovered attempt also rebuilds
from current facts before inference. Original speaker and reveal limits remain.
Stale attempts cannot publish speech or launch reflections; completed exchanges
are not requeued. The hand choice and speech still use the existing journal
operations and released rules, so no rules version or save format is changed.

Tests cover repeated choices, partial streaming, immutable words and memories,
reload, shared authentication/attempt fences and journal replay. Browser tests
exercise the real local client with controlled responses; Rust store tests are
the evidence for shared authority and replay.
