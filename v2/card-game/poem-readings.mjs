import {
  currentActor,
  controlledByHuman,
  humanPresent,
  humanAvatarIds,
} from "./human-cast.mjs";
import { readingDigest, utf8Length } from "./reading-digest.mjs";
import { publishedCatalogIdentity } from "./poem-catalogs.mjs";

export const readingLimits = Object.freeze({
  sites: 6,
  optional: 8,
  records: 56,
  rows: 512,
  tuples: 1024,
  pageSize: 4,
  listeners: 2,
  bytes: 384 * 1024,
});
const owns = (value, key) => !!value && Object.hasOwn(value, key);
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= low && value <= high;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const rowFor = (verse) => ({
  choice: verse.choice,
  lines: [...verse.lines],
  ...(verse.after
    ? { after: { choice: verse.after.choice, lines: [...verse.after.lines] } }
    : {}),
});

// A later catalog retains the row and author identities used by earlier reads.
export function makeReadingCatalog({
  id,
  pack,
  title,
  verses,
  authors,
  previous = null,
}) {
  const currentRows = verses.map(rowFor);
  const byChoice = new Map(currentRows.map((row) => [row.choice, row]));
  if (
    !currentRows.length ||
    currentRows.length > readingLimits.rows ||
    byChoice.size !== currentRows.length
  )
    throw new Error("Use a bounded catalog with distinct stanza identities.");
  const rows = (previous?.rows || []).map((old) => {
    if (!same(old, byChoice.get(old.choice)))
      throw new Error("Give changed published wording a new stanza identity.");
    byChoice.delete(old.choice);
    return rowFor(old);
  });
  rows.push(...byChoice.values());
  const names = new Map(authors.map((author) => [author.id, author.name]));
  if (names.size !== authors.length)
    throw new Error("Use distinct author identities.");
  const authorRows = (previous?.authors || []).map((author) => ({
    id: author.id,
    name: names.get(author.id) || author.name,
  }));
  const oldAuthors = new Set(authorRows.map((author) => author.id));
  authorRows.push(
    ...authors
      .filter((author) => !oldAuthors.has(author.id))
      .map((author) => ({ ...author })),
  );
  const body = { id, pack, title, rows, authors: authorRows };
  const catalog = { ...body, digest: readingDigest(JSON.stringify(body)) };
  for (const row of rows) {
    Object.freeze(row.lines);
    if (row.after) {
      Object.freeze(row.after.lines);
      Object.freeze(row.after);
    }
    Object.freeze(row);
  }
  authorRows.forEach(Object.freeze);
  Object.freeze(rows);
  Object.freeze(authorRows);
  return Object.freeze(catalog);
}

export const emptyPoemReadings = () => ({
  version: 1,
  stanzas: [],
  readings: {},
  drafts: {},
  pins: {},
  decisions: {},
});
export const readingBlockBytes = (state) => utf8Length(JSON.stringify(state));
let validationScope = null;

// A command gets a fresh scope. Only exact positive checks can be reused.
export function withReadingValidation(operation) {
  const previous = validationScope;
  validationScope = new Map();
  try {
    return operation();
  } finally {
    validationScope = previous;
  }
}
const siteFor = (pack, id) =>
  pack.recital?.sites?.find((site) => site.id === id);
const canonicalKey = (site, reader) => `site:${site}:${reader}`;
const pageCount = (reading) =>
  Math.max(1, Math.ceil(reading.selection.length / readingLimits.pageSize));
function actorHere(world, actor, place) {
  return (
    world.actors[actor]?.place === place &&
    (!humanAvatarIds.includes(actor) || humanPresent(world, actor))
  );
}
function readerHere(world, reader, place) {
  if (
    currentActor(world) !== reader ||
    !humanAvatarIds.includes(reader) ||
    !controlledByHuman(world, reader) ||
    !actorHere(world, reader, place)
  )
    throw new Error("Bring your own present avatar to the reading.");
}
function commit(state, next) {
  if (readingBlockBytes(next) > readingLimits.bytes)
    throw new Error("The reading archive is full. Replay a saved reading.");
  Object.assign(state, next);
}
function earnedTuples(world, pack, catalog, through) {
  const saved = world.packs[pack.id];
  const authors = new Map(catalog.authors.map((author, i) => [author.id, i]));
  return catalog.rows
    .map((row, index) => [row, index])
    .filter(([row]) => integer(saved.receipts[row.choice], 1, through))
    .sort(
      ([a, ai], [b, bi]) =>
        saved.receipts[a.choice] - saved.receipts[b.choice] || ai - bi,
    )
    .map(([row, index]) => {
      const author = saved.recitals[row.choice]?.actor ?? null;
      if (author !== null && !authors.has(author))
        throw new Error("Use the published catalog for this stanza's author.");
      return [
        index,
        saved.receipts[row.choice],
        author === null ? null : authors.get(author),
        row.after &&
        saved.receipts[row.after.choice] < saved.receipts[row.choice]
          ? 1
          : 0,
      ];
    });
}
const snapshotDigest = (catalog, tuples) =>
  readingDigest(JSON.stringify([catalog.digest, tuples]));

