const EXTENSION = "x-cosyworld-progression-safety";
const SCHEMA_VERSION = 1;
const PROOF_VERSION = "progression-safety-v1";

const canonicalIdPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9-]*\/[a-z][a-z0-9._/-]*$/;
const custodyEvents = Object.freeze([
  "give",
  "set_down",
  "storage",
  "actor_departure",
  "resident_custody",
  "defeat",
  "installation",
  "exhaustion",
]);
const custodyOutcomes = new Set(["recoverable", "inert"]);
const recoveryModes = new Set([
  "return_to_source",
  "resident_release",
  "storage_release",
  "rescue",
]);
const optionalKinds = new Set(["location", "item", "lead", "slot"]);
const accessKinds = new Set(["mission_key", "reusable_capability"]);
const persistenceKinds = new Set(["permanent", "reclosable"]);
const gateMethodKinds = new Set(["exact_item", "installed_item", "reusable_capability"]);
const escapeKinds = new Set(["return_route", "alternate_route", "rescue", "intentional_one_way"]);
const fatigueEscapeKinds = new Set(["retreat", "camp", "aid", "rescue"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function rejectUnknown(errors, value, allowed, label) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
}

function boundedUnique(value, minimum, maximum, key = (entry) => entry) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return false;
  const keys = value.map(key);
  return new Set(keys).size === keys.length;
}

function validCanonicalId(value, kind) {
  return canonicalIdPattern.test(value ?? "")
    && (kind === undefined || value.includes(`:${kind}/`));
}

function routeKey(fromLocationId, toLocationId) {
  return `${fromLocationId}>${toLocationId}`;
}

function validateRouteEndpoints(errors, route, label) {
  if (
    !isObject(route)
    || !positiveInteger(route.from_location_id)
    || !positiveInteger(route.to_location_id)
    || route.from_location_id === route.to_location_id
  ) {
    errors.push(`${label} must name two distinct positive location ids`);
  }
}

function validateRouteRef(errors, route, label) {
  rejectUnknown(
    errors,
    route,
    new Set(["from_location_id", "to_location_id"]),
    label,
  );
  validateRouteEndpoints(errors, route, label);
}

function validateRecovery(errors, recovery, ids, label) {
  rejectUnknown(
    errors,
    recovery,
    new Set(["id", "version", "source_location_id", "mode"]),
    label,
  );
  if (
    !isObject(recovery)
    || !validCanonicalId(recovery.id, "recovery")
    || ids.has(recovery.id)
    || !Number.isInteger(recovery.version)
    || recovery.version < 1
    || recovery.version > 255
  ) {
    errors.push(`${label} must have a unique canonical id and version`);
  } else {
    ids.add(recovery.id);
  }
  if (!positiveInteger(recovery?.source_location_id)) {
    errors.push(`${label} source_location_id must be positive`);
  }
  if (!recoveryModes.has(recovery?.mode)) {
    errors.push(`${label} mode must be an authored recovery mode`);
  }
}

function validateCustody(errors, custody, label) {
  rejectUnknown(
    errors,
    custody,
    new Set(["recovery_ref", "recovery_version", ...custodyEvents]),
    label,
  );
  if (
    !isObject(custody)
    || !validCanonicalId(custody.recovery_ref, "recovery")
    || !Number.isInteger(custody.recovery_version)
    || custody.recovery_version < 1
    || custody.recovery_version > 255
  ) {
    errors.push(`${label} must reference an exact authored recovery`);
  }
  for (const event of custodyEvents) {
    if (!custodyOutcomes.has(custody?.[event])) {
      errors.push(`${label} must classify ${event} as recoverable or inert`);
    }
  }
}

