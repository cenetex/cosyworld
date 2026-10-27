import { syncStoryQuests } from "./story-quests.mjs";
import { publishQuestCompletions } from "./quest-completions.mjs";
import { installSharedQuestRegistry } from "./shared-quests.mjs";
import { newProgress, questPrograms } from "./quests.mjs";
import { migrateMemories, newMemories, rememberEvent } from "./memory.mjs";
import { migrateLife } from "./life.mjs";
import { upgradeRecitals } from "./pack-recital.mjs";
import { isPackActor, packDefinitions, transports } from "./pack-registry.mjs";
import { passengers } from "./pack-transport.mjs";
import { newTemperament } from "./pack-rules.mjs";

// Upgrade historical records before the world validates the current save.
// World-owned helpers keep pack installation and generated quests on the same
// path as a new game, while this module owns the schema order.
export function upgradeSave(
  s,
  { actorIds, ensurePrograms, installPacks, profileOf },
) {
  if (s?.schema === 1 && s.actors && typeof s.actors === "object") {
    s.schema = 2;
    for (const actor of Object.values(s.actors)) {
      if (actor && typeof actor === "object") {
        actor.progress = newProgress();
        delete actor.aim;
      }
    }
  }
  if (s?.schema === 2) {
    for (const [id, actor] of Object.entries(s.actors || {})) {
      if (isPackActor(id)) continue;
      const p = actor?.progress,
        programs = questPrograms[id];
      if (
        !programs ||
        !p ||
        !Number.isInteger(p.program) ||
        p.program < 0 ||
        p.program > programs.length ||
        !Number.isInteger(p.step) ||
        p.step < 0 ||
        (p.program === programs.length
          ? p.step !== 0
          : p.step >= programs[p.program].steps.length)
      )
        throw new Error("This save has an invalid quest step.");
    }
    s.schema = 3;
    ensurePrograms(s);
  }
  if (s?.schema === 3) {
    s.schema = 4;
    if (s.eventSeq === undefined && Array.isArray(s.log)) {
      s.log.forEach((entry, index) => {
        entry.seq = index + 1;
      });
      s.eventSeq = s.log.length;
    }
    if (Array.isArray(s.log)) migrateMemories(s);
  }
  if (s?.schema === 4) {
    s.schema = 5;
    s.standoffs = [];
    s.peaceUntil = Object.fromEntries(actorIds.map((id) => [id, 0]));
  }
  if (s?.schema === 5) {
    s.schema = 6;
    s.locations = { attic: { anchored: false }, pond: { answer: null } };
    for (const [id, actor] of Object.entries(s.actors || {}))
      actor.trust = Object.fromEntries(
        actorIds.filter((other) => other !== id).map((other) => [other, 0]),
      );
    const remembered = { ...s, memories: newMemories() };
    for (const entry of s.log || []) rememberEvent(remembered, entry);
    for (const [id, memory] of Object.entries(s.memories || {}))
      memory.landmarks = remembered.memories[id]?.landmarks || [];
  }
  if (s?.schema === 6) {
    // Schema 7 moved the Steam Clock into the world-pack state.
    upgradeSteamClockSave(s);
    upgradeTransportSave(s);
    upgradeGreekSectionSave(s);
    upgradeGreekHomecomingSave(s);
    s.schema = 7;
    installPacks(s);
  } else if (
    s?.schema === 7 &&
    s.packs &&
    typeof s.packs === "object" &&
    s.crossings &&
    typeof s.crossings === "object"
  ) {
    upgradeTransportSave(s);
    upgradeGreekSectionSave(s);
    upgradeGreekHomecomingSave(s);
    // A pack mounted after this save was written joins it fresh.
    installPacks(s);
  }
  if (s?.schema === 7) {
    upgradeBoardingSave(s);
    upgradeRecitals(s, packDefinitions);
  }
  migrateLife(s, profileOf);
  if (Object.values(s.life?.actors || {}).some((life) => life.collection))
    installSharedQuestRegistry(s);
  if (s?.schema === 7) publishQuestCompletions(s, syncStoryQuests(s));
  return s;
}

// Revision 3 adds these residents and objects. Earlier records keep their
// custody, memories, receipts, and access scope. Only new IDs are installed.
export function upgradeGreekSectionSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 3 || saved?.revision !== 2) return;
  const avatars = [
    "greek-aethra",
    "greek-adrastus",
    "greek-argive-mother",
    "greek-iphis",
    "greek-theseus",
    "greek-quay-host",
    "greek-colonus-keeper",
    "greek-marathon-keeper",
  ];
  const items = [
    "greek-burial-petition",
    "greek-return-cloths",
    "greek-provision-basket",
    "greek-ash-urn",
    "greek-return-list",
    "greek-grove-cup",
    "greek-grove-honey",
    "greek-shelter-blanket",
    "greek-refuge-tablet",
  ];
  addGreekEntities(s, pack, avatars, items);
  saved.revision = 3;
}

// Revision 4 adds Myrine after the earlier Open Door records are restored.
export function upgradeGreekHomecomingSave(s) {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const saved = s.packs?.[pack?.id];
  if (!pack || pack.revision < 4 || saved?.revision !== 3) return;
  addGreekEntities(s, pack, ["greek-household-witness"], []);
  saved.revision = 4;
}