export function setReadingDraft(world, pack, state, siteId, reader, guests) {
  const site = siteFor(pack, siteId);
  if (!site) throw new Error("Choose an authored reading site.");
  readerHere(world, reader, site.at);
  if (
    !Array.isArray(guests) ||
    new Set(guests).size !== guests.length ||
    guests.some(
      (id) =>
        id === reader ||
        !humanAvatarIds.includes(id) ||
        !actorHere(world, id, site.at),
    )
  )
    throw new Error("Invite the people who are present beside you.");
  const invited = humanAvatarIds.filter((id) => guests.includes(id));
  commit(state, {
    ...state,
    drafts: { ...state.drafts, [reader]: { site: siteId, invited } },
  });
}

// The start is support evidence. The final page earns the site's completion.
export function beginReading(
  world,
  pack,
  catalog,
  state,
  { site: siteId, reader, optional = false },
) {
  const site = siteFor(pack, siteId);
  if (!site || catalog.pack !== pack.id)
    throw new Error("Choose the site's published poem catalog.");
  readerHere(world, reader, site.at);
  const fixed = site.listeners;
  if (
    !Array.isArray(fixed) ||
    fixed.length < 1 ||
    fixed.length > readingLimits.listeners ||
    new Set(fixed).size !== fixed.length ||
    fixed.some((id) => !actorHere(world, id, site.at))
  )
    throw new Error("Bring the required listeners together.");
  if (!integer(world.turn, 1))
    throw new Error("Start the reading on an accepted turn.");
  const draft = state.drafts[reader];
  const guests = draft?.site === siteId ? draft.invited : [];
  if (guests.some((id) => !actorHere(world, id, site.at)))
    throw new Error("Choose the present audience again.");
  const optionalSlots = Object.keys(state.readings).filter((id) =>
    id.startsWith("optional:"),
  );
  if (optional && optionalSlots.length >= readingLimits.optional)
    throw new Error("Replay a saved reading from the archive.");
  const id = optional
    ? `optional:${optionalSlots.length}:${reader}`
    : canonicalKey(siteId, reader);
  if (owns(state.readings, id))
    throw new Error("Resume your original reading at this site.");
  const audience = [reader, ...fixed, ...guests];
  if (new Set(audience).size !== audience.length)
    throw new Error("Choose distinct listeners.");
  const tuples = earnedTuples(world, pack, catalog, world.turn - 1);
  const stanzas = [...state.stanzas];
  const indices = new Map(
    stanzas.map((tuple, index) => [JSON.stringify(tuple), index]),
  );
  const selection = tuples.map((tuple) => {
    const key = JSON.stringify(tuple);
    if (!indices.has(key)) {
      indices.set(key, stanzas.length);
      stanzas.push(tuple);
    }
    return indices.get(key);
  });
  if (
    stanzas.length > readingLimits.tuples ||
    Object.keys(state.readings).length >= readingLimits.records
  )
    throw new Error("Replay an existing reading from the bounded archive.");
  const reading = {
    site: siteId,
    reader,
    catalog: catalog.id,
    catalogDigest: catalog.digest,
    poemDigest: snapshotDigest(catalog, tuples),
    selection,
    turn: world.turn,
    through: world.turn - 1,
    place: site.at,
    audience,
    requiredMask: (1 << (1 + fixed.length)) - 1,
    departedMask: 0,
    pages: [],
    complete: false,
  };
  const drafts = { ...state.drafts };
  delete drafts[reader];
  commit(state, {
    ...state,
    stanzas,
    drafts,
    readings: { ...state.readings, [id]: reading },
  });
  return id;
}