function validateAccessMethod(errors, method, ids, label) {
  rejectUnknown(
    errors,
    method,
    new Set([
      "id",
      "version",
      "kind",
      "item_id",
      "capability",
      "source_location_id",
      "unlock_routes",
      "persistence",
      "custody",
    ]),
    label,
  );
  if (
    !isObject(method)
    || !validCanonicalId(method.id, "gate")
    || ids.has(method.id)
    || !Number.isInteger(method.version)
    || method.version < 1
    || method.version > 255
  ) {
    errors.push(`${label} must have a unique canonical Gate id and version`);
  } else {
    ids.add(method.id);
  }
  if (!accessKinds.has(method?.kind)) errors.push(`${label} kind is invalid`);
  if (!persistenceKinds.has(method?.persistence)) errors.push(`${label} persistence is invalid`);
  if (
    !boundedUnique(
      method?.unlock_routes,
      1,
      16,
      (route) => routeKey(route?.from_location_id, route?.to_location_id),
    )
  ) {
    errors.push(`${label} unlock_routes must contain 1-16 unique routes`);
  } else {
    method.unlock_routes.forEach((route, index) =>
      validateRouteRef(errors, route, `${label} unlock route ${index}`));
  }
  if (method?.kind === "mission_key") {
    if (!positiveInteger(method.item_id) || !positiveInteger(method.source_location_id)) {
      errors.push(`${label} mission_key must name an exact item and source location`);
    }
    if (method.capability !== undefined) {
      errors.push(`${label} mission_key cannot substitute a reusable capability`);
    }
    validateCustody(errors, method.custody, `${label} custody`);
  } else if (method?.kind === "reusable_capability") {
    if (!nonEmpty(method.capability) || method.capability.length > 64) {
      errors.push(`${label} reusable_capability must name a bounded capability`);
    }
    if (
      method.item_id !== undefined
      || method.source_location_id !== undefined
      || method.custody !== undefined
    ) {
      errors.push(`${label} reusable_capability cannot masquerade as an exact mission key`);
    }
  }
}

function validateOptionalContent(errors, content, label) {
  rejectUnknown(errors, content, new Set(["kind", "id", "missable"]), label);
  if (
    !isObject(content)
    || !optionalKinds.has(content.kind)
    || !(positiveInteger(content.id) || validCanonicalId(content.id))
  ) {
    errors.push(`${label} must name a typed location, item, Lead, or Slot`);
  }
  if (content?.missable !== true) {
    errors.push(`${label} optional side content must explicitly declare missable true`);
  }
}

function validateReclosableGate(errors, gate, ids, label) {
  rejectUnknown(
    errors,
    gate,
    new Set([
      "id",
      "version",
      "from_location_id",
      "to_location_id",
      "required",
      "method_kind",
      "far_side_escape",
    ]),
    label,
  );
  if (
    !isObject(gate)
    || !validCanonicalId(gate.id, "gate")
    || ids.has(gate.id)
    || !Number.isInteger(gate.version)
    || gate.version < 1
    || gate.version > 255
  ) {
    errors.push(`${label} must have a unique canonical Gate id and version`);
  } else {
    ids.add(gate.id);
  }
  validateRouteEndpoints(errors, gate, label);
  if (typeof gate?.required !== "boolean") errors.push(`${label} required must be boolean`);
  if (!gateMethodKinds.has(gate?.method_kind)) errors.push(`${label} method_kind is invalid`);
  const escape = gate?.far_side_escape;
  rejectUnknown(errors, escape, new Set(["kind", "route", "location_id"]), `${label} far_side_escape`);
  if (!isObject(escape) || !escapeKinds.has(escape.kind)) {
    errors.push(`${label} must declare a far-side return, alternate route, rescue, or intentional one-way`);
  } else if (["return_route", "alternate_route"].includes(escape.kind)) {
    validateRouteRef(errors, escape.route, `${label} far_side_escape route`);
    if (escape.location_id !== undefined) {
      errors.push(`${label} route escape cannot also name a rescue location`);
    }
  } else if (escape.kind === "rescue") {
    if (!positiveInteger(escape.location_id)) {
      errors.push(`${label} rescue escape must name a location`);
    }
    if (escape.route !== undefined) errors.push(`${label} rescue escape cannot also name a route`);
  } else if (escape.route !== undefined || escape.location_id !== undefined) {
    errors.push(`${label} intentional one-way escape cannot carry route or location fields`);
  }
}

function validateDiscoveryRef(errors, discovery, label) {
  rejectUnknown(errors, discovery, new Set(["slot_id", "slot_version"]), label);
  if (
    !isObject(discovery)
    || !validCanonicalId(discovery.slot_id, "discovery")
    || !Number.isInteger(discovery.slot_version)
    || discovery.slot_version < 1
    || discovery.slot_version > 255
  ) {
    errors.push(`${label} must reference an exact Discovery Slot`);
  }
}

