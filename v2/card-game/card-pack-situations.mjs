import { ITEM_IDENTITY_FIELDS, itemTypeProblem } from "./pack-items-schema.mjs";

const CATALOG = "00-encounters.json";
const isRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const hasOnly = (value, keys) =>
  isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
const isId = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const isText = (value) => typeof value === "string" && value.trim().length > 0;

function encounterChoices(catalog, file) {
  if (
    !hasOnly(catalog, ["insertBefore", "encounters"]) ||
    !isId(catalog.insertBefore) ||
    !isRecord(catalog.encounters) ||
    !Object.keys(catalog.encounters).length
  )
    throw new Error(
      `${file}: the encounter catalog needs insertBefore and encounters`,
    );
  return Object.entries(catalog.encounters).flatMap(([workId, scene]) => {
    const direct = scene?.direct === true;
    if (
      !isId(workId) ||
      !hasOnly(scene, ["stem", "at", "opening", "outcomes", "direct"]) ||
      (scene.direct !== undefined && !direct) ||
      (scene.stem !== undefined && !isId(scene.stem)) ||
      !isId(scene.at) ||
      !isText(scene.opening) ||
      !Array.isArray(scene.outcomes) ||
      scene.outcomes.length !== 2 ||
      !scene.outcomes.every(
        (entry) =>
          hasOnly(entry, direct ? ["text", "label"] : ["text", "spend"]) &&
          isText(entry.text) &&
          (direct
            ? isText(entry.label)
            : entry.spend === undefined || entry.spend === true),
      ) ||
      scene.outcomes[0].text === scene.outcomes[1].text
    )
      throw new Error(`${file}: invalid encounter ${workId}`);

    const stem = `greek-story-${scene.stem ?? workId}`;
    const at = scene.at;
    const item = `${stem}-object`;
    const heard = { kind: "flag", key: `${stem}-heard`, value: true };
    const outcome = `${stem}-outcome`;
    const hear = {
      id: `${stem}-hear`,
      subject: `${stem}-first`,
      at,
      workId,
      text: scene.opening,
      on: "talk",
      requires: [],
      effects: [{ kind: "set_flag", key: heard.key, value: true }],
    };
    const answers = ["first", "second"].map((answer, index) => {
      const { text, spend, label } = scene.outcomes[index];
      const commit = { kind: "choose", key: outcome, value: answer };
      const custody = spend
        ? { kind: "retire_item", item, forGood: true }
        : { kind: "place_item", item, place: at };
      return {
        id: `${stem}-${answer}-answer`,
        subject: `${stem}-${answer}`,
        at,
        workId,
        ...(direct ? { label } : { on: "give" }),
        humanOnly: true,
        text,
        requires: [
          heard,
          ...(direct ? [] : [{ kind: "holding", item, role: "actor" }]),
          { kind: "choice_unset", key: outcome },
        ],
        effects: direct ? [commit] : [commit, custody],
      };
    });
    return [hear, ...answers];
  });
}

function validateSidecar(sidecar, file) {
  if (
    !hasOnly(sidecar, [
      "items",
      "choices",
      "places",
      "outcomeItems",
      "supplies",
    ])
  )
    throw new Error(
      `${file}: expected items, choices, places, outcomeItems or supplies`,
    );
  for (const field of ["items", "places", "outcomeItems", "supplies"])
    if (sidecar[field] !== undefined && !isRecord(sidecar[field]))
      throw new Error(`${file}: ${field} must be an object`);
  if (sidecar.choices !== undefined && !Array.isArray(sidecar.choices))
    throw new Error(`${file}: choices must be an array`);
}

function expandItemTypes(pack) {
  const typed = Object.entries(pack.items ?? {}).filter(
    ([, item]) => item?.type !== undefined,
  );
  if (!typed.length) return pack;
  const items = { ...pack.items };
  for (const [id, item] of typed) {
    const problem = itemTypeProblem(pack.items, id, { thin: true });
    if (problem) throw new Error(`${pack.id}: ${problem}`);
    const canonical = items[item.type];
    const stock = { ...item };
    for (const field of ITEM_IDENTITY_FIELDS)
      if (canonical[field] !== undefined) stock[field] = canonical[field];
    items[id] = stock;
  }
  return { ...pack, items };
}

