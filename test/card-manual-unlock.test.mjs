import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import { createLockedBoxes } from "../v2/card-game/locked-box.mjs";
import { createPackOpening } from "../v2/card-game/pack-opening.mjs";

const source = readFileSync(new URL("../v2/card-game/app.mjs", import.meta.url), "utf8");
const body = (name) => {
  const at = source.indexOf(`function ${name}(`);
  return source.slice(at, source.indexOf("\n}", at) + 2);
};
const storageAt = source.indexOf('window.addEventListener("storage", (event) => {');
const storageBranch = source.slice(storageAt, source.indexOf("  if (sharedSession", storageAt));
function view(saved = new Map(), shared = false) {
  const locked = new Set(["field"]);
  const state = {
    world: { run: { seed: 7 }, actor: "vale", turn: 4, revision: 4, xp: 8 },
    SEEN_KEY: "seen", lockRevision: 0, lockedScope: JSON.stringify([7, "vale"]), lockedBoxes: createLockedBoxes(),
    coveredCards: new Set(["plain"]), encountered: new Set(), stageReveals: new Set(),
    people: {}, things: { plain: {} }, places: { field: {} },
    selected: ["field"], available: ["field", "plain"], blocked: false,
    localStorage: { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) },
    availableCards: () => state.available, isLockedBox: (_, id) => locked.has(id),
    lockScope: () => JSON.stringify([state.world.run.seed, state.world.actor]),
    pendingLock: (id) => state.lockedBoxes.boxed(id) || locked.has(id),
    cardIsCovered: (id) => state.coveredCards.has(id) || state.lockedBoxes.boxed(id),
    selectionBlocked: () => state.blocked, opening: () => null,
    openingHeld: false, sharedSession: shared ? {} : null, syncSharedLine() {},
    render() {}, nameOf: (id) => id, $: () => ({ querySelector: () => null }),
    performance: { now: () => 100 }, imageUrl: (url) => url, LOCKED_BACK: "locked.webp",
    accountStorageKey: (key) => key,
    window: { addEventListener: (_, fn) => { state.storage = fn; } },
  };
  vm.createContext(state);
  vm.runInContext(["loadPendingLocks", "observeLocks", "rememberCards", "uncover", "unlockBox"].map(body).join("\n") + `\n${storageBranch}});`, state);
  return { state, locked, saved };
}
for (const shared of [false, true]) {
  it(`requires an explicit available Unlock without changing the world (shared=${shared})`, () => {
    const { state: s, locked, saved } = view(new Map(), shared);
    const before = JSON.stringify(s.world);
    s.observeLocks(); s.rememberCards();
    s.uncover("field");
    expect(s.lockedBoxes.boxed("field")).toBe(true);
    s.unlockBox("field");
    expect(s.lockedBoxes.boxed("field")).toBe(true);
    locked.clear();
    s.observeLocks(); s.uncover("field", { flip: false, batch: true });
    expect(s.lockedBoxes.boxed("field")).toBe(true);
    s.available = ["plain"]; s.unlockBox("field");
    expect(s.lockedBoxes.boxed("field")).toBe(true);
    s.available.push("field"); s.blocked = true; s.unlockBox("field");
    expect(s.lockedBoxes.boxed("field")).toBe(true);
    s.blocked = false;
    const reloaded = view(saved, shared);
    reloaded.locked.clear(); reloaded.state.loadPendingLocks();
    expect(reloaded.state.lockedBoxes.boxed("field")).toBe(true);
    s.unlockBox("field");
    expect(s.lockedBoxes.boxed("field")).toBe(false);
    expect(s.coveredCards.has("field")).toBe(false);
    expect(s.stageReveals.has("field")).toBe(true);
    expect(JSON.stringify(s.world)).toBe(before);
    reloaded.state.loadPendingLocks();
    expect(reloaded.state.lockedBoxes.boxed("field")).toBe(false);
  });
}
it("scopes pending boxes to the run and avatar and preserves open legacy cards", () => {
  const { state: s, locked } = view();
  locked.clear(); s.loadPendingLocks(); s.observeLocks();
  expect(s.lockedBoxes.ids()).toEqual([]);
  locked.add("field"); s.observeLocks(); s.rememberCards(); locked.clear();
  s.world.actor = "mara"; s.loadPendingLocks();
  expect(s.lockedBoxes.ids()).toEqual([]);
  s.world.actor = "vale"; s.loadPendingLocks();
  expect(s.lockedBoxes.ids()).toEqual(["field"]);
  s.world.run.seed++; s.loadPendingLocks();
  expect(s.lockedBoxes.ids()).toEqual([]);
  s.world.run.seed--; s.loadPendingLocks(true); s.rememberCards();
  expect(s.lockedBoxes.ids()).toEqual([]);
});
it("receives another tab's explicit unlock without revealing ordinary covered cards", () => {
  const { state: s, locked, saved } = view();
  s.observeLocks(); s.coveredCards.add("field"); locked.clear();
  const record = JSON.stringify({ scope: s.lockScope(), revision: 4, ids: [] });
  saved.set("seen.locked", record);
  s.storage({ key: "seen.locked", newValue: record });
  expect(s.lockedBoxes.boxed("field")).toBe(false);
  expect(s.coveredCards.has("field")).toBe(false);
  expect(s.coveredCards.has("plain")).toBe(true);
  s.lockedBoxes.observe(["field"]);
  s.storage({ key: "seen.locked", newValue: JSON.stringify({ scope: "another run", ids: [] }) });
  expect(s.lockedBoxes.boxed("field")).toBe(true);
});
it("does not restore an unlocked lid from an older shared snapshot or storage record", () => {
  const { state: s, locked, saved } = view(new Map(), true);
  s.observeLocks(); s.rememberCards();
  const record = JSON.stringify({ scope: s.lockScope(), revision: 5, ids: [] });
  saved.set("seen.locked", record);
  s.storage({ key: "seen.locked", newValue: record });
  s.observeLocks(); s.rememberCards();
  expect(s.lockedBoxes.ids()).toEqual([]);
  expect(JSON.parse(saved.get("seen.locked"))).toEqual(JSON.parse(record));
  s.world.revision = 5; locked.clear(); s.observeLocks();
  expect(s.lockedBoxes.ids()).toEqual([]);
  const stale = JSON.stringify({ scope: s.lockScope(), revision: 4, ids: ["field"] });
  saved.set("seen.locked", stale);
  s.storage({ key: "seen.locked", newValue: stale }); s.rememberCards();
  expect(JSON.parse(saved.get("seen.locked"))).toEqual(JSON.parse(record));
  s.world.revision = 6; locked.add("field"); s.observeLocks(); s.rememberCards();
  expect(s.lockedBoxes.ids()).toEqual(["field"]);
  expect(JSON.parse(saved.get("seen.locked")).revision).toBe(6);
});
it("excludes pending lids from Reveal all and its skip path", () => {
  const { state: s, locked } = view();
  s.observeLocks(); locked.clear();
  for (const id of ["plain", "second", "third"]) s.coveredCards.add(id);
  const declaration = source.match(/^const canRevealCard = .+;$/mu)[0];
  const unturned = vm.runInContext(`${declaration} canRevealCard;`, s);
  const pack = createPackOpening({ reduced: () => true });
  pack.sync(["field", "plain", "second", "third"], { unturned, kindOf: () => "item" });
  expect(pack.ids).toEqual(["plain", "second", "third"]);
  pack.open();
  const turn = (id) => s.uncover(id, { batch: true });
  pack.revealAll({ unturned, tierOf: () => "common", turn, done() {} });
  pack.skip({ unturned, turnNow: turn });
  expect(s.lockedBoxes.boxed("field")).toBe(true);
  expect(s.coveredCards.size).toBe(0);
});
it("repairs malformed browser lock storage while preserving discovery writes", () => {
  const { state: s, saved } = view(new Map([["seen.locked", "broken"]]));
  s.loadPendingLocks(); s.observeLocks(); s.rememberCards();
  expect(JSON.parse(saved.get("seen.locked")).ids).toEqual(["field"]);
  expect(JSON.parse(saved.get("seen.covered"))).toEqual(["plain"]);
});