function validateLeadRef(errors, lead, label) {
  rejectUnknown(
    errors,
    lead,
    new Set([
      "lead_id",
      "lead_version",
      "anchor_id",
      "anchor_version",
      "recovery_ref",
      "recovery_version",
    ]),
    label,
  );
  for (const [field, kind] of [
    ["lead_id", "lead"],
    ["anchor_id", "anchor"],
    ["recovery_ref", "recovery"],
  ]) {
    if (!validCanonicalId(lead?.[field], kind)) {
      errors.push(`${label} ${field} must be a canonical ${kind} id`);
    }
  }
  for (const field of ["lead_version", "anchor_version", "recovery_version"]) {
    if (
      !Number.isInteger(lead?.[field])
      || lead[field] < 1
      || lead[field] > 255
    ) {
      errors.push(`${label} ${field} must be an exact version`);
    }
  }
}

function validateFrontier(errors, frontier, ids, label) {
  rejectUnknown(
    errors,
    frontier,
    new Set([
      "id",
      "version",
      "from_location_id",
      "to_location_id",
      "anchor_id",
      "anchor_version",
      "fatigue_escape",
    ]),
    label,
  );
  if (
    !isObject(frontier)
    || !validCanonicalId(frontier.id, "frontier")
    || ids.has(frontier.id)
    || !Number.isInteger(frontier.version)
    || frontier.version < 1
    || frontier.version > 255
  ) {
    errors.push(`${label} must have a unique canonical frontier id and version`);
  } else {
    ids.add(frontier.id);
  }
  validateRouteEndpoints(errors, frontier, label);
  if (
    !validCanonicalId(frontier?.anchor_id, "anchor")
    || !Number.isInteger(frontier?.anchor_version)
    || frontier.anchor_version < 1
    || frontier.anchor_version > 255
  ) {
    errors.push(`${label} must reference the last secure Anchor at an exact version`);
  }
  if (
    !boundedUnique(
      frontier?.fatigue_escape,
      1,
      4,
      (escape) => `${escape?.kind}:${escape?.location_id ?? ""}:${routeKey(
        escape?.route?.from_location_id,
        escape?.route?.to_location_id,
      )}`,
    )
  ) {
    errors.push(`${label} must preserve a bounded retreat, camp, aid, or rescue escape`);
    return;
  }
  for (const [index, escape] of frontier.fatigue_escape.entries()) {
    const escapeLabel = `${label} fatigue escape ${index}`;
    rejectUnknown(errors, escape, new Set(["kind", "route", "location_id"]), escapeLabel);
    if (!isObject(escape) || !fatigueEscapeKinds.has(escape.kind)) {
      errors.push(`${escapeLabel} kind is invalid`);
    } else if (escape.kind === "retreat") {
      validateRouteRef(errors, escape.route, `${escapeLabel} route`);
      if (escape.location_id !== undefined) {
        errors.push(`${escapeLabel} retreat cannot also name a safety location`);
      }
    } else {
      if (!positiveInteger(escape.location_id)) {
        errors.push(`${escapeLabel} must name a safety location`);
      }
      if (escape.route !== undefined) {
        errors.push(`${escapeLabel} cannot also name a route`);
      }
    }
  }
}

