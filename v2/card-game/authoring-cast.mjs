// Source offsets use JavaScript string indices, so a sample can be traced
// directly to the author's unchanged document. Each draw keeps its own seed.
export const CAST_SIZE = 6;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const high = (n) => n >= 0xd800 && n <= 0xdbff;
const low = (n) => n >= 0xdc00 && n <= 0xdfff;
const boundary = (text, index) =>
  index > 0 && low(text.charCodeAt(index)) && high(text.charCodeAt(index - 1))
    ? index - 1
    : index;
function randomDraw(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSource(source, { seed, chunkSize = 6000 } = {}) {
  need(
    typeof source === "string" &&
      source.trim().length > 0 &&
      source.isWellFormed(),
    "Add source text for the characters.",
  );
  need(
    new TextEncoder().encode(source).length <= MAX_SOURCE_BYTES,
    "Keep the source within 8 MiB.",
  );
  need(
    Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff,
    "Use a whole draw seed from 0 through 4294967295.",
  );
  need(
    Number.isInteger(chunkSize) && chunkSize >= 256 && chunkSize <= 12000,
    "Choose a source chunk between 256 and 12000 characters.",
  );
  const sections = Math.min(CAST_SIZE, Math.ceil(source.length / chunkSize));
  const random = randomDraw(seed);
  return Array.from({ length: sections }, (_, section) => {
    const first = boundary(
      source,
      Math.floor((source.length * section) / sections),
    );
    const last = boundary(
      source,
      Math.floor((source.length * (section + 1)) / sections),
    );
    const spare = Math.max(0, last - first - chunkSize);
    let start = boundary(source, first + Math.floor(random() * (spare + 1)));
    let end = boundary(source, Math.min(last, start + chunkSize));
    // Prefer full paragraphs at the edges while keeping most of the sample.
    const edge = Math.floor((end - start) / 6);
    if (start > first) {
      const paragraph = source.indexOf("\n\n", start);
      if (paragraph >= start && paragraph + 2 <= start + edge)
        start = paragraph + 2;
    }
    if (end < last) {
      const paragraph = source.lastIndexOf("\n\n", end);
      if (paragraph >= end - edge) end = paragraph;
    }
    return { section, start, end, text: source.slice(start, end) };
  });
}

export function nameKey(name) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
const shortText = (text, max) =>
  typeof text === "string" &&
  text.trim().length > 0 &&
  text.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(text);

// Parse model output before placing it in the hand. Evidence ties a proposal
// to the sampled book, while the portrait description remains internal.
export function readCharacter(value, sample) {
  const keys = ["name", "specialAbility", "description", "aliases", "evidence"];
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "Choose a character with a name, ability, description, aliases and evidence.",
  );
  need(
    shortText(value.name, 80) &&
      nameKey(value.name) &&
      shortText(value.specialAbility, 100) &&
      shortText(value.description, 1200),
    "Use a short character name, ability and description.",
  );
  need(
    Array.isArray(value.aliases) &&
      value.aliases.length <= 8 &&
      value.aliases.every((name) => shortText(name, 80) && nameKey(name)),
    "Use up to eight character aliases.",
  );
  need(
    typeof value.evidence === "string" &&
      value.evidence.trim().length > 0 &&
      value.evidence.length <= 500 &&
      typeof sample?.text === "string" &&
      sample.text.includes(value.evidence),
    "Choose a character supported by the source sample.",
  );
  const evidence = nameKey(value.evidence);
  need(
    characterKeys(value).some((key) => evidence.includes(key)),
    "Quote a passage that names the character or an alias.",
  );
  return {
    name: value.name.trim(),
    specialAbility: value.specialAbility.trim(),
    description: value.description.trim(),
    aliases: [...new Set(value.aliases.map((name) => name.trim()))],
    evidence: value.evidence,
    source: { section: sample.section, start: sample.start, end: sample.end },
  };
}

export const characterLabel = (character) =>
  `${character.name} // ${character.specialAbility}`;
export const characterKeys = (character) =>
  [character.name, ...(character.aliases || [])].map(nameKey).filter(Boolean);

// Kept records retain their IDs, selected design and poses. New proposals only
// fill the remaining slots; name and alias matches count as one person.
export function addDistinctCharacters(kept, proposals) {
  need(
    Array.isArray(kept) && kept.length <= CAST_SIZE,
    "Keep up to six characters.",
  );
  need(Array.isArray(proposals), "Supply the next character proposals.");
  // Joining every alias first handles a later proposal that connects two
  // earlier names. Its aliases also survive into the next draw.
  const all = [...kept, ...proposals];
  const parent = new Map();
  const root = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    while (parent.get(key) !== key) key = parent.get(key);
    return key;
  };
  for (const character of all) {
    const keys = characterKeys(character);
    need(keys.length > 0, "Use a character name with letters or numbers.");
    for (const key of keys) parent.set(root(key), root(keys[0]));
  }
  const groups = new Map();
  for (const character of all) {
    const key = root(characterKeys(character)[0]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(character);
  }
  const characters = [],
    rejected = [];
  for (const group of groups.values()) {
    need(
      group.filter((c) => kept.includes(c)).length <= 1,
      "Review kept characters with shared names or aliases.",
    );
    const chosen = group[0];
    if (characters.length === CAST_SIZE) {
      rejected.push(...group);
      continue;
    }
    const aliases = [
      ...new Set(group.flatMap((c) => [c.name, ...(c.aliases || [])])),
    ].filter((name) => nameKey(name) !== nameKey(chosen.name));
    characters.push({ ...chosen, aliases });
    rejected.push(...group.slice(1));
  }
  return { characters, rejected };
}
