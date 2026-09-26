// A world's `linked_avatars`: the NFTs that may join it as avatars, by whole
// collection, by specific asset, or both, each with an arrival location.
// The runtime (proxim8/linked_avatars.rs) applies the same rules when it
// loads the worldpack.

const sourceIdPattern = /^[a-z0-9-]{1,32}$/;
const locationReferencePattern = /^[a-z0-9._-]+:location\/(\d+)$/;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True when `text` is base58 for exactly 32 bytes: a Solana address. */
export function isSolanaAddress(text) {
  if (typeof text !== "string" || text.length < 32 || text.length > 44) return false;
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    value = value * 58n + BigInt(digit);
  }
  const ones = text.match(/^1*/)[0].length;
  const hex = value === 0n ? "" : value.toString(16);
  return ones + Math.ceil(hex.length / 2) === 32;
}

/** The runtime location id an arrival reference names, or null. */
export function arrivalLocationId(reference) {
  const match = typeof reference === "string" ? locationReferencePattern.exec(reference) : null;
  return match ? Number(match[1]) : null;
}

export function linkedAvatarsValidationErrors(config, label = "linked_avatars", locationIds = null) {
  if (!isObject(config)) return [`${label} must be an object`];
  const errors = [];
  for (const field of Object.keys(config)) {
    if (!["schema_version", "sources"].includes(field)) errors.push(`${label} contains unknown field ${field}`);
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    errors.push(`${label} must list at least one source`);
    return errors;
  }
  const ids = new Set();
  config.sources.forEach((source, index) => {
    const at = `${label} sources[${index}]`;
    if (!isObject(source)) {
      errors.push(`${at} must be an object`);
      return;
    }
    for (const field of Object.keys(source)) {
      if (!["id", "name", "collections", "assets", "characters", "arrival_location", "goal"].includes(field)) {
        errors.push(`${at} contains unknown field ${field}`);
      }
    }
    if (!sourceIdPattern.test(source.id ?? "") || ids.has(source.id)) {
      errors.push(`${at} id must be a unique lowercase slug`);
    }
    ids.add(source.id);
    if (typeof source.name !== "string" || !source.name.trim() || [...source.name].length > 40) {
      errors.push(`${at} name must be 1-40 characters`);
    }
    const collections = source.collections ?? [];
    const assets = source.assets ?? [];
    const characters = source.characters ?? [];
    if (!Array.isArray(collections) || !Array.isArray(assets) || !Array.isArray(characters)) {
      errors.push(`${at} collections, assets and characters must be arrays`);
      return;
    }
    if (collections.length + assets.length + characters.length === 0) errors.push(`${at} admits nothing`);
    const characterIds = new Set();
    const characterAssets = [];
    characters.forEach((character, characterIndex) => {
      const cat = `${at} characters[${characterIndex}]`;
      if (!isObject(character)) {
        errors.push(`${cat} must be an object`);
        return;
      }
      for (const field of Object.keys(character)) {
        if (!["id", "name", "assets", "permanent", "home_location", "description", "personality"].includes(field)) {
          errors.push(`${cat} contains unknown field ${field}`);
        }
      }
      if (!sourceIdPattern.test(character.id ?? "") || characterIds.has(character.id)) {
        errors.push(`${cat} id must be a unique lowercase slug`);
      }
      characterIds.add(character.id);
      if (typeof character.name !== "string" || !character.name.trim() || [...character.name].length > 40) {
        errors.push(`${cat} name must be 1-40 characters`);
      }
      if (character.permanent !== undefined && typeof character.permanent !== "boolean") {
        errors.push(`${cat} permanent must be true or false`);
      }
      if (character.home_location !== undefined) {
        const homeId = arrivalLocationId(character.home_location);
        if (homeId === null) errors.push(`${cat} home_location must look like pack:location/<id>`);
        else if (locationIds && !locationIds.has(homeId)) {
          errors.push(`${cat} lives at unknown location ${character.home_location}`);
        }
      }
      for (const field of ["description", "personality"]) {
        const text = character[field];
        if (text === undefined) continue;
        if (typeof text !== "string" || !text.trim() || [...text].length > 400 || /[\u0000-\u001f\u007f]/.test(text)) {
          errors.push(`${cat} ${field} must be 1-400 characters of plain text`);
        }
      }
      if (!Array.isArray(character.assets) || character.assets.length === 0) {
        errors.push(`${cat} must list at least one asset`);
      } else {
        characterAssets.push(...character.assets);
      }
    });
    const listed = [...assets, ...characterAssets];
    const repeated = listed.filter((address, index) => listed.indexOf(address) !== index);
    if (repeated.length) errors.push(`${at} lists ${repeated[0]} more than once`);
    for (const address of [...collections, ...listed]) {
      if (!isSolanaAddress(address)) errors.push(`${at} has an invalid Solana address ${address}`);
    }
    const locationId = arrivalLocationId(source.arrival_location);
    if (locationId === null) {
      errors.push(`${at} arrival_location must look like pack:location/<id>`);
    } else if (locationIds && !locationIds.has(locationId)) {
      errors.push(`${at} arrives at unknown location ${source.arrival_location}`);
    }
    if (source.goal !== undefined && (typeof source.goal !== "string" || !source.goal.trim())) {
      errors.push(`${at} goal must be non-empty text`);
    }
  });
  return errors;
}

export function assertLinkedAvatarsConfig(config, label = "linked_avatars", locationIds = null) {
  const errors = linkedAvatarsValidationErrors(config, label, locationIds);
  if (errors.length) throw new Error(errors.join("\n"));
}
