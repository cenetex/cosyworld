// The closed vocabulary for card-table world packs and their bridges.
// The build script and the browser registry both use this one validator, so
// an authored pack either loads exactly as checked or does not load at all.

export const PACK_SCHEMA_VERSION = 1;
// Resolved plays a signal step can match. Each is a verb the engine logs.
export const SIGNAL_VERBS = [
  "ring",
  "cover",
  "take",
  "drop",
  "give",
  "light",
  "snuff",
  "refill",
  "talk",
  "move",
];
// Conditions a crossing can require. Each kind is evaluated by pack-rules.mjs
// from the shared world state; add a kind there, here, and in a test together.
export const CONDITION_KINDS = [
  "sound",
  "light",
  "not",
  "choice",
  "choice_unset",
  "flag",
  "holding",
  "item_at",
  "met",
];
export const TRAVELERS = ["player", "any"];
export const VARIANTS = ["asleep", "awake", "irritated"];

const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const owns = (o, key) =>
  record(o) && typeof key === "string" && Object.hasOwn(o, key);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const textOk = (v, max = 1200) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f]/.test(v);
const intOk = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const keysOk = (o, allowed) =>
  record(o) && Object.keys(o).every((k) => allowed.includes(k));
// Placeholders are {name} from a fixed list; any other brace is an error.
const templateOk = (v, max, names) =>
  textOk(v, max) &&
  !/[{}]/.test(
    v.replace(/\{([a-z]+)\}/g, (m, name) => (names.includes(name) ? "" : m)),
  );

// Packs name observable states and the direct claims that describe each value.
export function observationProblems(definitions, catalog) {
  if (definitions === undefined) return [];
  if (!Array.isArray(definitions) || definitions.length > 32)
    return ["observations must be a list of at most 32 states"];
  const seen = new Set();
  return definitions.flatMap((d) => {
    const source = d?.source;
    const collection = source?.kind === "actor_flag" ? "avatars" : "items";
    const valid =
      keysOk(d, ["id", "entity", "subjects", "source", "values", "note"]) &&
      idOk(d.id) &&
      !seen.has(d.id) &&
      catalog[collection]?.includes(d.entity) &&
      Array.isArray(d.subjects) &&
      d.subjects.length > 0 &&
      d.subjects.length <= 4 &&
      d.subjects.every(
        (s) =>
          typeof s === "string" &&
          /^[a-z]+(?: [a-z]+)*$/.test(s) &&
          s.length <= 80,
      ) &&
      keysOk(source, ["kind", "field"]) &&
      ["item_flag", "item_positive", "actor_flag", "covered"].includes(
        source.kind,
      ) &&
      (source.kind === "covered"
        ? source.field === undefined
        : idOk(source.field)) &&
      keysOk(d.values, ["true", "false"]) &&
      ["true", "false"].every((key) => {
        const v = d.values[key];
        return (
          keysOk(v, ["fact", "claims", "legacyToken"]) &&
          textOk(v.fact, 240) &&
          Array.isArray(v.claims) &&
          v.claims.length > 0 &&
          v.claims.length <= 16 &&
          v.claims.every(
            (s) =>
              typeof s === "string" &&
              /^[a-z']+(?: [a-z']+)*$/.test(s) &&
              s.length <= 80,
          ) &&
          (v.legacyToken === undefined || /^[a-z]+$/.test(v.legacyToken))
        );
      }) &&
      !d.values.true.claims.some((claim) =>
        d.values.false.claims.includes(claim),
      ) &&
      (d.values.true.legacyToken === undefined ||
        d.values.true.legacyToken !== d.values.false.legacyToken) &&
      (d.note === undefined || textOk(d.note, 300));
    seen.add(d?.id);
    return valid ? [] : [`invalid observation ${d?.id || "definition"}`];
  });
}

// Media lives in the pack's own folder under the card table's assets.
export const mediaPathOk = (pack, path) =>
  typeof path === "string" &&
  new RegExp(`^assets/${pack}/[a-z0-9-]+\\.(?:png|svg|webp)$`).test(path);

/**
 * Validate one compiled pack (source plus bridge) against the hub it joins.
 * Returns a list of readable problems; an empty list means the pack is valid.
 */