export function progressionSafetyValidationErrors(config, label = "progression safety") {
  const errors = [];
  if (!isObject(config)) return [`${label} must be an object`];
  rejectUnknown(
    errors,
    config,
    new Set([
      "schema_version",
      "proof_version",
      "entry_location_id",
      "required_location_ids",
      "optional_content",
      "recoveries",
      "access_methods",
      "reclosable_gates",
      "required_discoveries",
      "required_leads",
      "frontier_transitions",
    ]),
    label,
  );
  if (config.schema_version !== SCHEMA_VERSION) {
    errors.push(`${label} schema_version must be ${SCHEMA_VERSION}`);
  }
  if (config.proof_version !== PROOF_VERSION) {
    errors.push(`${label} proof_version must be ${PROOF_VERSION}`);
  }
  if (!positiveInteger(config.entry_location_id)) {
    errors.push(`${label} entry_location_id must be positive`);
  }
  if (
    !boundedUnique(config.required_location_ids, 1, 2048)
    || config.required_location_ids.some((id) => !positiveInteger(id))
  ) {
    errors.push(`${label} required_location_ids must be 1-2048 unique positive ids`);
  }
  if (!boundedUnique(config.optional_content, 0, 128, (entry) => `${entry?.kind}:${entry?.id}`)) {
    errors.push(`${label} optional_content must be a bounded unique list`);
  } else {
    config.optional_content.forEach((entry, index) =>
      validateOptionalContent(errors, entry, `${label} optional content ${index}`));
  }

  const recoveryIds = new Set();
  if (!boundedUnique(config.recoveries, 0, 128, (entry) => entry?.id)) {
    errors.push(`${label} recoveries must be a bounded unique list`);
  } else {
    config.recoveries.forEach((recovery, index) =>
      validateRecovery(errors, recovery, recoveryIds, `${label} recovery ${index}`));
  }
  const descriptorIds = new Set();
  if (!boundedUnique(config.access_methods, 0, 128, (entry) => entry?.id)) {
    errors.push(`${label} access_methods must be a bounded unique list`);
  } else {
    config.access_methods.forEach((method, index) =>
      validateAccessMethod(errors, method, descriptorIds, `${label} access method ${index}`));
  }
  if (!boundedUnique(config.reclosable_gates, 0, 128, (entry) => entry?.id)) {
    errors.push(`${label} reclosable_gates must be a bounded unique list`);
  } else {
    config.reclosable_gates.forEach((gate, index) =>
      validateReclosableGate(errors, gate, descriptorIds, `${label} reclosable Gate ${index}`));
  }
  if (!boundedUnique(config.required_discoveries, 0, 128, (entry) => entry?.slot_id)) {
    errors.push(`${label} required_discoveries must be a bounded unique list`);
  } else {
    config.required_discoveries.forEach((discovery, index) =>
      validateDiscoveryRef(errors, discovery, `${label} required Discovery Slot ${index}`));
  }
  if (!boundedUnique(config.required_leads, 0, 128, (entry) => entry?.lead_id)) {
    errors.push(`${label} required_leads must be a bounded unique list`);
  } else {
    config.required_leads.forEach((lead, index) =>
      validateLeadRef(errors, lead, `${label} required Lead ${index}`));
  }
  if (!boundedUnique(config.frontier_transitions, 0, 128, (entry) => entry?.id)) {
    errors.push(`${label} frontier_transitions must be a bounded unique list`);
  } else {
    config.frontier_transitions.forEach((frontier, index) =>
      validateFrontier(errors, frontier, descriptorIds, `${label} frontier ${index}`));
  }
  return errors;
}

function reachableLocations(entryLocationId, exits, excluded = new Set()) {
  const adjacency = new Map();
  for (const exit of exits) {
    const key = routeKey(exit.from_location_id, exit.to_location_id);
    if (excluded.has(key)) continue;
    if (!adjacency.has(exit.from_location_id)) adjacency.set(exit.from_location_id, []);
    adjacency.get(exit.from_location_id).push(exit.to_location_id);
  }
  const reachable = new Set([entryLocationId]);
  const queue = [entryLocationId];
  while (queue.length) {
    const from = queue.shift();
    for (const to of adjacency.get(from) ?? []) {
      if (reachable.has(to)) continue;
      reachable.add(to);
      queue.push(to);
    }
  }
  return reachable;
}

function extensionCatalog(manifests, extensionName, collection) {
  const values = new Map();
  for (const manifest of manifests) {
    for (const entry of manifest?.extensions?.[extensionName]?.[collection] ?? []) {
      values.set(entry.id, entry);
    }
  }
  return values;
}

function generatedRouteOwners(manifests) {
  const owners = new Map();
  for (const manifest of manifests) {
    const generation = manifest?.extensions?.["x-cosyworld-generation"];
    for (const route of generation?.cross_pack_routes ?? []) {
      const [left, right] = route.endpoints ?? [];
      if (!left || !right) continue;
      for (const [from, to] of [[left, right], [right, left]]) {
        owners.set(
          routeKey(from.location_id, to.location_id),
          route.route_owner,
        );
      }
    }
  }
  return owners;
}

function recoveryKey(id, version) {
  return `${id}@${version}`;
}

function descriptorCatalogs(manifests) {
  const slots = extensionCatalog(
    manifests,
    "x-cosyworld-discovery-slots",
    "slots",
  );
  const leads = new Map();
  const anchors = new Map();
  const recoveries = new Map();
  for (const manifest of manifests) {
    const threshold = manifest?.extensions?.["x-cosyworld-threshold-descriptors"];
    for (const lead of threshold?.leads ?? []) {
      leads.set(recoveryKey(lead.id, lead.version), lead);
    }
    for (const anchor of threshold?.anchors ?? []) {
      anchors.set(recoveryKey(anchor.id, anchor.version), anchor);
    }
    for (const recovery of threshold?.recoveries ?? []) {
      recoveries.set(recoveryKey(recovery.id, recovery.version), recovery);
    }
  }
  return { slots, leads, anchors, recoveries };
}

