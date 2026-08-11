const SCENE_FIELDS = new Set([
  "schema_version",
  "id",
  "location_id",
  "projection",
  "camera",
  "palette",
  "viewer_site_id",
  "sites",
  "links",
  "anchors",
  "constraints",
  "pack_id",
]);
const SITE_FIELDS = new Set(["id", "label", "kind", "tiles"]);
const LINK_FIELDS = new Set(["from_site_id", "to_site_id"]);
const ANCHOR_FIELDS = new Set([
  "kind",
  "site_id",
  "actor_id",
  "feature_key",
  "destination_location_id",
]);
const CONSTRAINT_FIELDS = new Set([
  "id",
  "kind",
  "actor_id",
  "destination_location_id",
  "label",
]);
const ID = /^[a-z0-9][a-z0-9:-]*$/;
const SITE_KINDS = new Set(["entry", "feature", "crossing", "exit", "ground"]);
const ANCHOR_KINDS = new Set(["actor", "feature", "exit"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function unknownFields(value, allowed, label, errors) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
}

export function spatialSceneValidationErrors({
  scenes,
  locations,
  actors,
  roomFeatures,
  exits,
}) {
  const errors = [];
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const actorIds = new Set(actors.map((row) => row.id));
  const featureKeys = new Set(roomFeatures.map((row) => `${row.location_id}:${row.key}`));
  const exitKeys = new Set(exits.map((row) => `${row.from_location_id}:${row.to_location_id}`));
  const sceneIds = new Set();
  const sceneLocations = new Set();

  for (const scene of scenes) {
    const label = `spatial scene ${String(scene?.id ?? "unknown")}`;
    if (!isObject(scene)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    unknownFields(scene, SCENE_FIELDS, label, errors);
    if (scene.schema_version !== 1) errors.push(`${label} must use schema_version 1`);
    if (!nonEmpty(scene.id) || !ID.test(scene.id)) errors.push(`${label} has invalid id`);
    if (sceneIds.has(scene.id)) errors.push(`${label} repeats an id`);
    sceneIds.add(scene.id);
    if (!Number.isSafeInteger(scene.location_id) || scene.location_id <= 0) {
      errors.push(`${label} has invalid location_id`);
    } else if (sceneLocations.has(scene.location_id)) {
      errors.push(`${label} repeats location ${scene.location_id}`);
    }
    sceneLocations.add(scene.location_id);
    const location = locationById.get(scene.location_id);
    if (!location) errors.push(`${label} references missing location ${scene.location_id}`);
    if (location && location.interior_view !== "isometric") {
      errors.push(`${label} location ${scene.location_id} must declare interior_view isometric`);
    }
    if (scene.projection !== "isometric") errors.push(`${label} has unsupported projection`);
    if (!nonEmpty(scene.camera)) errors.push(`${label} is missing camera`);
    if (!nonEmpty(scene.palette)) errors.push(`${label} is missing palette`);

    const sites = Array.isArray(scene.sites) ? scene.sites : [];
    if (sites.length < 2 || sites.length > 24) errors.push(`${label} must declare 2-24 sites`);
    const siteIds = new Set();
    const tileKeys = new Set();
    for (const site of sites) {
      const siteLabel = `${label} site ${String(site?.id ?? "unknown")}`;
      if (!isObject(site)) {
        errors.push(`${siteLabel} must be an object`);
        continue;
      }
      unknownFields(site, SITE_FIELDS, siteLabel, errors);
      if (!nonEmpty(site.id) || !ID.test(site.id)) errors.push(`${siteLabel} has invalid id`);
      if (siteIds.has(site.id)) errors.push(`${siteLabel} repeats an id`);
      siteIds.add(site.id);
      if (!nonEmpty(site.label)) errors.push(`${siteLabel} is missing label`);
      if (!SITE_KINDS.has(site.kind)) errors.push(`${siteLabel} has unsupported kind ${site.kind}`);
      if (!Array.isArray(site.tiles) || site.tiles.length < 1 || site.tiles.length > 24) {
        errors.push(`${siteLabel} must declare 1-24 tiles`);
        continue;
      }
      for (const tile of site.tiles) {
        const valid = Array.isArray(tile)
          && tile.length === 3
          && tile.every(Number.isSafeInteger)
          && Math.abs(tile[0]) <= 16
          && Math.abs(tile[1]) <= 16
          && tile[2] >= 0
          && tile[2] <= 8;
        if (!valid) {
          errors.push(`${siteLabel} has invalid tile ${JSON.stringify(tile)}`);
          continue;
        }
        const tileKey = tile.join(":");
        if (tileKeys.has(tileKey)) errors.push(`${label} repeats tile ${tileKey}`);
        tileKeys.add(tileKey);
      }
    }
    if (!siteIds.has(scene.viewer_site_id)) errors.push(`${label} has invalid viewer_site_id`);

    const links = Array.isArray(scene.links) ? scene.links : [];
    if (links.length < 1 || links.length > 48) errors.push(`${label} must declare 1-48 links`);
    const adjacency = new Map([...siteIds].map((id) => [id, new Set()]));
    const linkKeys = new Set();
    for (const link of links) {
      const linkLabel = `${label} link`;
      if (!isObject(link)) {
        errors.push(`${linkLabel} must be an object`);
        continue;
      }
      unknownFields(link, LINK_FIELDS, linkLabel, errors);
      if (!siteIds.has(link.from_site_id) || !siteIds.has(link.to_site_id)) {
        errors.push(`${linkLabel} references an unknown site`);
        continue;
      }
      if (link.from_site_id === link.to_site_id) errors.push(`${linkLabel} cannot connect a site to itself`);
      const linkKey = [link.from_site_id, link.to_site_id].sort().join(":");
      if (linkKeys.has(linkKey)) errors.push(`${linkLabel} repeats ${linkKey}`);
      linkKeys.add(linkKey);
      adjacency.get(link.from_site_id).add(link.to_site_id);
      adjacency.get(link.to_site_id).add(link.from_site_id);
    }
    if (siteIds.size) {
      const visited = new Set();
      const pending = [[...siteIds][0]];
      while (pending.length) {
        const siteId = pending.pop();
        if (visited.has(siteId)) continue;
        visited.add(siteId);
        pending.push(...(adjacency.get(siteId) ?? []));
      }
      if (visited.size !== siteIds.size) errors.push(`${label} site graph must be connected`);
    }

    const anchors = Array.isArray(scene.anchors) ? scene.anchors : [];
    if (anchors.length > 64) errors.push(`${label} may declare at most 64 anchors`);
    const anchorKeys = new Set();
    for (const anchor of anchors) {
      const anchorLabel = `${label} anchor`;
      if (!isObject(anchor)) {
        errors.push(`${anchorLabel} must be an object`);
        continue;
      }
      unknownFields(anchor, ANCHOR_FIELDS, anchorLabel, errors);
      if (!ANCHOR_KINDS.has(anchor.kind)) errors.push(`${anchorLabel} has unsupported kind ${anchor.kind}`);
      if (!siteIds.has(anchor.site_id)) errors.push(`${anchorLabel} references unknown site ${anchor.site_id}`);
      let identity = "";
      if (anchor.kind === "actor") {
        identity = String(anchor.actor_id);
        if (!actorIds.has(anchor.actor_id)) errors.push(`${anchorLabel} references missing actor ${anchor.actor_id}`);
      } else if (anchor.kind === "feature") {
        identity = String(anchor.feature_key);
        if (!featureKeys.has(`${scene.location_id}:${anchor.feature_key}`)) {
          errors.push(`${anchorLabel} references missing feature ${anchor.feature_key}`);
        }
      } else if (anchor.kind === "exit") {
        identity = String(anchor.destination_location_id);
        if (!exitKeys.has(`${scene.location_id}:${anchor.destination_location_id}`)) {
          errors.push(`${anchorLabel} references missing exit ${anchor.destination_location_id}`);
        }
      }
      const anchorKey = `${anchor.kind}:${identity}`;
      if (anchorKeys.has(anchorKey)) errors.push(`${anchorLabel} repeats ${anchorKey}`);
      anchorKeys.add(anchorKey);
    }

    const constraints = Array.isArray(scene.constraints) ? scene.constraints : [];
    if (constraints.length > 32) errors.push(`${label} may declare at most 32 constraints`);
    const constraintIds = new Set();
    for (const constraint of constraints) {
      const constraintLabel = `${label} constraint ${String(constraint?.id ?? "unknown")}`;
      if (!isObject(constraint)) {
        errors.push(`${constraintLabel} must be an object`);
        continue;
      }
      unknownFields(constraint, CONSTRAINT_FIELDS, constraintLabel, errors);
      if (!nonEmpty(constraint.id) || !ID.test(constraint.id)) errors.push(`${constraintLabel} has invalid id`);
      if (constraintIds.has(constraint.id)) errors.push(`${constraintLabel} repeats an id`);
      constraintIds.add(constraint.id);
      if (constraint.kind !== "active_actor_blocks_exit") errors.push(`${constraintLabel} has unsupported kind`);
      if (!nonEmpty(constraint.label)) errors.push(`${constraintLabel} is missing label`);
      if (!anchorKeys.has(`actor:${constraint.actor_id}`)) errors.push(`${constraintLabel} actor is not anchored`);
      if (!anchorKeys.has(`exit:${constraint.destination_location_id}`)) errors.push(`${constraintLabel} exit is not anchored`);
    }
  }
  return errors;
}