export function readingPage(state, reading, catalog, index) {
  if (!integer(index, 0, pageCount(reading) - 1))
    throw new Error("Choose a page in this reading.");
  return reading.selection
    .slice(index * readingLimits.pageSize, (index + 1) * readingLimits.pageSize)
    .map((slot) => {
      const [rowIndex, turn, authorIndex, variant] = state.stanzas[slot];
      const row = catalog.rows[rowIndex];
      const author = authorIndex === null ? null : catalog.authors[authorIndex];
      return {
        id: row.choice,
        turn,
        authorId: author?.id ?? null,
        authorName: author?.name ?? "an earlier traveler",
        lines: [...(variant ? row.after.lines : row.lines)],
      };
    });
}
function readingFor(state, catalogs, id) {
  const reading = state.readings[id];
  const catalog =
    reading && owns(catalogs, reading.catalog) && catalogs[reading.catalog];
  if (!reading || !catalog || reading.catalogDigest !== catalog.digest)
    throw new Error("Load this reading's exact published catalog.");
  return { reading, catalog };
}

export function publishReadingPage(world, state, catalogs, id, reader) {
  const { reading, catalog } = readingFor(state, catalogs, id);
  readerHere(world, reader, reading.place);
  if (reader !== reading.reader || reading.complete)
    throw new Error("Choose your unfinished reading.");
  const index = reading.pages.length;
  const previousTurn = reading.pages.at(-1)?.[0] ?? reading.turn;
  if (!integer(world.turn, previousTurn + 1))
    throw new Error("Publish on the next accepted turn.");
  let mask = 0;
  for (const [i, actor] of reading.audience.entries())
    if (actorHere(world, actor, reading.place)) mask |= 1 << i;
  if ((mask & reading.requiredMask) !== reading.requiredMask)
    throw new Error("Bring the required listeners back together.");
  const optionalMask =
    ((1 << reading.audience.length) - 1) ^ reading.requiredMask;
  const departedMask = reading.departedMask | (optionalMask & ~mask);
  mask &= ~departedMask;
  const updated = {
    ...reading,
    departedMask,
    pages: [...reading.pages, [world.turn, mask, mask]],
    complete: index + 1 === pageCount(reading),
  };
  const firstCompletion = updated.complete && !owns(state.pins, reading.site);
  const pins = firstCompletion
    ? { ...state.pins, [reading.site]: id }
    : state.pins;
  commit(state, {
    ...state,
    pins,
    readings: { ...state.readings, [id]: updated },
  });
  return {
    id,
    index,
    readingTurn: reading.turn,
    through: reading.through,
    publishedTurn: world.turn,
    firstCompletion,
    audience: reading.audience.filter((_, i) => mask & (1 << i)),
    stanzas: readingPage(state, updated, catalog, index),
  };
}

export function replayReadingPage(
  world,
  state,
  catalogs,
  id,
  reader,
  index,
  listener,
) {
  const { reading, catalog } = readingFor(state, catalogs, id);
  readerHere(world, reader, reading.place);
  const bit = reading.audience.indexOf(listener);
  if (
    reader !== reading.reader ||
    bit < 0 ||
    !actorHere(world, listener, reading.place) ||
    !integer(index, 0, reading.pages.length - 1) ||
    !integer(world.turn, reading.pages[index][0] + 1)
  )
    throw new Error("Replay a published page to a present original listener.");
  const pages = reading.pages.map((page, i) =>
    i === index ? [page[0], page[1], page[2] | (1 << bit)] : [...page],
  );
  commit(state, {
    ...state,
    readings: { ...state.readings, [id]: { ...reading, pages } },
  });
  return {
    id,
    index,
    readingTurn: reading.turn,
    through: reading.through,
    publishedTurn: world.turn,
    audience: [...new Set([reader, listener])],
    stanzas: readingPage(state, reading, catalog, index),
  };
}

// Optional guests keep their departure even when they return between pages.
export function noteReadingDepartures(world) {
  let changed = false;
  for (const pack of Object.values(world.packs || {}))
    for (const reading of Object.values(pack.poemReadings?.readings || {})) {
      if (reading.complete) continue;
      for (const [bit, actor] of reading.audience.entries()) {
        const mask = 1 << bit;
        if (
          !(reading.requiredMask & mask) &&
          !(reading.departedMask & mask) &&
          !actorHere(world, actor, reading.place)
        ) {
          reading.departedMask |= mask;
          changed = true;
        }
      }
    }
  return changed;
}

