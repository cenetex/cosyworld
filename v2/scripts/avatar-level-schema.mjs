const identityModes = new Set(["authored", "self_authored", "hybrid"]);
const speechModes = new Set(["raw", "prose", "emoji_only", "emote_only", "silent", "unavailable"]);
const actorRoles = new Set(["actor", "target", "either"]);
const abilities = new Set(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]);
const trackFields = new Set([
  "pack_id", "id", "actor_ids", "actor_pack_id", "speech_modes", "identity", "max_level", "levels",
]);
const levelFields = new Set([
  "level", "label", "requirements", "chance", "effects", "appearance_changes",
]);
const requirementFields = new Set(["event_type", "count", "actor_role", "distinct_locations"]);
const chanceFields = new Set(["ability", "dc", "retry"]);
const effectFields = new Set(["kind", "amount"]);
const identityFields = new Set([
  "mode", "canonical_description", "appearance", "persona", "mutable_traits",
]);
const disallowedEventPrefixes = [
  "message.", "chat.", "model.", "ai.", "orb.", "currency.",
  "avatar.self_description", "avatar.reflection", "thought.", "dream.",
];

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, maxLength = Infinity) {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= maxLength;
}

function unknownFields(value, allowed, owner, errors) {
  if (!object(value)) {
    errors.push(`${owner} must be an object`);
    return;
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${owner} has unknown field ${field}`);
  }
}

function validateIdentity(value, owner, errors) {
  if (value === undefined) return;
  unknownFields(value, identityFields, `${owner} identity`, errors);
  if (!object(value)) return;
  const mode = value.mode ?? "authored";
  if (!identityModes.has(mode)) errors.push(`${owner} identity has invalid mode ${String(mode)}`);
  for (const field of ["canonical_description", "appearance", "persona"]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || [...value[field]].length > 1_000)) {
      errors.push(`${owner} identity ${field} must be a string of at most 1000 characters`);
    }
  }
  const mutableTraits = value.mutable_traits ?? [];
  if (!Array.isArray(mutableTraits) || mutableTraits.length > 12
    || mutableTraits.some((trait) => !nonEmptyString(trait, 80))) {
    errors.push(`${owner} identity mutable_traits must contain at most 12 short names`);
  }
}

function trackMatchesActor(track, actor) {
  return (track.actor_ids?.length ? track.actor_ids.includes(actor.id) : true)
    && (track.actor_pack_id === undefined || track.actor_pack_id === actor.pack_id)
    && (track.speech_modes?.length ? track.speech_modes.includes(actor.speech_mode) : true);
}

export function avatarLevelSchemaValidationErrors({
  actors = [],
  tracks = [],
  actorModelBindings = [],
} = {}) {
  const errors = [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const boundActorIds = new Set(actorModelBindings.map((binding) => binding.actor_id));
  const trackIds = new Set();

  for (const actor of actors) validateIdentity(actor.identity, `actor ${String(actor.id)}`, errors);
  for (const track of tracks) {
    const owner = `avatar level track ${String(track?.id ?? "unknown")}`;
    unknownFields(track, trackFields, owner, errors);
    if (!object(track)) continue;
    if (!nonEmptyString(track.id, 128) || trackIds.has(track.id)) errors.push(`${owner} has an invalid or duplicate id`);
    trackIds.add(track.id);
    const actorIds = track.actor_ids ?? [];
    const speech = track.speech_modes ?? [];
    if (!Array.isArray(actorIds) || actorIds.some((id) => !actorById.has(id))) errors.push(`${owner} actor_ids contain an unknown actor`);
    if (!Array.isArray(speech) || speech.some((mode) => !speechModes.has(mode))) errors.push(`${owner} has invalid speech_modes`);
    if (actorIds.length === 0 && !nonEmptyString(track.actor_pack_id)) errors.push(`${owner} must select actors by id or pack`);
    validateIdentity(track.identity ?? {}, owner, errors);

    const selectedActors = actors.filter((actor) => trackMatchesActor(track, actor));
    if (selectedActors.length === 0) errors.push(`${owner} selects no actors`);
    if ((track.identity?.mode ?? "authored") !== "authored"
      && selectedActors.some((actor) => actor.speech_mode !== "raw" || !boundActorIds.has(actor.id))) {
      errors.push(`${owner} self-authorship requires an exact text model binding for every selected actor`);
    }
    if (!Number.isInteger(track.max_level) || track.max_level < 1 || track.max_level > 20
      || !Array.isArray(track.levels) || track.levels.length !== track.max_level) {
      errors.push(`${owner} levels must exactly cover 1 through max_level (1-20)`);
      continue;
    }
    track.levels.forEach((level, index) => {
      const levelOwner = `${owner} level ${String(level?.level ?? index + 1)}`;
      unknownFields(level, levelFields, levelOwner, errors);
      if (!object(level)) return;
      if (level.level !== index + 1 || !nonEmptyString(level.label, 80)) errors.push(`${levelOwner} has invalid number or label`);
      const requirements = level.requirements ?? [];
      if (!Array.isArray(requirements)) errors.push(`${levelOwner} requirements must be an array`);
      else requirements.forEach((requirement) => {
        unknownFields(requirement, requirementFields, `${levelOwner} requirement`, errors);
        if (!object(requirement)) return;
        const count = requirement.count ?? 1;
        const role = requirement.actor_role ?? "actor";
        const distinctLocations = requirement.distinct_locations ?? 0;
        const eventType = String(requirement.event_type ?? "").trim().toLowerCase();
        if (!eventType || disallowedEventPrefixes.some((prefix) => eventType.startsWith(prefix))
          || !Number.isInteger(count) || count < 1 || count > 65_535
          || !actorRoles.has(role) || !Number.isInteger(distinctLocations)
          || distinctLocations < 0 || distinctLocations > Math.min(count, 255)) {
          errors.push(`${levelOwner} has an invalid requirement`);
        }
      });
      if (level.level === 1 && (requirements.length > 0 || level.chance !== undefined)) {
        errors.push(`${levelOwner} cannot have requirements or a chance gate`);
      }
      if (level.chance !== undefined) {
        unknownFields(level.chance, chanceFields, `${levelOwner} chance`, errors);
        if (!object(level.chance) || !abilities.has(level.chance.ability)
          || !Number.isInteger(level.chance.dc) || level.chance.dc < 1 || level.chance.dc > 30
          || (level.chance.retry ?? "new_evidence") !== "new_evidence") {
          errors.push(`${levelOwner} has an invalid chance gate`);
        }
      }
      const effects = level.effects ?? [];
      if (!Array.isArray(effects)) errors.push(`${levelOwner} effects must be an array`);
      else effects.forEach((effect) => {
        unknownFields(effect, effectFields, `${levelOwner} effect`, errors);
        if (!object(effect) || effect.kind !== "hp_base_delta" || !Number.isInteger(effect.amount)
          || effect.amount < 1 || effect.amount > 100) errors.push(`${levelOwner} has an invalid effect`);
      });
      const appearanceChanges = level.appearance_changes ?? [];
      if (!Array.isArray(appearanceChanges) || appearanceChanges.some((value) => !nonEmptyString(value, 500))) {
        errors.push(`${levelOwner} appearance_changes must be short non-empty strings`);
      }
    });
  }

  for (const actor of actors) {
    if (actor.level_track_id !== undefined && !trackIds.has(actor.level_track_id)) {
      errors.push(`actor ${actor.id} references unknown avatar level track ${actor.level_track_id}`);
    }
    if (actor.identity && (actor.identity.mode ?? "authored") !== "authored"
      && (actor.speech_mode !== "raw" || !boundActorIds.has(actor.id))) {
      errors.push(`actor ${actor.id} self-authorship requires an exact text model binding`);
    }
    if (actor.level_track_id === undefined
      && tracks.filter((track) => object(track) && trackMatchesActor(track, actor)).length > 1) {
      errors.push(`actor ${actor.id} matches multiple avatar level tracks`);
    }
  }
  return errors;
}
