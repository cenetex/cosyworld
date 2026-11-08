# RatiRadio cross-world keepsakes

The owner requested that the room-unlocking objects be scattered through the
other worlds, never inside RatiRadio. The Station Key remains at Black Pond, including direct Radio landings.
A direct landing no longer pulls an external item inside when its authored
recovery point is that same external starting place.

An item can opt into `scatterOutside: true`. Installation draws its initial
location using the run seed and item ID. Seedless construction/import defers
the draw until the host assigns its run seed, so shared and browser draws agree. Eligible worlds are the hub and mounted
packs with declared bridges, excluding the item's own pack. Each eligible world
gets one chance regardless of its number of locations. Items from the same pack
use distinct destination worlds before repeating one. The hub offers its active
places; other worlds offer their active, unconditional entry place. Private homes,
optional interiors, disabled worlds and the source world are excluded.

The four Radio keepsakes therefore explore a subset of the six external worlds
in a given run, with all six possible across seeds. More worlds becoming enabled
does not reshuffle existing objects. The existing pack-toggle evacuation handles
objects left in a world that is switched off. This is initial placement, not a
new periodic scatter or a new copy of any object.

The authored holder remains the old starting point for migration. Only an item
still at that holder with empty history is moved. The placement writes one history
line, so later loads are stable. Existing carried objects, deliberate deposits,
room unlock receipts and the living Raven are retained. Revision 1 saves upgrade
to Radio revision 2 without changing earned room progression. Objects recovered
from absent custody return to Black Pond, not the kitchen; loose intentional
Listening Room deposits are not recovered.

The older Radio gate/return acceptance fixture now explicitly represents objects
already collected and left in rooms. `card-radio-scatter.test.mjs` owns fresh
placement, migration, pack toggling and recovery coverage.