export function heardReadingPages(state, catalogs, actor) {
  return Object.entries(state.readings).flatMap(([id, reading]) => {
    const bit = reading.audience.indexOf(actor);
    if (bit < 0) return [];
    const catalog = catalogs[reading.catalog];
    const pages = reading.pages.flatMap((page, i) =>
      page[2] & (1 << bit)
        ? [
            {
              index: i,
              publishedTurn: page[0],
              stanzas: readingPage(state, reading, catalog, i),
            },
          ]
        : [],
    );
    if (!pages.length && actor !== reading.reader) return [];
    return [
      {
        id,
        site: reading.site,
        title: catalog.title,
        readingTurn: reading.turn,
        through: reading.through,
        pages,
        pageCount: pageCount(reading),
        complete: reading.complete,
        heardAll: reading.complete && pages.length === pageCount(reading),
        ...(actor === reading.reader
          ? { audience: [...reading.audience] }
          : {}),
      },
    ];
  });
}

// A public exchange can use a page only when every listener has heard it.
export function sharedHeardPages(world, state, catalogs, recipient, audience) {
  const place = world.actors[recipient]?.place;
  const viewer = currentActor(world);
  if (!humanAvatarIds.includes(viewer) || !actorHere(world, viewer, place))
    return [];
  if (!Array.isArray(audience) || !audience.length) return [];
  return heardReadingPages(state, catalogs, recipient).flatMap((view) => {
    const reading = state.readings[view.id];
    const bits = audience.map((actor) => reading.audience.indexOf(actor));
    if (bits.some((bit) => bit < 0)) return [];
    const pages = view.pages.filter((page) =>
      bits.every((bit) => reading.pages[page.index][2] & (1 << bit)),
    );
    return pages.length
      ? [
          {
            ...view,
            pages,
            heardAll: reading.complete && pages.length === pageCount(reading),
          },
        ]
      : [];
  });
}

export function completedHeardReading(state, site, actor) {
  return (
    Object.entries(state?.readings || {})
      .filter(([, reading]) => {
        const bit = reading.audience.indexOf(actor);
        return (
          reading.site === site &&
          reading.complete &&
          bit >= 0 &&
          reading.pages.every((page) => page[2] & (1 << bit))
        );
      })
      .sort(([, left], [, right]) => right.turn - left.turn)[0]?.[0] || null
  );
}

export function validReadingDecisions(world, pack) {
  const saved = world.packs[pack.id],
    state = saved.poemReadings;
  if (!state) return !pack.recital?.sites?.length;
  const required = pack.choices.filter((choice) =>
    choice.requires?.some((condition) => condition.kind === "reading_complete"),
  );
  if (
    Object.keys(state.decisions).some(
      (id) =>
        !required.some((choice) => choice.id === id) ||
        !owns(saved.receipts, id),
    )
  )
    return false;
  return required.every((choice) => {
    if (!owns(saved.receipts, choice.id))
      return !owns(state.decisions, choice.id);
    const reading = state.readings[state.decisions[choice.id]];
    const actor = saved.recitals[choice.id]?.actor;
    const bit = reading?.audience.indexOf(actor);
    return (
      reading?.complete &&
      actor &&
      bit >= 0 &&
      choice.requires
        .filter((condition) => condition.kind === "reading_complete")
        .every((condition) => condition.site === reading.site) &&
      reading.pages.every((page) => page[2] & (1 << bit)) &&
      saved.receipts[choice.id] >= reading.pages.at(-1)[0]
    );
  });
}

// Views share compact tuples. Each player receives only pages they heard;
// the original reader can also review their own frozen planned pages.
export function projectPoemReadings(state, actor) {
  const stanzas = [],
    slots = new Map(),
    readings = [];
  const intern = (index) => {
    if (!slots.has(index)) {
      slots.set(index, stanzas.length);
      stanzas.push([...state.stanzas[index]]);
    }
    return slots.get(index);
  };
  for (const [id, reading] of Object.entries(state.readings)) {
    const bit = reading.audience.indexOf(actor);
    if (bit < 0) continue;
    const owner = actor === reading.reader;
    const pages = Array.from({ length: pageCount(reading) }, (_, index) => {
      const receipt = reading.pages[index];
      if (!owner && !(receipt?.[2] & (1 << bit))) return null;
      return [
        index,
        receipt?.[0] ?? null,
        reading.selection
          .slice(
            index * readingLimits.pageSize,
            (index + 1) * readingLimits.pageSize,
          )
          .map(intern),
      ];
    }).filter(Boolean);
    if (!owner && !pages.length) continue;
    readings.push({
      id,
      site: reading.site,
      reader: reading.reader,
      catalog: reading.catalog,
      readingTurn: reading.turn,
      through: reading.through,
      complete: reading.complete,
      pageCount: pageCount(reading),
      pages,
      heardAll:
        reading.complete && reading.pages.every((page) => page[2] & (1 << bit)),
      ...(owner ? { audience: [...reading.audience] } : {}),
    });
  }
  return { stanzas, readings };
}

