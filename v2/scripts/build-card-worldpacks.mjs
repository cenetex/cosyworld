import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "content/greek-drama/card-world.json");
const bridgePath = path.join(root, "worlds/greek-drama/card-bridge.json");
const outputPath = path.join(root, "card-game/packs/greek-drama.mjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const source = read(sourcePath);
const bridge = read(bridgePath);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const id = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const owns = (map, key) => typeof key === "string" && Object.hasOwn(map, key);
const nonempty = (value, max = 1200) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const fail = (ok, message) => assert.ok(ok, `Greek card pack: ${message}`);

fail(source.schemaVersion === 1 && source.id === "greek-drama" &&
  source.packId === "cosyworld.greek-drama" && Number.isSafeInteger(source.revision) && source.revision > 0,
"unsupported source identity or version");
fail([source.places, source.avatars, source.items].every(object), "entity maps are required");
fail([source.routes, source.choices, source.works].every(Array.isArray), "routes, choices, and repertoire must be arrays");
const entityIds = [...Object.keys(source.places), ...Object.keys(source.avatars), ...Object.keys(source.items)];
const entities = new Set(entityIds);
fail(entities.size === entityIds.length && entityIds.every(key => id(key) && key.startsWith("greek-")),
  "entity identities must be distinct, stable greek- IDs");
fail(owns(source.places, source.entry), "entry must name a pack place");
const groups = new Map((source.continuity?.groups || []).map(group => [group.key, group.options]));
const selectedValues = new Map();
const writtenFlags = new Set();
for (const choice of source.choices) {
  for (const effect of choice.effects || []) {
    if (effect.kind === "choose") {
      if (!selectedValues.has(effect.key)) selectedValues.set(effect.key, new Set());
      selectedValues.get(effect.key).add(effect.value);
    }
    if (effect.kind === "set_flag") writtenFlags.add(effect.key);
  }
}
const conditions = (requirements = []) => {
  fail(Array.isArray(requirements) && requirements.length <= 12, "invalid condition list");
  for (const condition of requirements) {
    fail(object(condition), "condition must be a record");
    const valid = {
      choice: () => selectedValues.get(condition.key)?.has(condition.value),
      choice_unset: () => selectedValues.has(condition.key),
      flag: () => writtenFlags.has(condition.key) && typeof condition.value === "boolean",
      holding: () => owns(source.items, condition.item) && condition.actor === "vale",
      item_at: () => owns(source.items, condition.item) && owns(source.places, condition.place),
      met: () => owns(source.avatars, condition.actor),
    }[condition.kind];
    fail(valid?.(), `unknown or dangling condition ${JSON.stringify(condition)}`);
  }
};
const media = (asset) => {
  if (asset === undefined) return;
  fail(typeof asset === "string" && /^\.\/assets\/greek\/[a-z0-9-]+\.svg$/.test(asset),
    `unsupported media path ${asset}`);
  fail(fs.existsSync(path.join(root, "card-game", asset)), `missing media ${asset}`);
};
for (const [key, place] of Object.entries(source.places)) {
  fail(nonempty(place.name, 120) && nonempty(place.text), `${key} needs a name and short description`);
  fail(Array.isArray(place.exits) && new Set(place.exits).size === place.exits.length &&
    place.exits.every(to => owns(source.places, to) && to !== key), `${key} has a dangling or duplicate exit`);
  for (const to of place.exits)
    fail(source.places[to].exits.includes(key), `${key} → ${to} needs a return or an explicit route descriptor`);
  conditions(place.requires);
  media(place.backdrop);
}
for (const [key, avatar] of Object.entries(source.avatars)) {
  fail(nonempty(avatar.name, 120) && nonempty(avatar.text) && nonempty(avatar.persona) && nonempty(avatar.voice),
    `${key} needs authored identity and voice`);
  fail(owns(source.places, avatar.place) && owns(source.places, avatar.home), `${key} has an unknown home`);
  fail(object(avatar.values) && Object.entries(avatar.values).every(([item, value]) =>
    owns(source.items, item) && Number.isFinite(value) && value >= 0), `${key} has an invalid item value`);
  if (avatar.desire) {
    fail(Array.isArray(avatar.desire.items) && avatar.desire.items.length <= 3 &&
      avatar.desire.items.every(item => owns(source.items, item)), `${key} has invalid desired items`);
    fail(Array.isArray(avatar.desire.avatars) && avatar.desire.avatars.length <= 2 &&
      avatar.desire.avatars.every(other => owns(source.avatars, other) || other === "vale"),
    `${key} has invalid desired company`);
    fail(avatar.desire.location === null || owns(source.places, avatar.desire.location), `${key} has an unknown desired place`);
    conditions(avatar.desire.requires);
  }
  conditions(avatar.requires);
  media(avatar.portrait);
}
for (const [key, item] of Object.entries(source.items)) {
  fail(nonempty(item.name, 120) && nonempty(item.text) && nonempty(item.persona), `${key} needs identity and a voice boundary`);
  fail(owns(source.places, item.holder) || owns(source.avatars, item.holder), `${key} has no valid initial holder`);
  conditions(item.requires);
  media(item.art);
}
const choiceIds = new Set();
for (const choice of source.choices) {
  fail(id(choice.id) && choice.id.startsWith("greek-") && !choiceIds.has(choice.id), "choice IDs must be distinct");
  choiceIds.add(choice.id);
  fail(entities.has(choice.subject) && owns(source.places, choice.at), `${choice.id} has an unknown subject or place`);
  fail(nonempty(choice.label, 120) && nonempty(choice.text, 600), `${choice.id} needs short visible copy`);
  fail(Array.isArray(choice.effects) && choice.effects.length > 0 && choice.effects.length <= 12, `${choice.id} needs bounded effects`);
  conditions(choice.requires);
  for (const effect of choice.effects) {
    const valid = {
      choose: () => id(effect.key) && id(effect.value),
      set_flag: () => id(effect.key) && typeof effect.value === "boolean",
      place_item: () => owns(source.items, effect.item) && effect.place === choice.at &&
        choice.requires.some(requirement => requirement.kind === "holding" && requirement.item === effect.item && requirement.actor === "vale"),
    }[effect.kind];
    fail(valid?.(), `${choice.id} has an unsupported effect or an unproven item transfer`);
  }
}
for (const [key, options] of groups) {
  fail(id(key) && Array.isArray(options) && options.length >= 2 && new Set(options).size === options.length,
    `invalid account group ${key}`);
  fail(options.every(option => selectedValues.get(key)?.has(option)) && selectedValues.get(key)?.size === options.length,
    `${key} options and commitment actions differ`);
}
for (const route of source.routes) {
  fail(owns(source.places, route.from) && owns(source.places, route.to) && route.from !== route.to,
    "a reusable world route crosses a pack boundary");
  conditions(route.requires);
  fail(source.routes.some(reverse => reverse.from === route.to && reverse.to === route.from) ||
    source.places[route.to].exits.includes(route.from), `${route.from} → ${route.to} has no return`);
}
fail(bridge.schemaVersion === 1 && bridge.id === "shore-greek-drama" && Array.isArray(bridge.routes), "invalid composition bridge");
assert.deepEqual(bridge.routes, [{ from: "pond", to: source.entry }, { from: source.entry, to: "pond" }],
  "The Black Pond bridge must preserve an unconditional two-way return.");

// Test every account combination for readable three-person scenes and for
// mutually exclusive embodiments of the same named dramatic character.
const combinations = [...groups].reduce((states, [key, options]) => states.flatMap(state =>
  [undefined, ...options].map(value => ({ ...state, [key]: value }))), [{}]);
for (const account of combinations) {
  const cast = Object.entries(source.avatars).filter(([, avatar]) =>
    (avatar.requires || []).every(condition => condition.kind === "choice" && account[condition.key] === condition.value));
  for (const place of Object.keys(source.places))
    fail(cast.filter(([, avatar]) => avatar.place === place).length <= 2, `${place} exceeds two initially active residents`);
  const named = cast.map(([, avatar]) => avatar.canonicalPerson).filter(Boolean);
  fail(new Set(named).size === named.length, "incompatible character embodiments can be active together");
}

const reached = new Set([source.entry]), queue = [source.entry];
while (queue.length) {
  const from = queue.shift();
  for (const to of [...source.places[from].exits, ...source.routes.filter(route => route.from === from).map(route => route.to)]) {
    if (!reached.has(to)) { reached.add(to); queue.push(to); }
  }
}
fail(reached.size === Object.keys(source.places).length, "a place has no route from the harbor in any account");
const counts = {}, works = new Set();
for (const work of source.works) {
  fail(id(work.id) && !works.has(work.id), "duplicate or invalid work identity");
  works.add(work.id);
  counts[work.author] = (counts[work.author] || 0) + 1;
  fail(nonempty(work.title, 120) && nonempty(work.premise) &&
    Array.isArray(work.placeIds) && work.placeIds.length > 0 && work.placeIds.every(place => owns(source.places, place)),
    `${work.id} lacks a real setting`);
  fail(Array.isArray(work.hookChoiceIds) && work.hookChoiceIds.length > 0 && work.hookChoiceIds.every(key => choiceIds.has(key)),
    `${work.id} has no executable inquiry hook`);
  fail(["opening-episode", "branching-episode", "situated-hook"].includes(work.status), `${work.id} has an unknown coverage status`);
  fail(work.source?.catalogue === "https://greekdrama.johnhboyer.com/" && nonempty(work.source.adaptation),
    `${work.id} lacks source and adaptation provenance`);
}
assert.deepEqual(counts, { Aeschylus: 7, Sophocles: 7, Euripides: 19, Aristophanes: 11 },
  "The repertoire must cover the reader's exact 44-work inventory.");
fail(source.coverage.works === works.size, "coverage count does not match the repertoire");
const pack = {
  ...source,
  routes: [...source.routes, ...bridge.routes],
  composition: { id: bridge.id, schemaVersion: bridge.schemaVersion },
};
const text = `// Generated by v2/scripts/build-card-worldpacks.mjs. Edit the authored pack and bridge.\nexport default ${JSON.stringify(pack, null, 2)};\n`;
if (process.argv.includes("--check")) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== text) {
    console.error("Greek card pack is stale. Run node v2/scripts/build-card-worldpacks.mjs.");
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, text);
}
