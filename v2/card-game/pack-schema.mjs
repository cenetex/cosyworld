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
export const CONDITION_KINDS = ["sound"];
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
// A voice is a first-person idiolect plus a few authored lines in that voice.
const voiceOk = (e) =>
  textOk(e?.idiolect) &&
  Array.isArray(e?.lines) &&
  e.lines.length >= 3 &&
  e.lines.length <= 12 &&
  e.lines.every((line) => textOk(line, 200));
const templateOk = (v, max, names) =>
  textOk(v, max) &&
  [...v.matchAll(/\{([^}]*)\}/g)].every((m) => names.includes(m[1]));

// Media lives in the pack's own folder under the card table's assets.
export const mediaPathOk = (pack, path) =>
  typeof path === "string" &&
  new RegExp(`^assets/${pack}/[a-z0-9-]+\\.png$`).test(path);

/**
 * Validate one compiled pack (source plus bridge) against the hub it joins.
 * Returns a list of readable problems; an empty list means the pack is valid.
 */
export function packProblems(pack, hub) {
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
    ]),
    "has an unknown top-level field",
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
  const places = record(pack.places) ? pack.places : {};
  const avatars = record(pack.avatars) ? pack.avatars : {};
  const fixtures = pack.fixtures === undefined ? {} : pack.fixtures;
  check(record(places) && Object.keys(places).length > 0, "needs places");
  check(record(avatars), "avatars must be a map");
  check(record(fixtures), "fixtures must be a map");
  const own = [
    ...Object.keys(places),
    ...Object.keys(avatars),
    ...Object.keys(fixtures),
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
        "idiolect",
        "lines",
        "exits",
        "backdrop",
        "stage",
      ]),
      `place ${id} has an unknown field`,
    );
    check(
      textOk(p.name, 120) && textOk(p.text) && voiceOk(p),
      `place ${id} needs a name, text, an idiolect and 3–12 lines`,
    );
    check(
      Array.isArray(p.exits) &&
        new Set(p.exits).size === p.exits.length &&
        p.exits.every((to) => owns(places, to) && to !== id),
      `place ${id} exits must name other places in this pack`,
    );
    media(p.backdrop, `place ${id} backdrop`);
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
        "idiolect",
        "lines",
        "tastes",
        "portrait",
        "temperament",
        "variants",
      ]),
      `avatar ${id} has an unknown field`,
    );
    check(
      textOk(a.name, 120) &&
        textOk(a.text) &&
        voiceOk(a) &&
        owns(places, a.place),
      `avatar ${id} needs a name, text, an idiolect, 3–12 lines and a home place in this pack`,
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
    owns(places, id) || owns(avatars, id) || hubIds.includes(id);
  const pattern = (p, what) =>
    check(
      keysOk(p, ["verb", "item", "target", "from"]) &&
        SIGNAL_VERBS.includes(p?.verb) &&
        (p.item === undefined || hub?.items?.includes(p.item)) &&
        (p.target === undefined || entity(p.target)) &&
        (p.from === undefined || entity(p.from)),
      `${what} must match a known verb with hub items or entities`,
    );
  const condition = (c, what) =>
    check(
      record(c) &&
        CONDITION_KINDS.includes(c.kind) &&
        keysOk(c, ["kind", "at"]) &&
        Array.isArray(c.at) &&
        c.at.length > 0 &&
        c.at.length <= 4 &&
        new Set(c.at).size === c.at.length &&
        c.at.every(anyPlace),
      `${what} must be a known condition over hub or pack places`,
    );
  const crossings = Array.isArray(pack.crossings) ? pack.crossings : [];
  check(
    Array.isArray(pack.crossings) && crossings.length > 0,
    "bridge needs crossings",
  );
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
      ]) &&
        idOk(c.id) &&
        !crossingIds.has(c.id),
      `${name} needs a distinct id and only known fields`,
    );
    crossingIds.add(c?.id);
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
        keysOk(c.scenery, ["open", "closed"]) &&
          Object.values(c.scenery).every((t) => textOk(t, 400)),
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
      ]) &&
        Array.isArray(s.steps) &&
        s.steps.length >= 1 &&
        s.steps.length <= 8 &&
        typeof s.consecutive === "boolean" &&
        intOk(s.opens, 1, 9) &&
        textOk(s.complete, 400),
      `${name} signal needs 1–8 steps, consecutive, opens (1–9 turns) and complete text`,
    );
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
    for (const to of places[id]?.exits || []) reached.add(to);
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
