# Preserve accepted action history

A current action list is not the schema of an old event log. Rules 128 accepted
`light`, `snuff`, `cover`, and automatic `refuel` records. Retiring their current
play paths must not reject or rewrite those records during save loading or a
shared-world upgrade. Keep them in the historical validator's verb allowlist;
all existing sequence, identity, and event-shape validation still applies.

The regression test runs the unchanged released rules 128 with a pinned copy
of its content from main `562c8193de91b2b9591b4dda4dc531734dd2af23`. It creates
real accepted records, checks the old engine can still view each world, then
checks local round trips and the current source shared-upgrade boundary retain
all log records, event sequence, turn, item custody, and discovered crossings.
It also checks malformed sequences and unknown verbs remain rejected.

This change does not choose lamp mechanics, restore removed actions, change a
released bundle, or mint a rules version. Source-upgrade tests do not prove
native QuickJS journal replay or a deployed upgrade; those gates remain needed
before a future authorized rules release.