function addGreekEntities(s, pack, avatars, items) {
  const fresh = newMemories();
  if (
    !s.actors ||
    !s.items ||
    !s.memories ||
    !s.peaceUntil ||
    avatars.some(
      (id) =>
        !pack.avatars[id] ||
        s.actors[id] ||
        s.memories[id] ||
        Object.hasOwn(s.peaceUntil, id) ||
        Object.hasOwn(s.motives?.grievances || {}, id),
    ) ||
    items.some((id) => !pack.items[id] || s.items[id] || s.memories[id]) ||
    Object.values(s.actors).some(
      (actor) =>
        !actor.trust || avatars.some((id) => Object.hasOwn(actor.trust, id)),
    )
  )
    throw new Error(
      "This earlier Greek save needs its original entity records.",
    );
  const actorIds = [...Object.keys(s.actors), ...avatars];
  for (const id of avatars) {
    s.actors[id] = {
      place: pack.avatars[id].place,
      progress: newProgress(),
      crossed: 0,
      lastTalk: -9,
      trust: Object.fromEntries(
        actorIds.filter((other) => other !== id).map((other) => [other, 0]),
      ),
      ...newTemperament(id),
    };
    s.peaceUntil[id] = 0;
    s.memories[id] = fresh[id];
    if (s.motives) s.motives.grievances[id] = [];
  }
  for (const id of items) {
    s.items[id] = { holder: pack.items[id].holder, history: [] };
    s.memories[id] = fresh[id];
  }
  for (const [id, actor] of Object.entries(s.actors))
    for (const other of avatars) if (other !== id) actor.trust[other] ??= 0;
}

// Earlier occupied ships used a null dock. Keep their saved destination and
// restore the departure shore so companions can join the same trip.
function upgradeBoardingSave(s) {
  for (const [id, transport] of Object.entries(transports)) {
    const state = s.transports?.[id];
    if (!state || state.version !== undefined) continue;
    const occupied = passengers(s, id).length > 0;
    const valid =
      Object.keys(state).sort().join() === "destination,dock,recall" &&
      (occupied
        ? state.dock === null &&
          transport.docks.includes(state.destination) &&
          (state.recall === null || transport.docks.includes(state.recall))
        : transport.docks.includes(state.dock) &&
          state.destination === null &&
          state.recall === null);
    if (!valid) throw new Error("This save has an invalid ship record.");
    if (occupied)
      state.dock = transport.docks.find((dock) => dock !== state.destination);
    state.version = 2;
  }
}

// Explicit migrations of historical pre-pack records, never runtime gate rules.
export function upgradeTransportSave(s) {
  const pack = s.packs?.["greek-drama"];
  if (pack?.revision !== 1) return;
  const signal = s.crossings?.["pond-greek-harbor"];
  if (
    signal &&
    (!Number.isInteger(signal.phase) || signal.phase < 0 || signal.phase > 4)
  )
    throw new Error("Invalid legacy lamp signal.");
  if (s.transports?.["greek-ship"] !== undefined)
    throw new Error("Conflicting legacy ship record.");
  s.transports ??= {};
  s.transports["greek-ship"] = {
    dock: signal?.phase === 4 ? "pond" : "greek-harbor",
    destination: null,
    recall: null,
  };
  if (s.memories)
    s.memories["greek-ship"] ??= {
      events: [],
      landmarks: [],
      text: null,
      turn: null,
    };
  pack.revision = 2;
}

export function upgradeSteamClockSave(s) {
  const clock = s.steamClock;
  delete s.steamClock;
  s.crossings ??= {};
  s.packs ??= {};
  if (
    clock !== undefined &&
    (!clock || typeof clock !== "object" || Array.isArray(clock))
  )
    throw new Error("Invalid legacy crossing record.");
  if (clock) {
    s.crossings["pond-clearing"] = {
      discovered: clock.discovered,
      phase: clock.rings,
      until: clock.openUntil ?? 0,
    };
    s.crossings["clearing-pond"] = { discovered: false };
    s.packs["badger-forest"] = {
      revision: 1,
      sounds: { "steam-clock": clock.returnRingingUntil ?? 0 },
    };
    if (s.actors?.badger?.wakeCause === "bell")
      s.actors.badger.wakeCause = "sound";
  }
  const old = s.packs["greek-drama"];
  if (old !== undefined) {
    const allowed = ["revision", "choices", "flags", "receipts", "met"],
      current = [...allowed, "sounds", "scope"];
    const keys =
      old && typeof old === "object" ? Object.keys(old).sort().join() : "";
    if (
      keys === current.sort().join() ||
      keys === [...current, "recitals"].sort().join()
    ) {
      if (s.locations?.pond?.shipSignal !== undefined)
        throw new Error("Conflicting legacy lamp signal.");
      return;
    }
    if (
      !old ||
      typeof old !== "object" ||
      Array.isArray(old) ||
      keys !== allowed.sort().join()
    )
      throw new Error("Invalid legacy Greek pack record.");
    old.sounds = {};
    old.scope = "full";
    const phase = s.locations?.pond?.shipSignal ?? 0;
    if (!Number.isInteger(phase) || phase < 0 || phase > 4)
      throw new Error("Invalid legacy lamp signal.");
    const discovered =
      phase === 4 ||
      Object.keys(old.met || {}).length > 0 ||
      String(s.actors?.vale?.place).startsWith("greek-");
    s.crossings["pond-greek-harbor"] = { discovered, phase, until: 0 };
    s.crossings["greek-harbor-pond"] = { discovered: false };
  }
  if (s.locations?.pond) delete s.locations.pond.shipSignal;
}
