import {
  packDefinitions,
  packDefinition,
  conditionsMet,
  entityActive,
  packEntity,
  applyPackChoice,
} from "./pack-registry.mjs";
import {
  currentActor,
  humanAvatar,
  humanAvatarIds,
  humanPresent,
} from "./human-cast.mjs";
import {
  beginReading,
  publishReadingPage,
  replayReadingPage,
  setReadingDraft,
  projectPoemReadings,
  readingLimits,
} from "./poem-readings.mjs";
import { currentReadingCatalog, readingCatalogs } from "./poem-catalogs.mjs";

const name = (id) => humanAvatar(id)?.name || packEntity(id)?.name || id;
const at = (world, actor, place) =>
  world.actors[actor]?.place === place &&
  entityActive(world, actor) &&
  (!humanAvatarIds.includes(actor) || humanPresent(world, actor));
const archive = (world, pack) => world.packs[pack.id]?.poemReadings;
const siteFor = (pack, id) =>
  pack.recital?.sites?.find((site) => site.id === id);
function siteReady(world, pack, site, actor, stage = false) {
  return (
    at(world, actor, site.at) &&
    entityActive(world, site.at) &&
    conditionsMet(world, pack.id, site.requires, actor) &&
    site.listeners.every((listener) => at(world, listener, site.at)) &&
    (stage ? [actor, site.at] : [site.at]).includes(
      world.items[site.item]?.holder,
    )
  );
}
function card(actor, pack, site, op, value, label, extra = {}) {
  return {
    kind: "read",
    actor,
    packId: pack.id,
    siteId: site.id,
    readingOp: op,
    item: null,
    target: site.listeners[0],
    key: `read:${actor}:${pack.id}:${op}:${encodeURIComponent(value)}`,
    label,
    text: `${name(actor)} ${label[0].toLowerCase() + label.slice(1)}.`,
    cards: [site.listeners[0]],
    ...extra,
  };
}
export function readingActions(world, actor = currentActor(world)) {
  if (world.readingView)
    return world.readingView.actor === actor ? world.readingView.actions : [];
  if (!humanPresent(world, actor)) return [];
  const actions = [];
  for (const pack of packDefinitions) {
    const state = archive(world, pack);
    if (!state) continue;
    for (const site of pack.recital.sites) {
      if (!siteReady(world, pack, site, actor, true)) continue;
      const original = `site:${site.id}:${actor}`;
      const guests =
        state.drafts[actor]?.site === site.id
          ? state.drafts[actor].invited
          : [];
      const audienceReady = guests.every((guest) => at(world, guest, site.at));
      if (!state.readings[original] && audienceReady)
        actions.push(card(actor, pack, site, "start", site.id, site.label));
      else if (
        state.readings[original] &&
        audienceReady &&
        Object.keys(state.readings).filter((id) => id.startsWith("optional:"))
          .length < readingLimits.optional
      )
        actions.push(
          card(
            actor,
            pack,
            site,
            "later",
            site.id,
            `Begin a later ${site.title} reading`,
          ),
        );
      if (guests.length)
        actions.push(
          card(
            actor,
            pack,
            site,
            "clear",
            site.id,
            `Use only the required ${site.title} listeners`,
          ),
        );
      for (const guest of humanAvatarIds.filter(
        (id) => id !== actor && at(world, id, site.at),
      ))
        actions.push(
          card(
            actor,
            pack,
            site,
            "invite",
            `${site.id}/${guest}`,
            `${guests.includes(guest) ? "Release" : "Invite"} ${name(guest)} ${guests.includes(guest) ? "from" : "to"} the ${site.title} reading`,
            { invitee: guest },
          ),
        );
      if (!siteReady(world, pack, site, actor)) continue;
      for (const [id, reading] of Object.entries(state.readings))
        if (
          reading.site === site.id &&
          reading.reader === actor &&
          !reading.complete
        )
          actions.push(
            card(
              actor,
              pack,
              site,
              "page",
              id,
              `Read page ${reading.pages.length + 1} of ${Math.max(1, Math.ceil(reading.selection.length / 4))} from ${site.title}`,
              { readingId: id },
            ),
          );
    }
  }
  return actions;
}