export function validPoemReadings(world, pack, catalogs, state) {
  if (!validationScope) return checkPoemReadings(world, pack, catalogs, state);
  try {
    const identity = publishedCatalogIdentity(catalogs);
    const saved = world.packs[pack.id];
    const key = JSON.stringify([
      pack.id,
      pack.recital?.sites,
      pack.choices.map((choice) => choice.id),
      identity === null ? ["bytes", catalogs] : ["immutable", identity],
      state,
      saved.receipts,
      saved.recitals,
    ]);
    const checked = validationScope.get(key);
    if (
      Number.isSafeInteger(world.turn) &&
      checked !== undefined &&
      world.turn >= checked
    )
      return true;
    const valid = checkPoemReadings(world, pack, catalogs, state);
    if (valid && Number.isSafeInteger(world.turn))
      validationScope.set(key, world.turn);
    return valid;
  } catch {
    return false;
  }
}

function checkPoemReadings(world, pack, catalogs, state) {
  try {
    if (
      !record(state) ||
      Object.keys(state).sort().join() !==
        "decisions,drafts,pins,readings,stanzas,version" ||
      state.version !== 1 ||
      !Array.isArray(state.stanzas) ||
      state.stanzas.length > readingLimits.tuples ||
      ![state.readings, state.drafts, state.pins, state.decisions].every(
        record,
      ) ||
      Object.keys(state.readings).length > readingLimits.records ||
      Object.keys(state.drafts).length > humanAvatarIds.length ||
      Object.keys(state.decisions).length > 16 ||
      readingBlockBytes(state) > readingLimits.bytes
    )
      return false;
    const sites = pack.recital?.sites || [];
    if (
      sites.length > readingLimits.sites ||
      new Set(sites.map((site) => site.id)).size !== sites.length
    )
      return false;
    const catalog = Object.values(catalogs)
      .filter((entry) => entry.pack === pack.id)
      .sort(
        (a, b) =>
          b.rows.length - a.rows.length || b.authors.length - a.authors.length,
      )[0];
    if (!catalog) return false;
    const keys = new Set();
    for (const tuple of state.stanzas) {
      if (
        !Array.isArray(tuple) ||
        tuple.length !== 4 ||
        !integer(tuple[0], 0, readingLimits.rows - 1) ||
        !integer(tuple[1], 1, world.turn) ||
        !(tuple[2] === null || integer(tuple[2], 0)) ||
        ![0, 1].includes(tuple[3]) ||
        keys.has(JSON.stringify(tuple))
      )
        return false;
      const row = catalog.rows[tuple[0]];
      const author = tuple[2] === null ? null : catalog.authors[tuple[2]]?.id;
      if (
        !row ||
        (tuple[3] === 1 && !row.after) ||
        world.packs[pack.id].receipts[row.choice] !== tuple[1] ||
        author !== (world.packs[pack.id].recitals[row.choice]?.actor ?? null)
      )
        return false;
      keys.add(JSON.stringify(tuple));
    }
    for (const [reader, draft] of Object.entries(state.drafts)) {
      if (
        !humanAvatarIds.includes(reader) ||
        !record(draft) ||
        Object.keys(draft).sort().join() !== "invited,site" ||
        !siteFor(pack, draft.site) ||
        !Array.isArray(draft.invited) ||
        new Set(draft.invited).size !== draft.invited.length ||
        draft.invited.some(
          (id) => id === reader || !humanAvatarIds.includes(id),
        ) ||
        !same(
          draft.invited,
          humanAvatarIds.filter((id) => draft.invited.includes(id)),
        )
      )
        return false;
    }
    const optionalSlots = new Set();
    const complete = new Map();
    const expected = new Map();
    const earned = new Map();
    for (const [id, reading] of Object.entries(state.readings)) {
      if (
        !record(reading) ||
        Object.keys(reading).sort().join() !==
          "audience,catalog,catalogDigest,complete,departedMask,pages,place,poemDigest,reader,requiredMask,selection,site,through,turn"
      )
        return false;
      const site = siteFor(pack, reading.site);
      const catalog =
        owns(catalogs, reading.catalog) && catalogs[reading.catalog];
      if (
        !site ||
        !catalog ||
        catalog.pack !== pack.id ||
        catalog.digest !== reading.catalogDigest ||
        !humanAvatarIds.includes(reading.reader) ||
        reading.place !== site.at ||
        !integer(reading.turn, 1, world.turn) ||
        reading.through !== reading.turn - 1 ||
        !Array.isArray(reading.selection) ||
        reading.selection.length > readingLimits.rows ||
        !Array.isArray(reading.audience) ||
        reading.audience.length >
          humanAvatarIds.length + readingLimits.listeners ||
        new Set(reading.audience).size !== reading.audience.length ||
        !same(reading.audience.slice(0, 1 + site.listeners.length), [
          reading.reader,
          ...site.listeners,
        ]) ||
        reading.audience
          .slice(1 + site.listeners.length)
          .some((actor) => !humanAvatarIds.includes(actor)) ||
        reading.requiredMask !== (1 << (1 + site.listeners.length)) - 1
      )
        return false;
      const optional = /^optional:([0-7]):([a-z][a-z0-9-]*)$/.exec(id);
      if (optional) {
        if (optional[2] !== reading.reader || optionalSlots.has(optional[1]))
          return false;
        optionalSlots.add(optional[1]);
      } else if (id !== canonicalKey(reading.site, reading.reader))
        return false;
      const selected = reading.selection.map((index) =>
        integer(index, 0, state.stanzas.length - 1)
          ? state.stanzas[index]
          : null,
      );
      if (selected.some((tuple) => !tuple)) return false;
      if (!earned.has(catalog.digest))
        earned.set(
          catalog.digest,
          earnedTuples(world, pack, catalog, world.turn),
        );
      const all = earned.get(catalog.digest);
      const end = all.findIndex((tuple) => tuple[1] > reading.through);
      const count = end < 0 ? all.length : end;
      // Receipt order fixes the exact prefix. Readers with the same earned
      // prefix share its validation work while keeping their own start turn.
      const expectedKey = `${catalog.digest}:${count}`;
      if (!expected.has(expectedKey)) {
        const tuples = all.slice(0, count);
        expected.set(expectedKey, {
          tuples: JSON.stringify(tuples),
          digest: snapshotDigest(catalog, tuples),
        });
      }
      const snapshot = expected.get(expectedKey);
      if (
        JSON.stringify(selected) !== snapshot.tuples ||
        reading.poemDigest !== snapshot.digest
      )
        return false;
      if (
        !Array.isArray(reading.pages) ||
        reading.pages.length > pageCount(reading) ||
        reading.complete !== (reading.pages.length === pageCount(reading))
      )
        return false;
      const fullMask = (1 << reading.audience.length) - 1;
      const guests = fullMask ^ reading.requiredMask;
      let departed = 0,
        lastTurn = reading.turn;
      for (const page of reading.pages) {
        if (
          !Array.isArray(page) ||
          page.length !== 3 ||
          !integer(page[0], lastTurn + 1, world.turn) ||
          !integer(page[1], 0, fullMask) ||
          !integer(page[2], 0, fullMask) ||
          (page[1] & reading.requiredMask) !== reading.requiredMask ||
          (page[2] & page[1]) !== page[1] ||
          page[1] & departed
        )
          return false;
        departed |= guests & ~page[1];
        lastTurn = page[0];
      }
      if (
        !integer(reading.departedMask, 0, fullMask) ||
        reading.departedMask & reading.requiredMask ||
        (reading.departedMask & departed) !== departed
      )
        return false;
      if (reading.complete) {
        const old = complete.get(reading.site);
        if (
          !old ||
          lastTurn < old.turn ||
          (lastTurn === old.turn && id < old.id)
        )
          complete.set(reading.site, { id, turn: lastTurn });
      }
    }
    if ([...optionalSlots].some((_, i) => !optionalSlots.has(String(i))))
      return false;
    if (
      Object.keys(state.pins).length !== complete.size ||
      [...complete].some(([site, first]) => state.pins[site] !== first.id)
    )
      return false;
    if (
      Object.entries(state.decisions).some(
        ([choice, id]) =>
          !pack.choices.some((entry) => entry.id === choice) ||
          !state.readings[id]?.complete,
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
