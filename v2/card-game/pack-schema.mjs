// The closed vocabulary for card-table world packs and their bridges.
// The build script and the browser registry both use this one validator, so
// an authored pack either loads exactly as checked or does not load at all.
import { validFactText } from "./knowledge.mjs";

import { EXPRESSION_TYPES } from "./expression.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import { RARITY_WEIGHTS } from "./pack-specials.mjs";

export const PACK_SCHEMA_VERSION = 1;
export const AUTHORED_TOPIC_LIMIT = 128;

// Mounted packs keep distinct public identities. The topic budget leaves room
// for witnessed events in the shared knowledge store.
export function packCompositionProblems(packs) {
  const problems = [],
    seen = new Map(),
    families = new Map();
  let count = 0;
  for (const pack of packs) {
    const stories = Array.isArray(pack?.storyQuests) ? pack.storyQuests : [];
    for (const id of new Set(stories.map((story) => story?.id))) {
      if (typeof id !== "string") continue;
      if (families.has(id))
        problems.push(
          `${pack.id}: story family ${id} is also defined by ${families.get(id)}`,
        );
      else families.set(id, pack.id);
    }
    if (!Array.isArray(pack?.topics)) continue;
    for (const topic of pack.topics) {
      count += 1;
      if (typeof topic?.id !== "string") continue;
      if (seen.has(topic.id))
        problems.push(
          `${pack.id}: topic ${topic.id} is also defined by ${seen.get(topic.id)}`,
        );
      else seen.set(topic.id, pack.id);
    }
  }
  if (count > AUTHORED_TOPIC_LIMIT)
    problems.push(
      `mounted packs have ${count} topics; the shared limit is ${AUTHORED_TOPIC_LIMIT}`,
    );
  return problems;
}
export const topicCompositionProblems = packCompositionProblems;
// Resolved plays a signal step can match. Each is a verb the engine logs.
export const SIGNAL_VERBS = [
  "ring",
  "cover",
  "take",
  "drop",
  "give",
  "light",
  "snuff",
  "talk",
  "move",
];
// Conditions a crossing can require. Each kind is evaluated by pack-rules.mjs
// from the shared world state; add a kind there, here, and in a test together.
export const CONDITION_KINDS = [
  "sound",
  "light",
  "not",
  "any",
  "choice",
  "choice_unset",
  "flag",
  "holding",
  "item_at",
  "item_present",
  "item_near",
  "tag_held",
  "shared_world",
  "connected_humans",
  "met",
  "knows",
  "pack_item_present",
  "daylight",
  "weather",
  "ship_at",
  "drawn",
  "chance",
];
// The `ship_at` dock for a ship sailing between ports.
export const AT_SEA = "@sea";
export const WEATHER_CONDITIONS = ["clear", "cloud", "rain", "mist"];
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
// The sea is an authored graph. A lane joins two docks and is two-way unless
// marked one-way. Each dock has at most four lanes and at least one way out.
export const MAX_LANES = 4;
export function laneProblems(t) {
  const out = [];
  if (!Array.isArray(t.lanes) || !t.lanes.length) return ["needs sea lanes"];
  const docks = Array.isArray(t.docks) ? t.docks : [];
  const seen = new Set(),
    neighbours = new Map(docks.map((d) => [d, new Set()])),
    leaving = new Set();
  for (const lane of t.lanes) {
    if (
      !keysOk(lane, ["from", "to", "oneWay", "opensWith"]) ||
      !docks.includes(lane.from) ||
      !docks.includes(lane.to) ||
      lane.from === lane.to ||
      (lane.oneWay !== undefined && lane.oneWay !== true)
    ) {
      out.push("has a lane that does not join two of its docks");
      continue;
    }
    const ways = [`${lane.from}>${lane.to}`];
    if (!lane.oneWay) ways.push(`${lane.to}>${lane.from}`);
    if (ways.some((way) => seen.has(way)))
      out.push(`repeats the lane ${ways[0]}`);
    for (const way of ways) seen.add(way);
    neighbours.get(lane.from).add(lane.to);
    neighbours.get(lane.to).add(lane.from);
    leaving.add(lane.from);
    if (!lane.oneWay) leaving.add(lane.to);
  }
  for (const [dock, set] of neighbours) {
    if (set.size > MAX_LANES)
      out.push(`dock ${dock} has more than ${MAX_LANES} lanes`);
    if (!leaving.has(dock)) out.push(`dock ${dock} has no lane out`);
  }
  return out;
}
// A pack's specials pool: places, residents and things drawn once per run.
// The entry stays core, and an anchor is a core place.
function specialsProblems(pack) {
  const sp = pack.specials,
    pool = Array.isArray(sp?.pool) ? sp.pool : [],
    ids = pool.map((e) => e?.id).filter(Boolean),
    own = (id) => ["places", "avatars", "items"].some((k) => owns(pack[k], id));
  const ok =
    keysOk(sp, ["draw", "pool"]) &&
    keysOk(sp.draw, ["places", "avatars", "items"]) &&
    Object.values(sp.draw).every((n) => intOk(n, 0, 8)) &&
    pool.length > 0 &&
    pool.length <= 64 &&
    new Set(ids).size === ids.length &&
    !ids.includes(pack.entry) &&
    pool.every(
      (e) =>
        Object.hasOwn(RARITY_WEIGHTS, e?.rarity) &&
        (e.none === true
          ? keysOk(e, ["none", "rarity"])
          : keysOk(e, ["id", "rarity", "anchor"]) &&
            own(e.id) &&
            (e.anchor === undefined ||
              (owns(pack.places, e.anchor) && !ids.includes(e.anchor)))),
    );
  return ok ? [] : ["specials needs a bounded draw and a pool of own entities"];
}
const keysOk = (o, allowed) =>
  record(o) && Object.keys(o).every((k) => allowed.includes(k));
