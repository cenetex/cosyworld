# Record residents awakened by arrival

The local opening ledger persists throughout a journey. `meetCast` recorded
pack meetings, applied arrival choices, then recorded opening meetings. A
choice that awakened a resident in the arriving player's room therefore added
that resident only to the opening ledger. The reciprocal meeting validator
correctly rejected the resulting world, making Travel appear to do nothing.

Record active pack residents again after the arrival choices. Keep the first
pass so existing choices retain their prior meeting context. Both passes use
`??=` and the same turn, so established encounter dates are preserved. Do not
rerun choices or weaken validation. No stored save needs deletion or migration:
the previously valid, unadvanced save can retry the journey normally.

The Radio regression retains a crossed opening ledger, enters Listening Room,
and checks both RATi encounter dates plus save round-trip. The browser journey
uses the same opening-enabled shape. Shared replay uses a new immutable rules
engine because recording the newly active pack resident also applies there.
