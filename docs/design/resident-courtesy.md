# Resident courtesy on arrival

Ordinary AI movement waits for three world turns after a human enters a room,
or after a resident enters a room occupied by a human. Talk, Ask, Give and Trade
hold the addressed resident for two following world turns. This is courtesy,
not consent to an interaction or a permanent lock. A human leaving, disconnecting
or sleeping stops holding a resident. Other humans in the room count too.

Room arrival and addressed interaction stamps are bounded optional actor fields
with validated places, actor IDs and turns. They survive saves and journal replay.
Old saves get a human arrival stamp on the first committed play; waiting does not
refresh it. Existing schema-7 saves remain readable.

Only autonomous Move plans are replaced with Wait. Combat, explicit accepted
Accompany, forced relocation and transport disembarkation retain their rules.
Offstage world life already skips rooms occupied by humans. World-life-disabled
story fixtures keep their existing behavior.

A browser selection is not an authoritative action. This does not promise to
reserve residents indefinitely while a player edits a selection or while a shared
server queue waits beyond the courtesy window. A future queued-intent contract
must authenticate, journal and expire those reservations, without letting a view
or idle client mutate the world. Current arrival/interaction grace is independent
of wall-clock time and client polling.

This changes shared semantics and must ship with a newly minted immutable engine,
after preceding engine changes land. Historical engines must not be rebuilt.