// A point on a painting, as whole percentages of its width and height.
const pointOk = (o) =>
  keysOk(o, ["x", "y"]) && intOk(o.x, 0, 100) && intOk(o.y, 0, 100);
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
  (new RegExp(`^assets/${pack}/[a-z0-9-]+\\.(?:png|svg|webp)$`).test(path) ||
    /^assets\/shared\/(characters|places|items)\/[a-z0-9-]+\.(png|webp)$/.test(
      path,
    ));

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
      "sections",
      "choices",
      "works",
      "tone",
      "continuity",
      "coverage",
      "release",
      "sources",
      "observations",
      "transports",
      "recital",
      "storyQuests",
      "topics",
      "situations",
      "specials",
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
    ["storyQuests", 128],
    ["topics", 128],
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
        "voice",
        "exits",
        "backdrop",
        "backdrops",
        "art",
        "music",
        "musicMode",
        "stage",
        "requires",
        "road",
        "retired",
        "sanctuary",
        "within",
      ]),
      `place ${id} has an unknown field`,
    );
    check(
      p.sanctuary === undefined || p.sanctuary === true,
      `place ${id} sanctuary must be true when set`,
    );
    check(
      textOk(p.name, 120) && textOk(p.text) && textOk(p.persona),
      `place ${id} needs a name, text and persona`,
    );
    check(
      p.voice === undefined || textOk(p.voice, 900),
      `place ${id} voice must be short text`,
    );
    check(
      Array.isArray(p.exits) &&
        new Set(p.exits).size === p.exits.length &&
        p.exits.every((to) => owns(places, to) && to !== id),
      `place ${id} exits must name other places in this pack`,
    );
    media(p.backdrop, `place ${id} backdrop`);
    // State backdrops: the first entry whose saved conditions hold replaces
    // the backdrop, like a resident's poses. They change presentation only.
    if (p.backdrops !== undefined)
      check(
        Array.isArray(p.backdrops) &&
          p.backdrops.length > 0 &&
          p.backdrops.length <= 8 &&
          p.backdrops.every(
            (b) =>
              keysOk(b, ["backdrop", "requires"]) &&
              mediaPathOk(pack.id, b.backdrop) &&
              Array.isArray(b.requires) &&
              b.requires.length > 0,
          ),
        `place ${id} backdrops need a backdrop in this pack and saved conditions`,
      );
    // A place within another, such as a house in a quarter, links only to
    // its parent and does not count toward the parent's links.
    if (p.within !== undefined)
      check(
        owns(places, p.within) &&
          p.within !== id &&
          places[p.within].within === undefined &&
          places[p.within].exits?.includes(id) &&
          p.exits.length === 1 &&
          p.exits[0] === p.within &&
          p.road === undefined,
        `place ${id} within ${p.within} must link only to that parent`,
      );
    if (p.road !== undefined)
      check(
        Array.isArray(p.road) &&
          p.road.length === 2 &&
          new Set(p.road).size === 2 &&
          p.road.every(
            (end, i) =>
              owns(places, end) &&
              p.exits[i] === end &&
              (p.retired === true ||
                places[end].exits.includes(id) ||
                // A gated end leads onto its road by a route.
                (pack.routes || []).some((r) => r.from === end && r.to === id)),
          ) &&
          p.exits.length === 2,
        `road ${id} needs two fixed ends with a return path`,
      );
    // A retired road or place keeps its ID for saved history. No place leads
    // onto it. A retired place has one exit: the place that took it in.
    if (p.retired !== undefined)
      check(
        p.retired === true &&
          (p.road !== undefined ||
            (p.exits.length === 1 && places[p.exits[0]]?.retired !== true)) &&
          Object.values(places).every(
            (other) =>
              other.retired === true ||
              !(Array.isArray(other.exits) && other.exits.includes(id)),
          ) &&
          !(pack.routes || []).some((r) => r.to === id),
        `retired place ${id} must be a road or lead to one live place, and no exit names it`,
      );
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
    if (p.musicMode !== undefined)
      check(
        p.music !== undefined &&
          ["sequence", "random-per-visit"].includes(p.musicMode),
        `place ${id} musicMode needs a playlist and sequence or random-per-visit`,
      );
    // Every place shares one stage; this data is all that tells them apart.
    if (p.stage !== undefined)
      check(
        keysOk(p.stage, [
          "alt",
          "resident",
          "sprite",
          "focus",
          "mark",
          "lamp",
          "player",
        ]) &&
          [p.stage.focus, p.stage.lamp].every(
            (point) => point === undefined || pointOk(point),
          ) &&
          (p.stage.mark === undefined || intOk(p.stage.mark, 0, 100)) &&
          (p.stage.player === undefined || p.stage.player === false) &&
          (p.stage.resident === undefined
            ? p.stage.alt === undefined && p.stage.sprite === undefined
            : textOk(p.stage.alt, 240) &&
              owns(avatars, p.stage.resident) &&
              avatars[p.stage.resident].place === id &&
              avatars[p.stage.resident].travels === false &&
              keysOk(p.stage.sprite, ["left", "top", "width"]) &&
              ["left", "top", "width"].every((k) =>
                intOk(p.stage.sprite?.[k], 0, 100),
              )),
        `place ${id} stage needs focus, lamp and mark percentages, player false, and a resident with alt text and sprite left/top/width percentages`,
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
        "stayUntil",
        "journey",
        "roamingQuest",
        "personalQuests",
        "previousHomes",
        "standoffs",
        "startLevel",
        "seed",
        "expression",
        "presentation",
        "tastes",
        "portrait",
        "poses",
        "temperament",
        "variants",
        "home",
        "values",
        "desire",
        "want",
        "requires",
        "canonicalPerson",
      ]),
      `avatar ${id} has an unknown field`,
    );
    check(
      a.startLevel === undefined || intOk(a.startLevel, 1, 99),
      `avatar ${id} startLevel needs a whole level from 1 to 99`,
    );
    check(
      a.personalQuests === undefined || typeof a.personalQuests === "boolean",
      `avatar ${id} personalQuests needs a boolean`,
    );
    check(
      textOk(a.name, 120) &&
        textOk(a.text) &&
        textOk(a.seed, 120) &&
        owns(places, a.place),
      `avatar ${id} needs a name, text, one seed sentence and a home place in this pack`,
    );
    check(
      a.expression === undefined || EXPRESSION_TYPES.includes(a.expression),
      `avatar ${id} expression needs speech, movement or emoji`,
    );
    check(
      a.presentation === undefined ||
        a.presentation === "figure" ||
        (a.presentation === "backdrop" && a.travels === false),
      `avatar ${id} presentation needs figure or a fixed backdrop resident`,
    );
    check(
      [a.travels, a.standoffs].every((v) => v === undefined || v === false) &&
        (a.roamingQuest === undefined ||
          (a.roamingQuest === "latest-completion" && a.travels !== false)),
      `avatar ${id} may only set travels or standoffs to false`,
    );
    // A resident who keeps to its scene may leave once these conditions hold.
    check(
      a.stayUntil === undefined || (a.travels === false && !a.journey),
      `avatar ${id} stayUntil needs a resident that keeps to its scene`,
    );
    check(
      a.previousHomes === undefined ||
        (a.roamingQuest &&
          Array.isArray(a.previousHomes) &&
          a.previousHomes.length <= 8 &&
          a.previousHomes.every((p) => owns(places, p))),
      `avatar ${id} previous homes need authored places`,
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
    // One want per resident: an item, a place or a person it seeks first, or
    // (BoardyAI) connecting humans.
    check(
      a.want === undefined ||
        (keysOk(a.want, ["kind", "target"]) &&
          (a.want.kind === "item"
            ? owns(items, a.want.target) || hub.items.includes(a.want.target)
            : a.want.kind === "place"
              ? owns(places, a.want.target) ||
                hub.places.includes(a.want.target)
              : a.want.kind === "connect"
                ? a.want.target === "humans"
                : a.want.kind === "person" &&
                  a.want.target !== id &&
                  (owns(avatars, a.want.target) ||
                    hub.avatars.includes(a.want.target)))),
      `avatar ${id} want needs an item, place or person target, or connects humans`,
    );
    const t = a.temperament;
    if (t === undefined) {
      check(
        a.variants === undefined,
        `avatar ${id} variants need a temperament`,
      );
      media(a.portrait, `avatar ${id} portrait`);
      // Poses: the first entry whose place and saved conditions hold replaces
      // the portrait on stage. They change presentation only.
      if (a.poses !== undefined)
        check(
          Array.isArray(a.poses) &&
            a.poses.length > 0 &&
            a.poses.length <= 8 &&
            a.poses.every(
              (p) =>
                keysOk(p, ["portrait", "at", "requires", "scale"]) &&
                mediaPathOk(pack.id, p.portrait) &&
                (p.at !== undefined || p.requires !== undefined) &&
                (p.at === undefined || owns(places, p.at)) &&
                (p.scale === undefined ||
                  (typeof p.scale === "number" &&
                    p.scale >= 0.3 &&
                    p.scale <= 1)),
            ),
          `avatar ${id} poses need a portrait in this pack, a place or saved conditions, and a scale from 0.3 to 1`,
        );
      continue;
    }
    check(
      a.portrait === undefined && a.poses === undefined,
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
  const anyPlace = (id) =>
    owns(places, id) || hub?.places?.includes(id) || mountedPlaces.includes(id);
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
        // Holds while one of two to four conditions holds.
        case "any":
          ok =
            keysOk(c, ["kind", "conditions"]) &&
            depth < 2 &&
            Array.isArray(c.conditions) &&
            c.conditions.length >= 2 &&
            c.conditions.length <= 4 &&
            c.conditions.every((r) => condition(r, what, depth + 1));
          break;
        case "choice":
          ok =
            keysOk(c, ["kind", "key", "value"]) && idOk(c.key) && idOk(c.value);
          break;
        case "choice_unset":
          ok = keysOk(c, ["kind", "key"]) && idOk(c.key);
          break;
        case "daylight":
          ok =
            keysOk(c, ["kind", "phase"]) && ["day", "night"].includes(c.phase);
          break;
        case "flag":
          ok =
            keysOk(c, ["kind", "key", "value"]) &&
            idOk(c.key) &&
            typeof c.value === "boolean";
          break;
        case "holding":
          ok =
            keysOk(c, ["kind", "item", "actor", "role"]) &&
            owns(items, c.item) &&
            (c.role === undefined
              ? c.actor === hub.player || owns(avatars, c.actor)
              : c.role === "actor" && c.actor === undefined);
          break;
        case "shared_world":
          ok = keysOk(c, ["kind"]);
          break;
        case "connected_humans":
          ok = keysOk(c, ["kind", "minimum"]) && intOk(c.minimum, 1, 8);
          break;
        case "item_near":
          ok =
            keysOk(c, ["kind", "item", "place"]) &&
            owns(items, c.item) &&
            anyPlace(c.place);
          break;
        case "tag_held":
          ok =
            keysOk(c, ["kind", "tag", "place"]) &&
            idOk(c.tag) &&
            anyPlace(c.place);
          break;
        case "item_present":
          ok =
            keysOk(c, ["kind", "item", "place"]) &&
            (owns(items, c.item) || hub.items.includes(c.item)) &&
            anyPlace(c.place);
          break;
        case "item_at":
          ok =
            keysOk(c, ["kind", "item", "place"]) &&
            owns(items, c.item) &&
            anyPlace(c.place);
          break;
        case "met":
          ok = keysOk(c, ["kind", "actor"]) && owns(avatars, c.actor);
          break;
        case "drawn":
          ok =
            keysOk(c, ["kind", "id"]) &&
            (pack.specials?.pool || []).some((e) => e?.id === c.id);
          break;
        case "pack_item_present":
          ok =
            keysOk(c, ["kind", "pack", "place"]) &&
            idOk(c.pack) &&
            anyPlace(c.place);
          break;
        case "weather":
          ok =
            keysOk(c, ["kind", "place", "condition"]) &&
            anyPlace(c.place) &&
            WEATHER_CONDITIONS.includes(c.condition);
          break;
        case "chance":
          ok =
            keysOk(c, ["kind", "key", "odds", "lasts"]) &&
            idOk(c.key) &&
            intOk(c.odds, 2, 1000) &&
            intOk(c.lasts, 1, 24);
          break;
        case "ship_at":
          ok =
            keysOk(c, ["kind", "transport", "dock"]) &&
            idOk(c.transport) &&
            (c.dock === AT_SEA || anyPlace(c.dock));
          break;
        case "knows": {
          // `topics` accepts any one of several facts, so a needed fact can
          // come from more than one person or place.
          const named = Array.isArray(c.topics) ? c.topics : [c.topic];
          ok =
            (c.topics === undefined
              ? keysOk(c, ["kind", "topic", "role"])
              : keysOk(c, ["kind", "topics", "role"]) &&
                named.length >= 2 &&
                named.length <= 4 &&
                new Set(named).size === named.length &&
                new Set(
                  named.map(
                    (id) =>
                      (pack.topics || []).find((topic) => topic.id === id)
                        ?.speaker,
                  ),
                ).size === named.length) &&
            c.role === "actor" &&
            named.every(
              (id) =>
                idOk(id) &&
                (pack.topics || []).some((topic) => topic.id === id),
            );
          break;
        }
      }
    return check(
      ok,
      `${what} must use the closed condition vocabulary with valid references`,
    );
  };
  // Saved state, or `any`/`not` over saved state, such as a thing that
  // shows only while no other thing is in the same place.
  const savedCondition = (c) =>
    ["any", "not"].includes(c?.kind)
      ? (c.conditions || [c.condition]).every(savedCondition)
      : [
          "choice",
          "choice_unset",
          "flag",
          "holding",
          "item_at",
          "item_near",
          "item_present",
          "shared_world",
          "connected_humans",
          "met",
          "knows",
          "daylight",
          "drawn",
          "chance",
        ].includes(c?.kind);
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
          !persistent || savedCondition(c),
          `${what} must use saved state or human presence conditions`,
        );
      });
  };
  for (const [id, p] of Object.entries(places)) {
    requirements(p.requires, `place ${id} requires`);
    for (const b of Array.isArray(p.backdrops) ? p.backdrops : [])
      requirements(b?.requires, `place ${id} backdrop requires`, false);
  }
  for (const [id, a] of Object.entries(avatars)) {
    requirements(a.requires, `avatar ${id} requires`);
    for (const [n, p] of (Array.isArray(a.poses) ? a.poses : []).entries())
      requirements(p?.requires, `avatar ${id} pose ${n + 1} requires`);
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
    requirements(a.stayUntil, `avatar ${id} stayUntil`);
  }
  for (const [id, i] of Object.entries(items)) {
    check(
      keysOk(i, [
        "name",
        "text",
        "persona",
        "holder",
        "art",
        "requires",
        "startLevel",
        "tags",
      ]) &&
        (i.tags === undefined ||
          (Array.isArray(i.tags) &&
            i.tags.length >= 1 &&
            i.tags.length <= 4 &&
            i.tags.every(idOk))) &&
        textOk(i.name, 120) &&
        textOk(i.text) &&
        textOk(i.persona) &&
        (owns(places, i.holder) ||
          owns(avatars, i.holder) ||
          hub?.places?.includes(i.holder)),
      `item ${id} is invalid`,
    );
    check(
      i.startLevel === undefined || intOk(i.startLevel, 1, 99),
      `item ${id} startLevel needs a whole level from 1 to 99`,
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
        "textTemplate",
        "summary",
        "requires",
        "effects",
        "workId",
        "on",
        "for",
      ]) &&
        idOk(c.id) &&
        (c.on === undefined ||
          c.on === "meet" ||
          c.on === "wait" ||
          (c.on === "depart" && Boolean(avatars[c.subject])) ||
          (c.on === "give" &&
            (c.requires || []).some(
              (r) => r.kind === "holding" && r.role === "actor",
            ) &&
            Boolean(avatars[c.subject]))) &&
        (c.for === undefined || humanAvatarIds.includes(c.for)) &&
        !choiceIds.has(c.id) &&
        own.includes(c.subject) &&
        owns(places, c.at) &&
        textOk(c.label, 120) &&
        textOk(c.text, 600) &&
        (c.textTemplate === undefined ||
          templateOk(c.textTemplate, 600, ["actor"])) &&
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
              (r.role === "actor" || r.actor === hub.player),
          );
      // A meeting hides one of the pack's things somewhere in the world.
      if (e.kind === "hide_item")
        valid =
          keysOk(e, ["kind", "item"]) && owns(items, e.item) && c.on === "meet";
      if (e.kind === "give_item")
        valid =
          keysOk(e, ["kind", "item"]) && owns(items, e.item) && c.on !== "meet";
      if (e.kind === "retire_item")
        valid =
          keysOk(e, ["kind", "item"]) &&
          owns(items, e.item) &&
          (c.requires || []).some(
            (r) =>
              r.kind === "holding" && r.item === e.item && r.role === "actor",
          );
      check(valid, `choice ${c.id} effect is unsupported or lacks custody`);
    }
  }
  for (const [id, avatar] of Object.entries(avatars)) {
    if (avatar.journey === undefined) continue;
    const journey = avatar.journey;
    const agreement = choices.find((c) => c.id === journey?.after);
    check(
      keysOk(journey, ["after", "path"]) &&
        !hub.avatars.includes(id) &&
        avatar.travels === false &&
        avatar.roamingQuest === undefined &&
        idOk(journey.after) &&
        Array.isArray(journey.path) &&
        journey.path.length >= 2 &&
        journey.path.length <= 8 &&
        new Set(journey.path).size === journey.path.length &&
        journey.path[0] === avatar.place &&
        journey.path.every((place) => owns(places, place)) &&
        journey.path.slice(1).every((to, i) => {
          const from = journey.path[i];
          return (
            places[from].exits.includes(to) ||
            routes.some((route) => route.from === from && route.to === to)
          );
        }) &&
        agreement?.subject === id &&
        agreement.at === avatar.place,
      `avatar ${id} journey needs consent at home and a simple connected path`,
    );
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
  const topicIds = new Set();
  for (const topic of pack.topics || []) {
    check(
      keysOk(topic, ["id", "speaker", "at", "text", "requires", "choiceId"]) &&
        idOk(topic.id) &&
        !topicIds.has(topic.id) &&
        owns(avatars, topic.speaker) &&
        owns(places, topic.at) &&
        validFactText(topic.text) &&
        (topic.choiceId === undefined || choiceIds.has(topic.choiceId)),
      `topic ${topic.id} needs a unique id, speaker, place, sentence and valid choice`,
    );
    topicIds.add(topic.id);
    requirements(topic.requires, `topic ${topic.id} requires`);
    verifyRefs(topic.requires);
    if (topic.choiceId !== undefined) {
      const choice = choices.find((entry) => entry.id === topic.choiceId);
      check(
        choice?.subject === topic.speaker && choice?.at === topic.at,
        `topic ${topic.id} must use its choice's speaker and place`,
      );
    }
  }
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
  if (pack.sections !== undefined) {
    check(
      Array.isArray(pack.sections) && pack.sections.length <= 32,
      "sections must be a bounded list",
    );
    const sectionIds = new Set(),
      sectionPlaces = new Set();
    for (const section of Array.isArray(pack.sections) ? pack.sections : []) {
      check(
        keysOk(section, ["id", "name", "places", "requires"]) &&
          idOk(section.id) &&
          !sectionIds.has(section.id) &&
          textOk(section.name, 120) &&
          Array.isArray(section.places) &&
          section.places.length > 0 &&
          section.places.length <= 16 &&
          new Set(section.places).size === section.places.length &&
          section.places.every(
            (id) => owns(places, id) && !sectionPlaces.has(id),
          ) &&
          Array.isArray(section.requires),
        `section ${section?.id} needs unique places and permanent requirements`,
      );
      if (!record(section)) continue;
      sectionIds.add(section.id);
      for (const id of Array.isArray(section.places) ? section.places : [])
        sectionPlaces.add(id);
      requirements(section.requires, `section ${section.id} requires`);
      if (!Array.isArray(section.requires)) continue;
      verifyRefs(section.requires);
      for (const condition of section.requires) {
        check(
          condition?.kind === "choice" ||
            (condition?.kind === "flag" && condition.value === true),
          `section ${section.id} requires a permanent choice or true flag`,
        );
        if (condition?.kind === "flag")
          check(
            choices.every((choice) =>
              choice.effects.every(
                (effect) =>
                  effect.kind !== "set_flag" ||
                  effect.key !== condition.key ||
                  effect.value === true,
              ),
            ),
            `section ${section.id} access flag must stay true`,
          );
      }
    }
  }
  const groups = pack.continuity?.groups || [];
  for (const g of groups)
    check(
      idOk(g.key) &&
        new Set(g.options).size === g.options.length &&
        g.options.every((o) => writes.get(g.key)?.has(o)) &&
        writes.get(g.key)?.size === g.options.length,
      "continuity options must match authored commitments",
    );
  if (pack.recital !== undefined) {
    const r = pack.recital;
    check(
      keysOk(r, ["actor", "title", "verses", "claims"]) &&
        owns(avatars, r?.actor) &&
        (avatars[r.actor].travels === false ||
          avatars[r.actor].roamingQuest === "latest-completion") &&
        avatars[r.actor].standoffs === false &&
        textOk(r.title, 80) &&
        Array.isArray(r.verses) &&
        r.verses.length > 0 &&
        r.verses.length <= 64,
      "recital needs a singer, a title and up to 64 verses",
    );
    const seen = new Set();
    // Couplet text is lore (content/<pack>/lore), never part of the rules.
    for (const v of Array.isArray(r?.verses) ? r.verses : []) {
      check(
        keysOk(v, ["choice", "quest", "summons"]) &&
          choiceIds.has(v?.choice) &&
          !seen.has(v.choice) &&
          idOk(v.quest) &&
          typeof v.summons === "boolean",
        "recital verse needs a unique choice, quest and summons flag",
      );
      seen.add(v?.choice);
    }
    if (r.claims !== undefined) {
      check(
        Array.isArray(r.claims) &&
          r.claims.length <= 16 &&
          r.claims.every(
            (claim) =>
              keysOk(claim, ["phrases", "anyChoices"]) &&
              Array.isArray(claim.phrases) &&
              claim.phrases.length > 0 &&
              claim.phrases.length <= 16 &&
              claim.phrases.every(
                (phrase) =>
                  textOk(phrase, 160) && phrase === phrase.toLowerCase(),
              ) &&
              Array.isArray(claim.anyChoices) &&
              claim.anyChoices.length > 0 &&
              claim.anyChoices.length <= 64 &&
              claim.anyChoices.every((choice) => seen.has(choice)),
          ),
        "recital claims need bounded phrases and supporting verse choices",
      );
    }
  }
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
  if (pack.specials !== undefined) problems.push(...specialsProblems(pack));
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
        r.places.includes(avatars[id]?.place) || pack.recital?.actor === id,
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
        ...Object.values(pack.transports || {})
          .filter((t) => t.place === id)
          .flatMap((t) => t.docks),
        ...routes.filter((r) => r.from === id).map((r) => r.to),
      ].filter((id) => r.places.includes(id)))
        reachable.add(to);
    check(
      r.places.every((p) => reachable.has(p) || places[p]?.retired === true),
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
        record(pack.coverage?.authors) &&
        Object.keys(counts).length ===
          Object.keys(pack.coverage.authors).length &&
        Object.entries(counts).every(
          ([id, n]) => pack.coverage.authors[id] === n,
        ),
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
        keysOk(t, ["place", "docks", "at", "lanes", "shipmaster"]) &&
        owns(places, t.place) &&
        !transportPlaces.has(t.place) &&
        places[t.place]?.exits.length === 0 &&
        Array.isArray(t.docks) &&
        t.docks.length >= 2 &&
        t.docks.length <= 12 &&
        new Set(t.docks).size === t.docks.length &&
        t.docks.every((p) => anyPlace(p) && p !== t.place) &&
        t.docks.includes(t.at),
      `transport ${id} needs its own place, two to twelve docks and an initial dock`,
    );
    if (!valid) continue;
    transportPlaces.add(t.place);
    for (const message of laneProblems(t))
      check(false, `transport ${id} ${message}`);
    // A gated lane opens with conditions on the ship, from its first port.
    for (const lane of t.lanes || [])
      if (lane?.opensWith !== undefined) {
        check(
          Array.isArray(lane.opensWith) &&
            lane.opensWith.length > 0 &&
            lane.opensWith.length <= 4,
          `transport ${id} lane opensWith must be a short list`,
        );
        for (const c of Array.isArray(lane.opensWith) ? lane.opensWith : [])
          condition(c, `transport ${id} lane condition`);
      }
    check(
      t.shipmaster === undefined ||
        (typeof t.shipmaster === "string" && t.shipmaster.length > 0),
      `transport ${id} shipmaster names a resident`,
    );
    check(
      crossings.filter((c) => c.transport === id).length === t.docks.length &&
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
        "retired",
      ]) &&
        idOk(c.id) &&
        (c.retired === undefined ||
          (c.retired === true &&
            c.transport === undefined &&
            c.signal === undefined)) &&
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
      `${name} must join a hub place or mounted place to this pack`,
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
          "backdrop",
          "cardArt",
          "cardName",
          "focus",
        ]) &&
          (c.scenery.focus === undefined || pointOk(c.scenery.focus)) &&
          [c.scenery.open, c.scenery.closed, c.scenery.cardName].every(
            (t) => t === undefined || textOk(t, 400),
          ) &&
          [c.scenery.overlay, c.scenery.backdrop, c.scenery.cardArt].every(
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

  // The base world owns travel between its hub places. A pack may attach
  // different rooms to different points in that connected hub.
  // Every pack place is reachable from the entry, the entry is reachable from
  // the hub, and some pack place has a crossing back to the hub.
  const reached = new Set([pack.entry]);
  for (const id of reached)
    for (const to of [
      ...(hub.places.includes(id) ? hub.places : []),
      ...(places[id]?.exits || []),
      ...Object.values(pack.transports || {})
        .filter((t) => Array.isArray(t.docks) && t.docks.includes(id))
        .map((t) => t.place),
      ...Object.values(pack.transports || {})
        .filter((t) => t.place === id)
        .flatMap((t) => t.docks),
      ...routes.filter((r) => r.from === id).map((r) => r.to),
      ...crossings.filter((c) => c.from === id).map((c) => c.to),
    ])
      reached.add(to);
  check(
    Object.entries(places).every(
      ([id, p]) => reached.has(id) || p.retired === true,
    ),
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
