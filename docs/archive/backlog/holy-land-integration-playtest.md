# Holy Land Integration Playtest — Backlog

**Outcome**: A traveler can discover, enter, and continue through The Holy Land
without leaving the browser, seeing composition/debug vocabulary, or having
the game invent an unrelated motive for their directly controlled avatar.

**Status**: Groomed from the first end-to-end official-world playtest on
2026-07-28. Pack-owned bridge terminology and generation-policy alignment are
implemented locally; runtime work remains in the linked issues.

| Ticket | Issue | Priority | Owner |
| --- | --- | --- | --- |
| HLI-1 — keep every legal action reachable | [#529](https://github.com/cenetex/cosyworld/issues/529) | P1 | action hand and browser |
| HLI-2 — separate route identity from waypoint prose | [#333](https://github.com/cenetex/cosyworld/issues/333) | P2 | topology and generated places |
| HLI-3 — isolate direct-avatar reaction context | [#530](https://github.com/cenetex/cosyworld/issues/530) | P1 | actors and voice prompting |

## Evidence

The playtest began at The Cosy Cottage, discovered the public Holy Land pack,
and reached Bethlehem through two generated frontier rooms. It proved the
pack graph, bridge ownership, generated journey, card art, and Bethlehem room
content all work together. It also exposed three integration failures:

1. After Rain-Soft Garden, Mossbell Inn, and Homeroom were discovered, the
   remaining legal Cottage Search action was no longer reachable through the
   compact browser hand. The ordinary command API had to reveal Bethlehem.
2. Deterministic fallback waypoint names surfaced as
   `Cosy-Bethlehem Bramble Mile` and `Cosy-Bethlehem Lantern Bend`, mixing a
   pleasant place-name suffix with technical endpoint provenance. The same
   rooms offered the generic `Place a lasting fixture` contribution.
3. On entering Bethlehem, Lila grounded her reaction in its stones and welcome
   but appended an unrelated plan to retrieve Hearth Tonic from The Cosy
   Cottage. Direct-controller speech received stale economy-derived continuity.

At Bethlehem, inspecting the room correctly discovered Jerusalem. A second
reachability case then appeared: the reverse long-route Scout toward The Cosy
Cottage could dominate the newly legal Scout toward Jerusalem.

## Pack-owned slice

The pack and its official-world bridge can own terminology, declared
generation policy, media style, and migration:

- The Holy Land now declares the runtime's current
  `pathway-content-v2` prose contract.
- The Core + Holy Land bridge declares that same ecology-grounded prose
  contract and Holy Land cairn terminology for its generated descendants.
- Both policy revisions preserve existing generated descendants.
- A focused worldpack test protects the Twelve's unique search motives, the
  absent authored Christ, current prose policy, bridge media binding, cairn
  vocabulary, and migration declarations.

The pack cannot redefine the authoritative action-hand projection, browser
reachability, deterministic runtime fallback naming, or direct-avatar prompt
redaction. Those remain core work in HLI-1 through HLI-3.

## Acceptance gate

1. A fresh browser-only traveler can reveal Bethlehem even when every other
   Cottage route is already known.
2. When several legal Scout destinations exist, each is reachable and named
   by destination.
3. Generated cross-pack waypoint actions say `Build a cairn`, not
   `Place a lasting fixture`.
4. Generated waypoint names do not include endpoint-composition prefixes;
   canonical route identity remains available in technical inspection.
5. A directly controlled arrival reaction cannot cite an unrelated economy
   motive unless the triggering event or visible room context names it.
6. Existing generated descendants survive both pack policy upgrades.
