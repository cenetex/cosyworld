// Pure room-fuel state shared by the current local and server lamp adapter.
// The adapter owns custody, active hands, refilling and save upgrades.
export const LAMP_ROOM_LIMIT = 3;

const validPlace = (place) => typeof place === "string" && place.length > 0;
// Validates persisted fuel metadata only; lampRoomFlame checks derived light.
export function validLampRoomFuel(state) {
  return Boolean(
    state &&
      Number.isInteger(state.fuelRooms) &&
      state.fuelRooms >= 0 &&
      state.fuelRooms <= LAMP_ROOM_LIMIT &&
      validPlace(state.fuelPlace) &&
      typeof state.fuelVisit === "boolean",
  );
}
function checkPlace(place) {
  if (!validPlace(place)) throw new Error("Choose a lamp location.");
}
function burning({ held = false, grounded = false }) {
  if (
    typeof held !== "boolean" ||
    typeof grounded !== "boolean" ||
    (held && grounded)
  )
    throw new Error("Choose one physical lamp position.");
  return held || grounded;
}

// A new tank includes the room where it was filled, even when stowed there.
// This only describes fuel: it never consumes a flask or moves an item.
export function filledLampRoomFuel(place) {
  checkPlace(place);
  return { fuelRooms: LAMP_ROOM_LIMIT, fuelPlace: place, fuelVisit: true };
}

// Released turn-fuel saves store an integer 0..12. Keep their tank fraction,
// rounded up to a usable room. Unsupported fuel-less prototypes are rejected.
// The caller supplies a resolved place; no historical record is edited here.
export function roomFuelFromTurns(fuel, place) {
  if (!Number.isInteger(fuel) || fuel < 0 || fuel > 12)
    throw new Error("Expected released lamp fuel between zero and twelve.");
  return { ...filledLampRoomFuel(place), fuelRooms: Math.ceil(fuel / 4) };
}

// Call after each actual lamp location or hand change, regardless of carrier.
// A dark arrival defers its charge until lit. Each return is a new visit, but
// staying, talking, waiting and same-room hand toggles never spend fuel.
export function settleLampRoomFuel(
  state,
  { place, held = false, grounded = false },
) {
  if (!validLampRoomFuel(state)) throw new Error("Invalid lamp room fuel.");
  checkPlace(place);
  const burns = burning({ held, grounded });
  const counted = state.fuelPlace === place && state.fuelVisit;
  const spent = burns && !counted && state.fuelRooms > 0;
  const fuelRooms = state.fuelRooms - Number(spent);
  return {
    fuelRooms,
    fuelPlace: place,
    fuelVisit: counted || spent,
    lit: burns && fuelRooms > 0,
  };
}

export function lampRoomFlame(state) {
  if (
    !validLampRoomFuel(state) ||
    typeof state.lit !== "boolean" ||
    (state.lit && !state.fuelRooms)
  )
    throw new Error("Expected a settled lamp state.");
  return state.lit
    ? ["", "A low flame", "A smaller flame", "A steady flame"][state.fuelRooms]
    : "Unlit";
}
