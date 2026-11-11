# Inactive room-fuel helper

`lamp-room-fuel.mjs` prepares pure room-budget calculations. Nothing in the
current game, browser, public assets, or shared engine imports it. This change
activates no behavior, changes no save, and mints no rules version.

A full tank includes the filling room and two more lit visits. A fourth lit
visit exhausts it. Repeated locations count. Stowed arrivals defer their charge
until held or grounded there; same-room toggles and waiting do not charge again.
Grounded light lasts indefinitely. JSON retains both location and visit status.

Migration accepts only released integer turn fuel from zero to twelve and
rounds its tank fraction up to room visits. It rejects missing, fractional,
out-of-range, or nonnumeric inputs. The unmerged oil-co-location prototype is
not a supported input. This helper neither parses nor rewrites world histories.

A later reviewed adapter must resolve the lamp's actual place after every
player/NPC/transport move, derive held versus grounded status, apply save
migration, and preserve the existing automatic same-owner refuel and oil return.
The helper never transfers oil or decides refuel eligibility. Main's Pip wants,
cover/signal/reflection rules and opening validation remain unchanged here.
Activation requires current-main integration tests, a coordinated new shared
bundle, native agreement/replay and browser gates; released129 stays immutable.