/** Compile authored situations into the same native pack data as the base. */
export function compilePackSituations(source, sidecars) {
  if (!sidecars.size) return expandItemTypes(source);
  let pack = structuredClone(source);
  const knownChoices = new Map(
    (pack.choices ?? []).map((choice) => [choice.id, choice]),
  );
  const placeBackdrops = new Map(),
    supplies = [];
  const release = (kind, id) => {
    const ids = pack.release?.[kind];
    if (Array.isArray(ids) && !ids.includes(id)) ids.push(id);
  };
  const addItem = (id, item, file) => {
    if (!isId(id) || !isRecord(item))
      throw new Error(`${file}: invalid item ${id}`);
    pack.items ??= {};
    if (Object.hasOwn(pack.items, id))
      throw new Error(`${file}: duplicate item ${id}`);
    pack.items[id] = item;
    release("items", id);
  };
  const addChoice = (choice, file) => {
    if (!isRecord(choice) || !isId(choice.id))
      throw new Error(`${file}: invalid choice ${choice?.id}`);
    if (knownChoices.has(choice.id))
      throw new Error(`${file}: duplicate choice ${choice.id}`);
    knownChoices.set(choice.id, choice);
    release("choices", choice.id);
  };
  const addOutcomeItem = (choice, item, file) => {
    const effects = knownChoices.get(choice)?.effects;
    const changes = Array.isArray(effects)
      ? effects.filter((effect) => effect?.kind === "choose")
      : [];
    if (
      !isRecord(item) ||
      (item.requires !== undefined && !Array.isArray(item.requires)) ||
      changes.length !== 1 ||
      !isId(changes[0].key) ||
      !isId(changes[0].value)
    )
      throw new Error(
        `${file}: outcome item needs a choice with one outcome (${choice})`,
      );
    const { id, requires = [], ...native } = item;
    const [{ key, value }] = changes;
    addItem(
      id,
      { ...native, requires: [...requires, { kind: "choice", key, value }] },
      file,
    );
  };

  for (const file of [...sidecars.keys()].sort()) {
    const sidecar = sidecars.get(file);
    if (file.split(/[/\\]/u).at(-1) === CATALOG) {
      const choices = encounterChoices(sidecar, file);
      const at = pack.choices?.findIndex(
        ({ id }) => id === sidecar.insertBefore,
      );
      if (at === undefined || at < 0)
        throw new Error(`${file}: no choice named ${sidecar.insertBefore}`);
      for (const choice of choices) addChoice(choice, file);
      pack.choices.splice(at, 0, ...choices);
      continue;
    }
    validateSidecar(sidecar, file);
    for (const [id, item] of Object.entries(sidecar.items ?? {}))
      addItem(id, item, file);
    for (const choice of sidecar.choices ?? []) {
      addChoice(choice, file);
      (pack.choices ??= []).push(choice);
    }
    for (const [id, place] of Object.entries(sidecar.places ?? {})) {
      if (
        !Object.hasOwn(pack.places ?? {}, id) ||
        !hasOnly(place, ["backdrops"]) ||
        (place.backdrops !== undefined && !Array.isArray(place.backdrops))
      )
        throw new Error(`${file}: invalid backdrop patch for ${id}`);
      if (!place.backdrops?.length) continue;
      placeBackdrops.set(id, [
        ...(placeBackdrops.get(id) ?? []),
        ...place.backdrops,
      ]);
      release("places", id);
    }
    for (const [choice, item] of Object.entries(sidecar.outcomeItems ?? {}))
      addOutcomeItem(choice, item, file);
    for (const [id, supply] of Object.entries(sidecar.supplies ?? {}))
      supplies.push({ id, supply, file });
  }
  // The renderer selects the first matching backdrop. Start with sidecar variants.
  for (const [id, variants] of placeBackdrops)
    pack.places[id].backdrops = [
      ...variants,
      ...(pack.places[id].backdrops ?? []),
    ];
  pack = expandItemTypes(pack);
  for (const { id, supply, file } of supplies) {
    if (
      !hasOnly(supply, ["item", "at", "requires"]) ||
      !isId(supply.item) ||
      !isId(supply.at) ||
      !Array.isArray(supply.requires) ||
      !supply.requires.length ||
      !Object.hasOwn(pack.items ?? {}, supply.item) ||
      !Object.hasOwn(pack.places ?? {}, supply.at)
    )
      throw new Error(
        `${file}: supply ${id} needs a local item, place and conditions`,
      );
    const { item, at, requires } = supply;
    const name = pack.items[item]?.name,
      place = pack.places[at]?.name;
    if (!isText(name) || !isText(place))
      throw new Error(`${file}: supply ${id} needs a named item and place`);
    const choice = {
      id,
      at,
      subject: at,
      humanOnly: true,
      label: `Set out ${name}`,
      text: `${name} is set out at ${place}.`,
      requires,
      effects: [{ kind: "drop_item", item }],
    };
    addChoice(choice, file);
    (pack.choices ??= []).push(choice);
  }
  return pack;
}
