// Stored entries keep their values. A newly met peer starts at zero.
export const trustValue = (world, actor, other) =>
  world.actors[actor]?.trust?.[other] ?? 0;

export function validTrust(trust, actor, actorIds) {
  return (
    trust !== null &&
    typeof trust === "object" &&
    !Array.isArray(trust) &&
    Object.entries(trust).every(
      ([other, value]) =>
        other !== actor &&
        actorIds.has(other) &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 3,
    )
  );
}

// Local objects and the shared JSON host use the same helper order.
export const trustedActors = (world, actor, actorIds) =>
  actorIds.filter((other) => trustValue(world, actor, other) > 0);