// Archive navigation stays in the UI. A replay key resolves one current play
// in C, which keeps the action list bounded as the archive grows.
export function readingReplayAction(world, actor, packId, id, index, listener) {
  const pack = packDefinition(packId);
  const raw = pack && archive(world, pack);
  const projected = world.readingView?.packs?.[packId]?.readings.find(
    (r) => r.id === id,
  );
  const reading = raw?.readings[id] || projected;
  const site = reading && siteFor(pack, reading.site);
  const published = raw
    ? index < reading?.pages.length
    : projected?.pages.some((page) => page[0] === index && page[1] !== null);
  if (
    !reading ||
    !site ||
    reading.reader !== actor ||
    !Number.isInteger(index) ||
    index < 0 ||
    !published ||
    !reading.audience.includes(listener) ||
    listener === actor ||
    !at(world, actor, site.at) ||
    !at(world, listener, site.at) ||
    world.items[site.item]?.holder !== site.at
  )
    return null;
  return card(
    actor,
    pack,
    site,
    "replay",
    `${id}/${index}/${listener}`,
    `Read page ${index + 1} of ${site.title} again to ${name(listener)}`,
    { readingId: id, pageIndex: index, listener, target: listener },
  );
}
export function resolveReadingReplay(world, actor, key) {
  const parts = typeof key === "string" ? key.split(":") : [];
  if (
    parts.length !== 5 ||
    parts[0] !== "read" ||
    parts[1] !== actor ||
    parts[3] !== "replay"
  )
    return null;
  try {
    const [id, index, listener] = decodeURIComponent(parts[4]).split("/");
    const action = readingReplayAction(
      world,
      actor,
      parts[2],
      id,
      Number(index),
      listener,
    );
    return action?.key === key ? action : null;
  } catch {
    return null;
  }
}
export function applyReadingAction(world, action) {
  const pack = packDefinition(action.packId),
    site = siteFor(pack, action.siteId);
  const state = archive(world, pack),
    actor = action.actor;
  if (!site || !state) throw new Error("Choose a current reading.");
  if (action.readingOp === "clear") {
    setReadingDraft(world, pack, state, site.id, actor, []);
    return { privateTo: [actor] };
  }
  if (action.readingOp === "invite") {
    const guests = (
      state.drafts[actor]?.site === site.id ? state.drafts[actor].invited : []
    ).filter((id) => at(world, id, site.at));
    setReadingDraft(
      world,
      pack,
      state,
      site.id,
      actor,
      guests.includes(action.invitee)
        ? guests.filter((id) => id !== action.invitee)
        : [...guests, action.invitee],
    );
    return { privateTo: [actor] };
  }
  if (["start", "later"].includes(action.readingOp)) {
    const id = beginReading(
      world,
      pack,
      currentReadingCatalog(pack.id),
      state,
      { site: site.id, reader: actor, optional: action.readingOp === "later" },
    );
    world.items[site.item].holder = site.at;
    world.items[site.item].history = [
      ...world.items[site.item].history,
      `${name(actor)} lays it beside the ${site.title} reading.`,
    ].slice(-12);
    return { privateTo: state.readings[id].audience };
  }
  const packet =
    action.readingOp === "page"
      ? publishReadingPage(
          world,
          state,
          readingCatalogs[pack.id],
          action.readingId,
          actor,
        )
      : replayReadingPage(
          world,
          state,
          readingCatalogs[pack.id],
          action.readingId,
          actor,
          action.pageIndex,
          action.listener,
        );
  const completion =
    packet.firstCompletion &&
    !Object.hasOwn(world.packs[pack.id].receipts, site.completion)
      ? applyPackChoice(world, {
          actor,
          packId: pack.id,
          choiceId: site.completion,
        })
      : null;
  return {
    privateTo: packet.audience,
    hearing: [pack.id, packet.id, packet.index],
    completion,
  };
}
export function projectReadingView(world, actor) {
  const packs = {};
  for (const pack of packDefinitions) {
    const state = archive(world, pack);
    if (state) packs[pack.id] = projectPoemReadings(state, actor);
  }
  return { actor, packs, actions: readingActions(world, actor) };
}
export function upgradeReadingArchives(world, packs) {
  for (const pack of packs) {
    const state = world.packs?.[pack.id];
    if (
      !pack.recital?.sites?.length ||
      !state ||
      state.poemReadings !== undefined
    )
      continue;
    if (
      pack.choices.some(
        (choice) =>
          Object.hasOwn(state.receipts || {}, choice.id) &&
          choice.requires?.some(
            (condition) => condition.kind === "reading_complete",
          ),
      )
    )
      continue;
    state.poemReadings = {
      version: 1,
      stanzas: [],
      readings: {},
      drafts: {},
      pins: {},
      decisions: {},
    };
  }
}
export function validHearingRef(world, ref, audience, turn, place) {
  if (ref === undefined) return true;
  try {
    if (
      !Array.isArray(ref) ||
      ref.length !== 4 ||
      !Array.isArray(audience) ||
      !Number.isSafeInteger(ref[2]) ||
      ref[2] < 0 ||
      !Number.isSafeInteger(ref[3]) ||
      ref[3] > turn
    )
      return false;
    const reading = world.packs[ref[0]].poemReadings.readings[ref[1]];
    const page = reading.pages[ref[2]];
    if (!page || reading.place !== place || ref[3] < page[0]) return false;
    const bits = audience.map((actor) => reading.audience.indexOf(actor));
    if (bits.some((bit) => bit < 0)) return false;
    const mask = bits.reduce((value, bit) => value | (1 << bit), 0);
    return ref[3] === page[0]
      ? mask === page[1]
      : audience.length === 2 &&
          audience.includes(reading.reader) &&
          (mask & page[2]) === mask;
  } catch {
    return false;
  }
}