function routeExists(routes, route) {
  return routes.has(routeKey(route.from_location_id, route.to_location_id));
}

function validateGeneratedRouteOwnership(errors, method, routes, generatedOwners) {
  for (const route of method.unlock_routes ?? []) {
    const edge = routes.get(routeKey(route.from_location_id, route.to_location_id));
    if (!edge) continue;
    const fromPack = routes.locationOwners.get(route.from_location_id);
    const toPack = routes.locationOwners.get(route.to_location_id);
    if (fromPack === toPack) continue;
    const owner = generatedOwners.get(routeKey(route.from_location_id, route.to_location_id));
    if (!owner) {
      errors.push(
        `Gate ${method.id} route ${routeKey(route.from_location_id, route.to_location_id)} has no generated route owner`,
      );
    } else if (owner !== edge.pack_id) {
      errors.push(
        `Gate ${method.id} route ${routeKey(route.from_location_id, route.to_location_id)} is owned by ${edge.pack_id}, not generated owner ${owner}`,
      );
    }
  }
}

function progressionSafetyContextErrors(config, context, label) {
  const errors = [];
  const manifests = context.manifests ?? [];
  const resources = context.resources ?? {};
  const locations = resources.locations ?? [];
  const exits = resources.exits ?? [];
  const items = resources.items ?? [];
  const hooks = resources.lifecycle_hooks ?? [];
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const routes = new Map(exits.map((exit) => [
    routeKey(exit.from_location_id, exit.to_location_id),
    exit,
  ]));
  routes.locationOwners = new Map(locations.map((location) => [location.id, location.pack_id]));
  const generatedOwners = generatedRouteOwners(manifests);
  const catalogs = descriptorCatalogs(manifests);
  const proofRecoveries = new Map(
    config.recoveries.map((recovery) => [
      recoveryKey(recovery.id, recovery.version),
      recovery,
    ]),
  );

  if (!locationById.has(config.entry_location_id)) {
    errors.push(`${label} entry location ${config.entry_location_id} is missing`);
  }
  for (const id of config.required_location_ids) {
    if (!locationById.has(id)) errors.push(`${label} required location ${id} is missing`);
  }
  for (const optional of config.optional_content) {
    if (
      optional.kind === "location"
      && positiveInteger(optional.id)
      && !locationById.has(optional.id)
    ) {
      errors.push(`${label} optional location ${optional.id} is missing`);
    }
    if (
      optional.kind === "item"
      && positiveInteger(optional.id)
      && !itemById.has(optional.id)
    ) {
      errors.push(`${label} optional item ${optional.id} is missing`);
    }
  }
  for (const recovery of config.recoveries) {
    if (!locationById.has(recovery.source_location_id)) {
      errors.push(`recovery ${recovery.id} source location ${recovery.source_location_id} is missing`);
    }
  }

  const initialRoutes = exits.filter((exit) => (Number(exit.flags ?? 0) & 1) === 0);
  const initialReachable = reachableLocations(config.entry_location_id, initialRoutes);
  for (const method of config.access_methods) {
    for (const route of method.unlock_routes ?? []) {
      if (!routeExists(routes, route)) {
        errors.push(
          `Gate ${method.id} references missing route ${routeKey(
            route.from_location_id,
            route.to_location_id,
          )}`,
        );
      }
    }
    validateGeneratedRouteOwnership(errors, method, routes, generatedOwners);
    if (method.kind !== "mission_key") continue;
    const item = itemById.get(method.item_id);
    if (!item) {
      errors.push(`Gate ${method.id} references missing mission key item ${method.item_id}`);
      continue;
    }
    if (
      item.location_id !== method.source_location_id
      || !locationById.has(method.source_location_id)
    ) {
      errors.push(
        `Gate ${method.id} mission key ${method.item_id} has no exact authored source at ${method.source_location_id}`,
      );
    }
    if (!initialReachable.has(method.source_location_id)) {
      errors.push(
        `Gate ${method.id} mission key ${method.item_id} is unreachable before its required route opens`,
      );
    }
    const recovery = proofRecoveries.get(
      recoveryKey(method.custody.recovery_ref, method.custody.recovery_version),
    );
    if (!recovery) {
      errors.push(
        `Gate ${method.id} mission key ${method.item_id} references missing recovery ${method.custody.recovery_ref}@${method.custody.recovery_version}`,
      );
    } else if (!initialReachable.has(recovery.source_location_id)) {
      errors.push(
        `recovery ${recovery.id} for Gate ${method.id} is unreachable before the Gate opens`,
      );
    }
    for (const event of custodyEvents) {
      if (method.custody[event] === "inert" && method.persistence !== "permanent") {
        errors.push(
          `Gate ${method.id} cannot make mission key ${method.item_id} inert after ${event} because the Gate is reclosable`,
        );
      }
    }
    const hooksForItem = hooks.filter((hook) =>
      hook.hook === "on_use"
      && hook.target_kind === "item"
      && String(hook.target_id) === String(method.item_id));
    for (const route of method.unlock_routes ?? []) {
      const matchingHook = hooksForItem.find((hook) =>
        (hook.effects ?? []).some((effect) =>
          effect.op === "unlock_exit"
          && effect.from_location_id === route.from_location_id
          && effect.to_location_id === route.to_location_id));
      if (!matchingHook) {
        errors.push(
          `Gate ${method.id} mission key ${method.item_id} has no authored unlock transition for ${routeKey(
            route.from_location_id,
            route.to_location_id,
          )}`,
        );
      } else if (
        method.persistence === "permanent"
        && matchingHook.claim_scope !== "world_target_once"
      ) {
        errors.push(
          `Gate ${method.id} permanent unlock must use a world_target_once authored transition`,
        );
      }
    }
  }

  const openedRoutes = new Set(initialRoutes.map((route) =>
    routeKey(route.from_location_id, route.to_location_id)));
  const acquired = new Set();
  let changed = true;
  let reachable = initialReachable;
  while (changed) {
    changed = false;
    reachable = reachableLocations(
      config.entry_location_id,
      exits.filter((exit) =>
        openedRoutes.has(routeKey(exit.from_location_id, exit.to_location_id))),
    );
    for (const method of config.access_methods) {
      const available = method.kind === "reusable_capability"
        || reachable.has(method.source_location_id);
      if (!available || acquired.has(method.id)) continue;
      acquired.add(method.id);
      changed = true;
      for (const route of method.unlock_routes) {
        openedRoutes.add(routeKey(route.from_location_id, route.to_location_id));
      }
    }
  }
  reachable = reachableLocations(
    config.entry_location_id,
    exits.filter((exit) =>
      openedRoutes.has(routeKey(exit.from_location_id, exit.to_location_id))),
  );
  const unreachableRequired = config.required_location_ids.filter((id) => !reachable.has(id));
  if (unreachableRequired.length) {
    errors.push(
      `${label} unreachable required component contains locations ${unreachableRequired.join(", ")}`,
    );
  }

  for (const gate of config.reclosable_gates) {
    if (!routeExists(routes, gate)) {
      errors.push(`reclosable Gate ${gate.id} references a missing route`);
      continue;
    }
    const escape = gate.far_side_escape;
    if (["return_route", "alternate_route"].includes(escape.kind)) {
      if (!routeExists(routes, escape.route)) {
        errors.push(`reclosable Gate ${gate.id} far-side escape route is missing`);
      } else {
        const withoutGate = exits.filter((exit) =>
          routeKey(exit.from_location_id, exit.to_location_id)
          !== routeKey(gate.from_location_id, gate.to_location_id));
        const farReachable = reachableLocations(gate.to_location_id, withoutGate);
        if (
          !farReachable.has(escape.route.from_location_id)
          || !farReachable.has(gate.from_location_id)
        ) {
          errors.push(
            `reclosable Gate ${gate.id} can strand actors on its far side without return or rescue`,
          );
        }
      }
    } else if (escape.kind === "rescue") {
      if (!locationById.has(escape.location_id)) {
        errors.push(`reclosable Gate ${gate.id} rescue location ${escape.location_id} is missing`);
      } else {
        const withoutGate = exits.filter((exit) =>
          routeKey(exit.from_location_id, exit.to_location_id)
          !== routeKey(gate.from_location_id, gate.to_location_id));
        if (!reachableLocations(gate.to_location_id, withoutGate).has(escape.location_id)) {
          errors.push(
            `reclosable Gate ${gate.id} rescue location ${escape.location_id} is unreachable from the far side`,
          );
        }
      }
    } else if (escape.kind === "intentional_one_way" && !reachable.has(gate.to_location_id)) {
      errors.push(
        `reclosable Gate ${gate.id} intentional one-way far side ${gate.to_location_id} is unreachable`,
      );
    }
  }

  for (const discovery of config.required_discoveries) {
    const slot = catalogs.slots.get(discovery.slot_id);
    if (!slot || slot.version !== discovery.slot_version) {
      errors.push(
        `required Discovery Slot ${discovery.slot_id}@${discovery.slot_version} is missing`,
      );
      continue;
    }
    if (
      slot.progression?.kind !== "required"
      || !Number.isInteger(slot.progression.sign_budget)
      || slot.progression.sign_budget < 1
      || !nonEmpty(slot.progression.fallback_row_id)
    ) {
      errors.push(
        `required Discovery Slot ${discovery.slot_id} can exhaust its Sign budget without deterministic fallback`,
      );
    }
  }

  for (const lead of config.required_leads) {
    const leadDescriptor = catalogs.leads.get(recoveryKey(lead.lead_id, lead.lead_version));
    if (!leadDescriptor) {
      errors.push(`required Lead ${lead.lead_id}@${lead.lead_version} is missing`);
    }
    if (!catalogs.anchors.has(recoveryKey(lead.anchor_id, lead.anchor_version))) {
      errors.push(
        `required Lead ${lead.lead_id} references missing Anchor ${lead.anchor_id}@${lead.anchor_version}`,
      );
    }
    if (!catalogs.recoveries.has(recoveryKey(lead.recovery_ref, lead.recovery_version))) {
      errors.push(
        `required Lead ${lead.lead_id} references missing recovery ${lead.recovery_ref}@${lead.recovery_version}`,
      );
    }
  }

  for (const frontier of config.frontier_transitions) {
    if (!routeExists(routes, frontier)) {
      errors.push(`frontier ${frontier.id} references a missing route`);
    }
    const anchor = catalogs.anchors.get(
      recoveryKey(frontier.anchor_id, frontier.anchor_version),
    );
    if (!anchor) {
      errors.push(
        `frontier ${frontier.id} references missing last secure Anchor ${frontier.anchor_id}@${frontier.anchor_version}`,
      );
    } else if (!Array.isArray(anchor.return_chain) || anchor.return_chain.length === 0) {
      errors.push(
        `frontier ${frontier.id} last secure Anchor ${frontier.anchor_id} has no authored return chain`,
      );
    }
    let viable = false;
    const withoutForward = exits.filter((exit) =>
      routeKey(exit.from_location_id, exit.to_location_id)
      !== routeKey(frontier.from_location_id, frontier.to_location_id));
    const farReachable = reachableLocations(frontier.to_location_id, withoutForward);
    for (const escape of frontier.fatigue_escape) {
      if (escape.kind === "retreat") {
        viable ||= routeExists(routes, escape.route)
          && escape.route.from_location_id === frontier.to_location_id
          && farReachable.has(escape.route.to_location_id);
      } else {
        viable ||= locationById.has(escape.location_id)
          && farReachable.has(escape.location_id);
      }
    }
    if (!viable) {
      errors.push(
        `frontier ${frontier.id} leaves Anchor ${frontier.anchor_id} with no retreat, camp, aid, or rescue`,
      );
    }
  }
  return errors;
}

export function progressionSafetyWorldValidationErrors(
  manifests,
  resources,
  label = "compiled worldpack",
) {
  const errors = [];
  for (const manifest of manifests) {
    const config = manifest?.extensions?.[EXTENSION];
    if (config === undefined) continue;
    const proofLabel = `${label}: ${manifest.id}: ${EXTENSION}`;
    const structural = progressionSafetyValidationErrors(config, proofLabel);
    errors.push(...structural);
    if (structural.length === 0) {
      errors.push(...progressionSafetyContextErrors(
        config,
        { manifests, resources },
        proofLabel,
      ));
    }
  }
  return errors;
}

export function progressionSafetyExtensionValidationErrors(
  manifest,
  label = "pack.json",
) {
  const config = manifest?.extensions?.[EXTENSION];
  if (config === undefined) return [];
  return progressionSafetyValidationErrors(
    config,
    `${label}: ${EXTENSION}`,
  );
}

export function assertProgressionSafetyWorld(manifests, resources, label) {
  const errors = progressionSafetyWorldValidationErrors(manifests, resources, label);
  if (errors.length) throw new Error(errors.join("; "));
  return resources;
}
