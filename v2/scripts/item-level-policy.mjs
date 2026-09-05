export function itemLevelPolicyErrors(item, roomFeatures) {
  const policy = item.level_policy;
  if (policy == null) return [];
  const errors = [];
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
  if (!exact(policy, ["schema_version", "criteria"]) || policy.schema_version !== 1
      || !Array.isArray(policy.criteria) || policy.criteria.length < 1 || policy.criteria.length > 19) {
    return [`item ${item.id} needs level policy v1 with 1 to 19 use criteria`];
  }
  const ids = new Set();
  const targets = new Set();
  for (const criterion of policy.criteria) {
    if (!exact(criterion, ["id", "location_id", "feature_key"])
        || !/^[a-z][a-z0-9-]{0,63}$/.test(criterion?.id || "")
        || !Number.isSafeInteger(criterion?.location_id) || criterion.location_id <= 0
        || typeof criterion?.feature_key !== "string" || !criterion.feature_key.trim()) {
      errors.push(`item ${item.id} has an invalid level-use criterion`);
      continue;
    }
    const target = `${criterion.location_id}:${criterion.feature_key}`;
    if (ids.has(criterion.id) || targets.has(target)) errors.push(`item ${item.id} repeats a level-use criterion`);
    ids.add(criterion.id);
    targets.add(target);
    if (!roomFeatures.some((feature) => feature.location_id === criterion.location_id
      && feature.key === criterion.feature_key && feature.uses?.some((use) => use.item_id === item.id))) {
      errors.push(`item ${item.id} level criterion ${criterion.id} needs its authored feature use`);
    }
  }
  return errors;
}