export function packProblems(pack, hub, mountedPlaces = []) {
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(`${pack?.id || "pack"}: ${message}`);
    return ok;
  };
  if (
    !check(
      record(pack) &&
        pack.schemaVersion === PACK_SCHEMA_VERSION &&
        idOk(pack.id) &&
        typeof pack.packId === "string" &&
        pack.packId === `cosyworld.${pack.id}` &&
        intOk(pack.revision, 1, 1e6),
      "needs schemaVersion 1, a stable id, packId cosyworld.<id> and a revision",
    )
  )
    return problems;
  check(
    keysOk(pack, [
      "schemaVersion",
      "id",
      "packId",
      "revision",
      "name",
      "description",
      "entry",
      "places",
      "fixtures",
      "avatars",
      "bridge",
      "values",
      "crossings",
      "items",
      "routes",
      "choices",
      "works",
      "tone",
      "continuity",
      "coverage",
      "release",
      "sources",
      "observations",
      "transports",
    ]),
    "has an unknown top-level field",
  );
  problems.push(
    ...observationProblems(pack.observations, {
      items: Object.keys(pack.items || {}),
      avatars: Object.keys(pack.avatars || {}),
    }),
  );
  check(
    textOk(pack.name, 80) && textOk(pack.description, 400),
    "needs a name and a short description",
  );
  check(
    record(hub) &&
      [hub.places, hub.avatars, hub.items].every(Array.isArray) &&
      typeof hub.player === "string",
    "needs the hub's places, avatars, items and player",
  );
  // Bound malformed author data before iterating nested collections.
  for (const [key, required, max] of [
    ["places", true, 128],
    ["avatars", true, 128],
    ["items", false, 128],
    ["fixtures", false, 32],
    ["transports", false, 8],
  ]) {
    const map = pack[key];
    if (map === undefined && !required) continue;
    if (
      !check(
        record(map) &&
          Object.keys(map).length <= max &&
          Object.values(map).every(record),
        `${key} must be a bounded entity map`,
      )
    )
      return problems;
  }
  for (const [key, max] of [
    ["routes", 256],
    ["choices", 256],
    ["works", 128],
    ["crossings", 32],
  ])
    if (
      pack[key] !== undefined &&
      !check(
        Array.isArray(pack[key]) &&
          pack[key].length <= max &&
          pack[key].every(record),
        `${key} must be a bounded record list`,
      )
    )
      return problems;
  for (const c of pack.choices || [])
    if (
      !check(
        Array.isArray(c.effects) &&
          c.effects.length > 0 &&
          c.effects.length <= 12 &&
          c.effects.every(record),
        `choice ${c.id} effects must be a bounded record list`,
      )
    )
      return problems;
  for (const e of [
    ...Object.values(pack.places),
    ...Object.values(pack.avatars),
    ...Object.values(pack.items || {}),
    ...(pack.routes || []),
    ...(pack.choices || []),
    ...(pack.crossings || []),
  ]) {
    if (
      e.requires !== undefined &&
      !check(
        Array.isArray(e.requires) && e.requires.every(record),
        "requires must be a record list",
      )
    )
      return problems;
    if (
      e.desire !== undefined &&
      !check(record(e.desire), "desire must be a record")
    )
      return problems;
  }
  if (
    pack.continuity !== undefined &&
    !check(
      record(pack.continuity) &&
        Array.isArray(pack.continuity.groups) &&
        pack.continuity.groups.length <= 4 &&
        pack.continuity.groups.every(
          (g) =>
            record(g) &&
            Array.isArray(g.options) &&
            g.options.length >= 2 &&
            g.options.length <= 4,
        ),
      "continuity needs at most four bounded branch groups",
    )
  )
    return problems;
  if (
    pack.release !== undefined &&
    !check(
      record(pack.release) &&
        ["places", "avatars", "items", "choices"].every((k) =>
          Array.isArray(pack.release[k]),
        ),
      "release needs entity and choice lists",
    )
  )
    return problems;
  if (problems.length) return problems;
  const places = record(pack.places) ? pack.places : {};
  const avatars = record(pack.avatars) ? pack.avatars : {};
  const items = pack.items === undefined ? {} : pack.items;
  check(record(items), "items must be a map");
  const fixtures = pack.fixtures === undefined ? {} : pack.fixtures;
  check(record(places) && Object.keys(places).length > 0, "needs places");
  check(record(avatars), "avatars must be a map");
  check(record(fixtures), "fixtures must be a map");
  const own = [
    ...Object.keys(places),
    ...Object.keys(avatars),
    ...Object.keys(fixtures),
    ...Object.keys(items),
  ];
  const hubIds = [
    ...(hub?.places || []),
    ...(hub?.avatars || []),
    ...(hub?.items || []),
  ];
  check(
    new Set(own).size === own.length && own.every(idOk),
    "entity ids must be distinct, lowercase and hyphenated",
  );
  check(
    own.every((id) => !hubIds.includes(id)),
    "entity ids must not reuse hub ids",
  );
  check(owns(places, pack.entry), "entry must name one of the pack's places");
  const media = (path, what) =>
    check(
      mediaPathOk(pack.id, path),
      `${what} must be assets/${pack.id}/<file>.png`,
    );

  for (const [id, p] of Object.entries(places)) {
    check(
      keysOk(p, [
        "name",
        "text",
        "persona",
        "exits",
        "backdrop",
        "art",
        "music",
        "stage",
        "requires",
      ]),
      `place ${id} has an unknown field`,
    );
    check(
      textOk(p.name, 120) && textOk(p.text) && textOk(p.persona),
      `place ${id} needs a name, text and persona`,
    );
    check(
      Array.isArray(p.exits) &&
        new Set(p.exits).size === p.exits.length &&
        p.exits.every((to) => owns(places, to) && to !== id),
      `place ${id} exits must name other places in this pack`,
    );
    media(p.backdrop, `place ${id} backdrop`);
    if (p.art !== undefined) media(p.art, `place ${id} art`);
    if (p.music !== undefined)
      check(
        Array.isArray(p.music) &&
          p.music.length > 0 &&
          p.music.length <= 16 &&
          p.music.every(
            (track) =>
              keysOk(track, ["file", "title"]) &&
              typeof track.file === "string" &&
              /^[a-z0-9][a-z0-9-]*\.mp3$/.test(track.file) &&
              textOk(track.title, 120),
          ),
        `place ${id} music needs 1–16 MP3 filenames and titles`,
      );
    if (p.stage !== undefined)
      check(
        keysOk(p.stage, ["alt", "resident", "sprite"]) &&
          textOk(p.stage.alt, 240) &&
          owns(avatars, p.stage.resident) &&
          avatars[p.stage.resident].place === id &&
          avatars[p.stage.resident].travels === false &&
          keysOk(p.stage.sprite, ["left", "top", "width"]) &&
          ["left", "top", "width"].every((k) =>
            intOk(p.stage.sprite?.[k], 0, 100),
          ),
        `place ${id} stage needs alt text, a resident that stays here, and sprite left/top/width percentages`,
      );
  }

  for (const [id, f] of Object.entries(fixtures)) {
    check(
      keysOk(f, ["name", "at", "sound"]) &&
        textOk(f.name, 120) &&
        owns(places, f.at),
      `fixture ${id} needs a name and a place in this pack`,
    );
    check(
      keysOk(f.sound, ["label", "text", "turns"]) &&
        textOk(f.sound?.label, 40) &&
        templateOk(f.sound?.text, 400, ["actor"]) &&
        intOk(f.sound?.turns, 1, 9),
      `fixture ${id} sound needs a label, text with only {actor}, and 1–9 turns`,
    );
  }

  for (const [id, a] of Object.entries(avatars)) {
    check(
      keysOk(a, [
        "name",
        "text",
        "place",
        "travels",
        "standoffs",
        "persona",
        "voice",
        "tastes",
        "portrait",
        "temperament",
        "variants",
        "home",
        "values",
        "desire",
        "requires",
        "canonicalPerson",
      ]),
      `avatar ${id} has an unknown field`,
    );
    check(
      textOk(a.name, 120) &&
        textOk(a.text) &&
        textOk(a.persona) &&
        textOk(a.voice) &&
        owns(places, a.place),
      `avatar ${id} needs a name, text, persona, voice and a home place in this pack`,
    );
    check(
      [a.travels, a.standoffs].every((v) => v === undefined || v === false),
      `avatar ${id} may only set travels or standoffs to false`,
    );
    check(
      keysOk(a.tastes, ["likes", "sore", "reason", "noise"]) &&
        textOk(a.tastes?.likes, 120) &&
        textOk(a.tastes?.sore, 120) &&
        textOk(a.tastes?.reason, 240) &&
        (a.tastes?.noise === undefined ||
          templateOk(a.tastes.noise, 240, ["actor"])),
      `avatar ${id} tastes need likes, sore and reason`,
    );
    const t = a.temperament;
    if (t === undefined) {
      check(
        a.variants === undefined,
        `avatar ${id} variants need a temperament`,
      );
      media(a.portrait, `avatar ${id} portrait`);
      continue;
    }
    check(
      a.portrait === undefined,
      `avatar ${id} with a temperament takes portraits from its variants`,
    );
    check(
      keysOk(t, [
        "asleep",
        "irritation",
        "irritated",
        "voice",
        "sound",
        "calm",
        "woken",
        "disturbed",
      ]) &&
        typeof t.asleep === "boolean" &&
        intOk(t.irritation, 1, 9) &&
        intOk(t.irritated, 1, t.irritation) &&
        ["voice", "sound", "calm"].every((k) => intOk(t[k], 0, t.irritation)) &&
        textOk(t.woken, 240) &&
        textOk(t.disturbed, 240),
      `avatar ${id} temperament needs asleep, irritation bounds, voice/sound/calm amounts and woken/disturbed text`,
    );
    check(
      keysOk(a.variants, VARIANTS) &&
        owns(a.variants, "asleep") &&
        owns(a.variants, "awake"),
      `avatar ${id} variants need asleep and awake, and may add irritated`,
    );
    for (const [name, v] of Object.entries(a.variants || {})) {
      const base = name !== "irritated";
      check(
        keysOk(v, ["portrait", "alt", "greet", "label", "want", "note"]) &&
          (base || (v.portrait === undefined && v.alt === undefined)) &&
          (!base ||
            (templateOk(v.greet, 200, ["actor", "name"]) &&
              textOk(v.alt, 240))) &&
          (v.greet === undefined ||
            templateOk(v.greet, 200, ["actor", "name"])) &&
          (v.label === undefined || textOk(v.label, 40)) &&
          textOk(v.want, 120) &&
          textOk(v.note, 400),
        `avatar ${id} variant ${name} needs want and note text${base ? ", a greeting, alt text and a portrait" : ""}`,
      );
      if (base) media(v.portrait, `avatar ${id} ${name} portrait`);
    }
  }

  // The bridge: composition data joining the pack to the hub.
  check(
    keysOk(pack.bridge, ["id", "description"]) &&
      idOk(pack.bridge?.id) &&
      textOk(pack.bridge?.description, 400),
    "bridge needs an id and description",
  );
  const values = pack.values === undefined ? {} : pack.values;
  check(
    record(values) &&
      Object.entries(values).every(
        ([actor, v]) =>
          owns(avatars, actor) &&
          record(v) &&
          Object.entries(v).every(
            ([item, n]) => hub?.items?.includes(item) && intOk(n, 0, 20),
          ),
      ),
    "bridge values map pack avatars to hub item values from 0 to 20",
  );
  const anyPlace = (id) => owns(places, id) || hub?.places?.includes(id);
  const entity = (id) =>
    owns(places, id) ||
    owns(avatars, id) ||
    owns(items, id) ||
    hubIds.includes(id);
  const pattern = (p, what) =>
    check(
      keysOk(p, ["verb", "item", "target", "from"]) &&
        SIGNAL_VERBS.includes(p?.verb) &&
        (p.item === undefined ||
          hub?.items?.includes(p.item) ||
          owns(items, p.item)) &&
        (p.target === undefined || entity(p.target)) &&
        (p.from === undefined || entity(p.from)),
      `${what} must match a known verb with hub items or entities`,
    );
  const condition = (c, what, depth = 0) => {
    let ok = record(c) && CONDITION_KINDS.includes(c.kind) && depth <= 2;
    if (ok)
      switch (c.kind) {
        case "sound":
          ok =
            keysOk(c, ["kind", "at"]) &&
            Array.isArray(c.at) &&
            c.at.length > 0 &&
            c.at.length <= 4 &&
            new Set(c.at).size === c.at.length &&
            c.at.every((p) => anyPlace(p) || mountedPlaces.includes(p));
          break;
        case "light":
          ok =
            keysOk(c, ["kind", "item", "at", "uncovered"]) &&
            (hub.items.includes(c.item) || owns(items, c.item)) &&
            Array.isArray(c.at) &&
            c.at.length > 0 &&
            c.at.length <= 4 &&
            c.at.every((p) => anyPlace(p) || mountedPlaces.includes(p)) &&
            (c.uncovered === undefined || typeof c.uncovered === "boolean");
          break;
        case "not":
          ok =
            keysOk(c, ["kind", "condition"]) &&
            depth < 2 &&
            condition(c.condition, what, depth + 1);
          break;
        case "choice":
          ok =
            keysOk(c, ["kind", "key", "value"]) && idOk(c.key) && idOk(c.value);
          break;
        case "choice_unset":
          ok = keysOk(c, ["kind", "key"]) && idOk(c.key);
          break;
        case "flag":
          ok =
            keysOk(c, ["kind", "key", "value"]) &&
            idOk(c.key) &&
            typeof c.value === "boolean";
          break;
        case "holding":
          ok =
            keysOk(c, ["kind", "item", "actor"]) &&
            owns(items, c.item) &&
            (c.actor === hub.player || owns(avatars, c.actor));
          break;
        case "item_at":
          ok =
            keysOk(c, ["kind", "item", "place"]) &&
            owns(items, c.item) &&
            owns(places, c.place);
          break;
        case "met":
          ok = keysOk(c, ["kind", "actor"]) && owns(avatars, c.actor);
          break;
      }
    return check(
      ok,
      `${what} must use the closed condition vocabulary with valid references`,
    );
  };
  const requirements = (cs, what, persistent = true) => {
    if (cs === undefined) return;
    check(
      Array.isArray(cs) && cs.length <= 12,
      `${what} must be a bounded list`,
    );
    if (Array.isArray(cs))
      cs.forEach((c) => {
        condition(c, what);
        check(
          !persistent ||
            [
              "choice",
              "choice_unset",
              "flag",
              "holding",
              "item_at",
              "met",
            ].includes(c.kind),
          `${what} must use persistent state conditions`,
        );
      });
  };
  for (const [id, p] of Object.entries(places))
    requirements(p.requires, `place ${id} requires`);
  for (const [id, a] of Object.entries(avatars)) {
    requirements(a.requires, `avatar ${id} requires`);
    if (a.canonicalPerson !== undefined)
      check(
        idOk(a.canonicalPerson),
        `avatar ${id} canonical identity is invalid`,
      );
    if (a.home !== undefined)
      check(owns(places, a.home), `avatar ${id} home is invalid`);
    if (a.values !== undefined)
      check(
        record(a.values) &&
          Object.entries(a.values).every(
            ([item, n]) => owns(items, item) && intOk(n, 0, 20),
          ),
        `avatar ${id} values are invalid`,
      );
    if (a.desire !== undefined) {
      const d = a.desire;
      check(
        keysOk(d, ["items", "location", "avatars", "requires"]) &&
          Array.isArray(d.items) &&
          d.items.length <= 3 &&
          d.items.every((i) => owns(items, i)) &&
          Array.isArray(d.avatars) &&
          d.avatars.length <= 2 &&
          d.avatars.every((i) => owns(avatars, i) || i === hub.player) &&
          (d.location === null || owns(places, d.location)),
        `avatar ${id} desire is invalid`,
      );
      requirements(d.requires, `avatar ${id} desire requires`);
    }
  }
  for (const [id, i] of Object.entries(items)) {
    check(
      keysOk(i, ["name", "text", "persona", "holder", "art", "requires"]) &&
        textOk(i.name, 120) &&
        textOk(i.text) &&
        textOk(i.persona) &&
        (owns(places, i.holder) || owns(avatars, i.holder)),
      `item ${id} is invalid`,
    );
    media(i.art, `item ${id} art`);
    requirements(i.requires, `item ${id} requires`);
  }
  const routes = pack.routes || [];
  for (const r of routes) {
    check(
      keysOk(r, ["from", "to", "requires"]) &&
        owns(places, r.from) &&
        owns(places, r.to) &&
        r.from !== r.to,
      "routes must stay within their pack",
    );
    requirements(r.requires, "route requires");
    check(
      routes.some((q) => q.from === r.to && q.to === r.from) ||
        places[r.to]?.exits?.includes(r.from),
      "a route has no return",
    );
  }
  const choices = pack.choices || [],
    choiceIds = new Set(),
    writes = new Map(),
    flags = new Set();
  for (const c of choices) {
    check(
      keysOk(c, [
        "id",
        "subject",
        "at",
        "label",
        "text",
        "summary",
        "requires",
        "effects",
        "workId",
      ]) &&
        idOk(c.id) &&
        !choiceIds.has(c.id) &&
        own.includes(c.subject) &&
        owns(places, c.at) &&
        textOk(c.label, 120) &&
        textOk(c.text, 600) &&
        (c.summary === undefined || textOk(c.summary, 600)),
      `choice ${c.id} is invalid`,
    );
    choiceIds.add(c.id);
    requirements(c.requires, `choice ${c.id} requires`);
    for (const e of c.effects) {
      let valid = false;
      if (e.kind === "choose") {
        valid =
          keysOk(e, ["kind", "key", "value"]) && idOk(e.key) && idOk(e.value);
        if (!writes.has(e.key)) writes.set(e.key, new Set());
        writes.get(e.key).add(e.value);
      }
      if (e.kind === "set_flag") {
        valid =
          keysOk(e, ["kind", "key", "value"]) &&
          idOk(e.key) &&
          typeof e.value === "boolean";
        flags.add(e.key);
      }
      if (e.kind === "place_item")
        valid =
          keysOk(e, ["kind", "item", "place"]) &&
          owns(items, e.item) &&
          e.place === c.at &&
          (c.requires || []).some(
            (r) =>
              r.kind === "holding" &&
              r.item === e.item &&
              r.actor === hub.player,
          );
      check(valid, `choice ${c.id} effect is unsupported or lacks custody`);
    }
  }
  const verifyRefs = (cs) =>
    (cs || []).forEach((c) => {
      if (c.kind === "choice")
        check(
          writes.get(c.key)?.has(c.value),
          "a condition names an unwritten choice",
        );
      if (c.kind === "choice_unset")
        check(writes.has(c.key), "a condition names an unwritten choice");
      if (c.kind === "flag")
        check(flags.has(c.key), "a condition names an unwritten flag");
    });
  [
    ...Object.values(places),
    ...Object.values(avatars),
    ...Object.values(items),
    ...routes,
    ...choices,
  ].forEach((e) => {
    verifyRefs(e.requires);
    if (e.desire) verifyRefs(e.desire.requires);
  });
  const groups = pack.continuity?.groups || [];
  for (const g of groups)
    check(
      idOk(g.key) &&
        new Set(g.options).size === g.options.length &&
        g.options.every((o) => writes.get(g.key)?.has(o)) &&
        writes.get(g.key)?.size === g.options.length,
      "continuity options must match authored commitments",
    );
  if (problems.length) return problems;
  const combinations = groups.reduce(
    (states, g) =>
      states.flatMap((state) =>
        [undefined, ...g.options].map((v) => ({ ...state, [g.key]: v })),
      ),
    [{}],
  );
  for (const account of combinations) {
    const cast = Object.values(avatars).filter((a) =>
      (a.requires || []).every(
        (c) => c.kind === "choice" && account[c.key] === c.value,
      ),
    );
    for (const place of Object.keys(places))
      check(
        cast.filter((a) => a.place === place).length <= 2,
        `${place} exceeds two initially active residents`,
      );
    const named = cast.map((a) => a.canonicalPerson).filter(Boolean);
    check(
      new Set(named).size === named.length,
      "incompatible embodiments are active together",
    );
  }
  if (pack.release !== undefined) {
    const r = pack.release;
    check(
      keysOk(r, ["places", "avatars", "items", "choices"]),
      "release has unknown fields",
    );
    for (const [key, all] of [
      ["places", places],
      ["avatars", avatars],
      ["items", items],
    ])
      check(
        new Set(r[key]).size === r[key].length &&
          r[key].every((id) => owns(all, id)),
        `release ${key} has invalid references`,
      );
    check(r.places.includes(pack.entry), "release excludes entry");
    check(
      new Set(r.choices).size === r.choices.length &&
        r.choices.every((id) => choiceIds.has(id)),
      "release choices are invalid",
    );
    for (const id of r.avatars)
      check(
        r.places.includes(avatars[id]?.place),
        "release avatar is outside its places",
      );
    for (const id of r.items)
      check(
        [...r.places, ...r.avatars].includes(items[id]?.holder),
        "release item has an unavailable holder",
      );
    for (const c of choices.filter((c) => r.choices.includes(c.id)))
      check(
        r.places.includes(c.at) &&
          [...r.places, ...r.avatars, ...r.items].includes(c.subject),
        "release choice is unavailable",
      );
    const reachable = new Set([pack.entry]);
    for (const id of reachable)
      for (const to of [
        ...places[id].exits,
        ...Object.values(pack.transports || {})
          .filter((t) => Array.isArray(t.docks) && t.docks.includes(id))
          .map((t) => t.place),
        ...routes.filter((r) => r.from === id).map((r) => r.to),
      ].filter((id) => r.places.includes(id)))
        reachable.add(to);
    check(
      r.places.every((p) => reachable.has(p)),
      "release contains a disconnected place",
    );
  }
  if (pack.works !== undefined) {
    const seen = new Set(),
      counts = {};
    for (const w of pack.works) {
      check(
        idOk(w.id) &&
          !seen.has(w.id) &&
          textOk(w.title, 120) &&
          textOk(w.premise) &&
          Array.isArray(w.placeIds) &&
          w.placeIds.length > 0 &&
          w.placeIds.every((id) => owns(places, id)) &&
          Array.isArray(w.hookChoiceIds) &&
          w.hookChoiceIds.every((id) => choiceIds.has(id)) &&
          ["opening-episode", "branching-episode", "situated-hook"].includes(
            w.status,
          ),
        "invalid work record",
      );
      seen.add(w.id);
      counts[w.author] = (counts[w.author] || 0) + 1;
    }
    check(
      pack.coverage?.works === seen.size &&
        JSON.stringify(counts) === JSON.stringify(pack.coverage?.authors),
      "repertoire counts disagree",
    );
  }
  const crossings = Array.isArray(pack.crossings) ? pack.crossings : [];
  check(
    Array.isArray(pack.crossings) && crossings.length > 0,
    "bridge needs crossings",
  );
  const transportPlaces = new Set();
  for (const [id, t] of Object.entries(pack.transports || {})) {
    const valid = check(
      idOk(id) &&
        keysOk(t, ["place", "docks", "at"]) &&
        owns(places, t.place) &&
        !transportPlaces.has(t.place) &&
        places[t.place]?.exits.length === 0 &&
        Array.isArray(t.docks) &&
        t.docks.length === 2 &&
        new Set(t.docks).size === 2 &&
        t.docks.every((p) => anyPlace(p) && p !== t.place) &&
        t.docks.includes(t.at),
      `transport ${id} needs its own place, two docks and an initial dock`,
    );
    if (!valid) continue;
    transportPlaces.add(t.place);
    check(
      crossings.filter((c) => c.transport === id).length === 2 &&
        (t.docks || []).every((from) =>
          crossings.some(
            (c) =>
              c.transport === id &&
              c.from === from &&
              t.docks.includes(c.to) &&
              c.to !== from,
          ),
        ),
      `transport ${id} needs a crossing in each direction`,
    );
    check(
      !(pack.routes || []).some(
        (r) => r.from === t.place || r.to === t.place,
      ) && !Object.values(places).some((p) => p.exits.includes(t.place)),
      `transport ${id} uses its dock routes`,
    );
  }
  const crossingIds = new Set();
  for (const c of crossings) {
    const name = `crossing ${c?.id}`;
    check(
      keysOk(c, [
        "id",
        "from",
        "to",
        "travelers",
        "travel",
        "signal",
        "requires",
        "scenery",
        "opened",
        "closed",
        "travelLabel",
        "transport",
      ]) &&
        idOk(c.id) &&
        !crossingIds.has(c.id),
      `${name} needs a distinct id and only known fields`,
    );
    crossingIds.add(c?.id);
    if (c.transport !== undefined)
      check(
        owns(pack.transports, c.transport) &&
          Array.isArray(pack.transports[c.transport].docks) &&
          pack.transports[c.transport].docks.includes(c.from) &&
          pack.transports[c.transport].docks?.includes(c.to),
        `${name} has an invalid transport`,
      );
    check(
      anyPlace(c?.from) &&
        anyPlace(c?.to) &&
        owns(places, c.from) !== owns(places, c.to),
      `${name} must join a hub place to a pack place`,
    );
    check(
      TRAVELERS.includes(c?.travelers) && textOk(c?.travel, 80),
      `${name} needs travelers (player or any) and travel wording`,
    );
    check(
      Array.isArray(c?.requires) && c.requires.length <= 6,
      `${name} requires must be a list`,
    );
    for (const r of c?.requires || []) condition(r, `${name} condition`);
    for (const field of ["opened", "closed"])
      if (c?.[field] !== undefined)
        check(textOk(c[field], 400), `${name} ${field} text is too long`);
    if (c?.scenery !== undefined)
      check(
        keysOk(c.scenery, [
          "open",
          "closed",
          "overlay",
          "cardArt",
          "cardName",
        ]) &&
          [c.scenery.open, c.scenery.closed, c.scenery.cardName].every(
            (t) => t === undefined || textOk(t, 400),
          ) &&
          [c.scenery.overlay, c.scenery.cardArt].every(
            (p) => p === undefined || mediaPathOk(pack.id, p),
          ),
        `${name} scenery needs open and/or closed text`,
      );
    const s = c?.signal;
    if (s === undefined) continue;
    check(
      keysOk(s, [
        "steps",
        "consecutive",
        "opens",
        "refresh",
        "offer",
        "progress",
        "hint",
        "echo",
        "complete",
        "while",
      ]) &&
        Array.isArray(s.steps) &&
        s.steps.length >= 1 &&
        s.steps.length <= 8 &&
        typeof s.consecutive === "boolean" &&
        (s.opens === null || intOk(s.opens, 1, 9)) &&
        (s.complete === undefined || textOk(s.complete, 400)),
      `${name} signal needs 1–8 steps, consecutive, opens (1–9 turns) and complete text`,
    );
    if (c.transport)
      check(s.opens === null, `${name} transport signal must have opens null`);
    requirements(s.while, `${name} signal while`, false);
    for (const [i, step] of (s.steps || []).entries())
      pattern(step, `${name} step ${i + 1}`);
    if (s.refresh !== undefined) pattern(s.refresh, `${name} refresh`);
    check(
      (s.offer === undefined || templateOk(s.offer, 400, ["actor"])) &&
        (s.hint === undefined || textOk(s.hint, 120)) &&
        (s.progress === undefined ||
          (Array.isArray(s.progress) &&
            s.progress.length < s.steps.length &&
            s.progress.every((t) => textOk(t, 400)))) &&
        (s.echo === undefined ||
          (keysOk(s.echo, ["speaker", "text"]) &&
            textOk(s.echo.speaker, 40) &&
            textOk(s.echo.text, 120))),
      `${name} signal offer, hint, progress or echo text is invalid`,
    );
    check(
      owns(places, c.to),
      `${name} signal must lead into the pack; a way back uses conditions`,
    );
  }

  // Every pack place is reachable from the entry, the entry is reachable from
  // the hub, and some pack place has a crossing back to the hub.
  const reached = new Set([pack.entry]);
  for (const id of reached)
    for (const to of [
      ...(places[id]?.exits || []),
      ...Object.values(pack.transports || {})
        .filter((t) => Array.isArray(t.docks) && t.docks.includes(id))
        .map((t) => t.place),
      ...routes.filter((r) => r.from === id).map((r) => r.to),
    ])
      reached.add(to);
  check(
    Object.keys(places).every((id) => reached.has(id)),
    "every place must be reachable from the entry",
  );
  check(
    crossings.some((c) => c?.to === pack.entry && !owns(places, c.from)),
    "the bridge needs a crossing from the hub into the entry",
  );
  check(
    crossings.some((c) => owns(places, c?.from) && !owns(places, c.to)),
    "the bridge needs a crossing back to the hub",
  );
  return problems;
}
