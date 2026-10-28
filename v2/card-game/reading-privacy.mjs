export const privateAudienceAllows = (entry, audience) =>
  !entry?.privateTo ||
  (audience.length > 0 && audience.every((id) => entry.privateTo.includes(id)));

export const validPrivateAudience = (world, audience) =>
  audience === undefined ||
  (Array.isArray(audience) &&
    audience.length > 0 &&
    audience.length <= 10 &&
    new Set(audience).size === audience.length &&
    audience.every((id) => Object.hasOwn(world.actors, id)));

export function audienceMemory(memory, audience) {
  const visible = privateAudienceAllows(memory, audience);
  return {
    ...memory,
    events: memory.events.filter((entry) =>
      privateAudienceAllows(entry, audience),
    ),
    landmarks: (memory.landmarks || []).filter((entry) =>
      privateAudienceAllows(entry, audience),
    ),
    ...(visible ? {} : { text: null, turn: null, privateTo: undefined }),
  };
}
