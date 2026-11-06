# Polynices’ Hollow opens through his shade

Greek pack revision 22 replaces the open battlefield exit with a sealed route.
The existing locked card offers a quest to Talk with Polynices’ Shade. Taking
the quest keeps the turn unchanged. The shade appears at night on the battlefield.

A legal Talk by a controlled player records `greek-polynices-heard` through the
existing pack choice system. This opens the route for all travelers and residents.
The route stays open after the shade leaves at dawn. Antigone uses the same route
and waits for this record before choosing the Hollow as her home. A Talk chosen
on the last night turn checks the subject and conditions at that chosen clock;
its effects and receipt belong to the committed turn, even as dawn arrives.

The pack's old `met` record means being in the same place, so it is distinct from
the committed Talk required here. NPC Talk uses the normal resident conversation
path; the pack's Talk choice belongs to controlled players.

Accepted Anoint, Veil or Bury flags also open the route. This preserves progress
in existing funeral saves. The return from the Hollow stays available. The save
upgrade advances the pack revision and retains accepted flags and receipts.

The shared rules bundle is versioned after current main, with earlier bundles
kept byte-for-byte for replay. Source tests cover the lock, quest, Talk, resident
route, partial saves and the current shared bundle. Browser proof covers the
existing locked card and quest flow at desktop and phone widths.
