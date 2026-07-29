const routeDirectionAliases = new Map([
  ["n", "north"],
  ["north", "north"],
  ["s", "south"],
  ["south", "south"],
  ["e", "east"],
  ["east", "east"],
  ["w", "west"],
  ["west", "west"],
  ["ne", "northeast"],
  ["northeast", "northeast"],
  ["north-east", "northeast"],
  ["nw", "northwest"],
  ["northwest", "northwest"],
  ["north-west", "northwest"],
  ["se", "southeast"],
  ["southeast", "southeast"],
  ["south-east", "southeast"],
  ["sw", "southwest"],
  ["southwest", "southwest"],
  ["south-west", "southwest"],
  ["u", "up"],
  ["up", "up"],
  ["d", "down"],
  ["down", "down"],
  ["in", "in"],
  ["inside", "in"],
  ["enter", "in"],
  ["out", "out"],
  ["outside", "out"],
  ["exit", "out"],
  ["home", "out"],
  ["homeward", "out"],
]);

export function canonicalRouteDirection(value) {
  if (typeof value !== "string") return null;
  return routeDirectionAliases.get(value.trim().toLowerCase()) ?? null;
}

export function routeDiscoveryPolicy(exit) {
  return exit.discovery ?? "scout";
}

export function routeDiscoveryValidationErrors(exits) {
  const errors = [];
  for (const exit of exits ?? []) {
    if (
      exit.discovery !== undefined
      && !["known", "scout"].includes(exit.discovery)
    ) {
      errors.push(
        `exit ${exit.from_location_id}->${exit.to_location_id} has invalid discovery `
        + `${JSON.stringify(exit.discovery)}; expected "known" or "scout"`,
      );
    }
  }
  return errors;
}

export function routeDirectionValidationErrors(exits, hiddenExits) {
  const errors = [];
  const claims = new Map();

  function claim(locationId, value, owner) {
    const canonical = canonicalRouteDirection(value);
    if (!canonical) {
      errors.push(`${owner} must declare a canonical direction; received ${JSON.stringify(value)}`);
      return;
    }
    const key = `${locationId}:${canonical}`;
    const prior = claims.get(key);
    if (prior) {
      errors.push(
        `${owner} direction ${JSON.stringify(value)} canonicalizes to ${canonical}, `
        + `already claimed from location ${locationId} by ${prior}`,
      );
      return;
    }
    claims.set(key, owner);
  }

  for (const exit of exits ?? []) {
    claim(
      exit.from_location_id,
      exit.direction,
      `exit ${exit.from_location_id}->${exit.to_location_id}`,
    );
  }
  for (const hiddenExit of hiddenExits ?? []) {
    claim(
      hiddenExit.from_location_id,
      hiddenExit.direction,
      `hidden exit ${hiddenExit.id} outbound`,
    );
    claim(
      hiddenExit.to_location_id,
      hiddenExit.return_direction,
      `hidden exit ${hiddenExit.id} return`,
    );
  }

  return errors;
}
