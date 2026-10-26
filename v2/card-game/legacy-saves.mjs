import { installSharedQuestRegistry } from "./shared-quests.mjs";
import { newProgress, questPrograms } from "./quests.mjs";
import { migrateMemories, newMemories, rememberEvent } from "./memory.mjs";
import { migrateLife } from "./life.mjs";
import { upgradeRecitals } from "./pack-recital.mjs";
import { isPackActor, packDefinitions } from "./pack-registry.mjs";

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
    // A pack mounted after this save was written joins it fresh.
    installPacks(s);
  }
  if (s?.schema === 7) upgradeRecitals(s, packDefinitions);
  migrateLife(s, profileOf);
  if (Object.values(s.life?.actors || {}).some((life) => life.collection))
    installSharedQuestRegistry(s);
  return s;
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
