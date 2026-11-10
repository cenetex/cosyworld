# Three-room lamp integration

The owner's final choice replaces turn drain with three lit room visits. The
filled room counts first; entering a fourth lit visit exhausts the lamp. Returns
count as visits. Stowed travel defers its charge until the lamp is held or placed.
Waiting, talking and same-room hand changes do not consume fuel. The existing oil
flask still refills an empty lamp in the same carrier's custody and respawns.

The shared and local quiet hand command use the same settlement. A fueled lamp
lights while held or placed, not merely possessed. Light and Snuff are no longer
current actions. Receipt hand selection and light settle before recorded action
observations. Opening stow anchors the mirror without advancing the turn.

Room metadata is persisted alongside the old integer fuel projection (four fuel
units per room), so authored conditions keep a consistent tank fraction. Released
saves migrate by rounding their remaining tank fraction up to a usable room;
accepted logs and item histories are not rewritten. Invalid partial room metadata
is rejected. Released engine bytes remain pinned; integration uses new rules 130.

This draft replaces the staged held-choice candidate #2534, not its history.
The room-light visual candidate #2535 remains separate. Stale #2561's oil-as-light
prototype is not this design. Lamp adapter and room-fuel helper join the reviewed
shared bundle import graph and public asset list. No new UI widget is introduced.

Large-Change: Held choice, lamp authority, migration and their direct regressions
must activate together. A source-only held-choice deployment would diverge from
the pinned server and leave lamp/crossing observations inconsistent.

Required gates include authentic rules-128 history preservation, real Rust store
journal replay after deleting checkpoints, desktop/phone holds and reloads, and
the full regression suite. Passing focused tests does not substitute for legacy
fixture migration or the broader suite. This remains a draft until those gates
and independent review are complete.

## Atomic crossing and resident settlement

Greek revision24 replaces the cover/uncover signal with `unlockWhen`, a bounded
list of existing-style authored conditions on a transport crossing. A grounded
lit lamp at Black Pond and an actor there selecting the cloth reveal the ship.
`in_hand` deliberately differs from older `held` custody vocabulary. The same
settlement runs on quiet hand changes and actual plays, including residents.
Discovery remains latched, old completed signals keep discovery, partial signal
fields retire without rewriting logs, and occupied voyages retain access.
Bell ringing/put-down redesign and mystery-card UI are separate followups.

Resident lamp selection probes actual authored routes with isolated candidate
hand/light state. A home's `light` flag denotes its resource, not the desired
on/off state: interpreting it as brightness trapped Pip in the attic. The
regression retains240-play liveness and1000-play save-validity assertions.
Crossing finalization follows voyage cargo/light settlement, not stale pre-voyage
light. `validateWorld` checks room metadata, known fuel location and projection.
