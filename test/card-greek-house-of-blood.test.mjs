import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  entityActive,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import { questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import { knownActors } from "../v2/card-game/quests.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  releasedCardEngine,
  currentCardEngine,
} from "./helpers/released-card-engine.mjs";
import { expectedEpicGreekEntry } from "./helpers/greek-released-contract.mjs";
import {
  HOUSE_PARTS,
  houseState,
  houseStart,
  housePrepared,
  houseEnded,
  houseAccount,
  houseJourney,
  houseChoice,
  housePlay,
  houseGo,
} from "./helpers/greek-house-of-blood.mjs";

const pack = packDefinition("greek-drama");
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const ledger = read("../v2/content/greek-drama/HOUSE-OF-BLOOD-IDS.json");
const reload = (world) => decodeSave(encodeSave(world));
const story = (world, part, beat) =>
  questRecord(world, `greek-drama:story-quest-greek-v-${part}-${beat}`);
const offered = (world, id) =>
  legalActions(world).some((a) => a.choiceId === `greek-v-${id}`);

describe("House of Blood source and journeys", () => {
  it("keeps the released source choices and all 56 old verses exact", () => {
    const old = releasedCardEngine().packs.find((p) => p.id === "greek-drama");
    expect(old.recital.verses).toHaveLength(56);
    expect(pack.recital.verses.slice(0, 56)).toEqual(old.recital.verses);
    for (const choice of old.choices)
      expect(pack.choices.find((c) => c.id === choice.id)).toEqual(
        expectedEpicGreekEntry("choices", choice),
      );
    for (const kind of [
      "places",
      "avatars",
      "items",
      "choices",
      "topics",
      "storyQuests",
    ]) {
      const ids = Array.isArray(pack[kind])
        ? pack[kind].map((x) => x.key || x.id)
        : Object.keys(pack[kind]);
      expect(ids.length).toBeGreaterThanOrEqual(ledger.totals[kind]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ledger.added[kind]) expect(ids).toContain(id);
    }
    expect(
      pack.recital.verses.filter((verse) =>
        verse.choice.startsWith("greek-v-"),
      ),
    ).toHaveLength(ledger.totals.verses - old.recital.verses.length);
  });

  it.each(
    Object.entries(HOUSE_PARTS).flatMap(([part, spec]) =>
      spec.endings.map((ending) => [part, ending]),
    ),
  )(
    "carries the %s / %s record through its own ending and Dione return",
    (part, ending) => {
      const world = houseJourney(part, ending),
        spec = HOUSE_PARTS[part];
      expect(world.actors.vale.place).toBe("greek-courtyard");
      expect(world.items[spec.record].holder).toBe("greek-courtyard");
      expect(houseState(world).choices[`greek-v-${part}-ending`]).toBe(ending);
      expect(houseState(world).choices[`greek-v-${part}-return`]).toBe(ending);
      expect(
        knowsFact(world, "vale", `greek-v-${part}-account-${ending}`),
      ).toBe(true);
      for (const beat of spec.beats)
        expect(story(world, part, beat).completion).toMatchObject({
          actorId: "vale",
          participants: ["vale"],
        });
      const verses = recitalPoem(world, pack).stanzas.filter((v) =>
        v.id.startsWith(`greek-v-${part}-`),
      );
      expect(verses).toHaveLength(part === "tauris" ? 5 : 4);
      expect(reload(world)).toEqual(world);
      expect(offered(world, `${part}-return-${ending}`)).toBe(false);
    },
    30000,
  );

  it("requires the witness's agreed arrival and actual carried record", () => {
    const before = housePrepared("agamemnon");
    const absent = houseGo(before, "greek-argos-refuge");
    expect(offered(absent, "agamemnon-refuge")).toBe(false);
    expect(story(absent, "agamemnon", "voices").completedTurn).toBeNull();
    const agreement = houseChoice(before, "agamemnon-agree-refuge");
    const stillAbsent = houseGo(agreement, "greek-argos-refuge");
    expect(offered(stillAbsent, "agamemnon-refuge")).toBe(false);
    expect(stillAbsent.actors["greek-argos-housekeeper"].place).toBe(
      "greek-argos-palace",
    );
    const missing = housePlay(before, "drop", {
      item: "greek-argos-household-record",
      target: "greek-argos-palace",
    });
    expect(offered(missing, "agamemnon-daughter-first")).toBe(false);
    const forged = {
      actor: "vale",
      kind: "choose",
      choiceId: "greek-v-agamemnon-daughter-first",
      target: "greek-clytemnestra-aeschylus",
    };
    expect(play(missing, forged, missing.revision).ok).toBe(false);
    expect(
      houseState(reload(missing)).choices["greek-v-agamemnon-ending"],
    ).toBeUndefined();
  });

  it("keeps Tauris signatures separate from the source and keeper endings", () => {
    const before = housePrepared("tauris");
    expect(offered(before, "tauris-source")).toBe(true);
    expect(offered(before, "tauris-pact")).toBe(false);
    expect(offered(before, "tauris-keeper")).toBe(false);
    const pact = houseEnded("tauris", "pact");
    expect(
      houseState(pact).flags["greek-v-tauris-assent-iphigenia-done"],
    ).toBeUndefined();
    const keeper = houseEnded("tauris", "keeper");
    expect(
      houseState(keeper).flags["greek-v-tauris-assent-iphigenia-done"],
    ).toBe(true);
    expect(keeper.actors["greek-iphigenia-tauris"].place).toBe("greek-tauris");
  });
});

function sharedHarness(original) {
  const created = dispatchShared({ op: "create", save: encodeSave(original) });
  expect(created.ok, created.error).toBe(true);
  let world = created.world;
  const claimed = ["vale", "mara"];
  const request = (op, actor, fields = {}) => {
    const result = dispatchShared({
      op,
      world,
      actor,
      claimed,
      present: claimed,
      ...fields,
    });
    expect(result.ok, result.error).toBe(true);
    if (op !== "view") world = result.world;
    return result;
  };
  const act = (actor, kind, fields = {}) => {
    const action = request("view", actor).actions.find(
      (a) =>
        a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeTruthy();
    return request("play", actor, { action });
  };
  return {
    get world() {
      return world;
    },
    request,
    act,
  };
}

describe("House of Blood shared evidence", () => {
  it("credits the human who first meets Hermione after the invitation", () => {
    const h = sharedHarness(houseStart());
    h.world.actors.mara.place = "greek-argolid-road";
    expect(story(h.world, "orestes", "water")).toBeFalsy();
    h.act("mara", "move", { target: "greek-argos-refuge" });
    const q = story(h.world, "orestes", "water");
    expect(q.createdTurn).toBe(h.world.turn);
    expect(q.participants).toEqual(["mara"]);
    expect(story(reload(h.world), "orestes", "water")).toEqual(q);
  });

  it("lets the actual second carrier hear and return a record with their own authorship", () => {
    let original = houseEnded("agamemnon", "all-voices");
    original = housePlay(original, "take", {
      item: HOUSE_PARTS.agamemnon.record,
    });
    original = houseGo(original, "greek-argolid-road");
    const h = sharedHarness(original),
      record = HOUSE_PARTS.agamemnon.record;
    h.world.actors.mara.place = "greek-harbor";
    h.act("mara", "move", { target: "greek-argolid-road" });
    h.act("vale", "give", { item: record, target: "mara" });
    expect(
      questHistoryCards(h.world, "mara").some(
        (q) => q.key === "greek-drama:story-quest-greek-v-agamemnon-return",
      ),
    ).toBe(true);
    const topic = "greek-v-agamemnon-account-all-voices";
    expect(knowsFact(h.world, "mara", topic)).toBe(false);
    for (let i = 0; i < 5 && !knowsFact(h.world, "mara", topic); i++) {
      const { context } = h.act("mara", "talk", {
        target: "greek-argos-watchman",
      });
      const fact = context.disclosures[0];
      expect(fact).toBeTruthy();
      h.request("speech", "mara", {
        room: "greek-argolid-road",
        disclosures: context.disclosures,
        lines: [
          { actorId: "mara", text: "Tell me the account for Dione." },
          { actorId: fact.speaker, text: fact.text },
        ],
      });
    }
    expect(knowsFact(h.world, "mara", topic)).toBe(true);
    h.act("mara", "move", { target: "greek-harbor" });
    h.act("mara", "move", { target: "greek-courtyard" });
    h.act("mara", "choose", {
      choiceId: "greek-v-agamemnon-return-all-voices",
    });
    expect(story(h.world, "agamemnon", "return").completion.actorId).toBe(
      "mara",
    );
    expect(h.world.items[record].holder).toBe("greek-courtyard");
    expect(reload(h.world).knowledge).toEqual(h.world.knowledge);
  });

  it("keeps shared actor choices stable when a host reorders JSON maps", () => {
    const h = sharedHarness(houseAccount("agamemnon", "refuge"));
    const changed = structuredClone(h.world);
    changed.actors = Object.fromEntries(
      Object.entries(changed.actors).reverse(),
    );
    expect(knownActors(changed)).toEqual(knownActors(h.world));
    const fields = {
      op: "view",
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    const a = dispatchShared({ ...fields, world: h.world }),
      b = dispatchShared({ ...fields, world: changed });
    expect(a.ok && b.ok).toBe(true);
    expect(a.actions).toEqual(b.actions);
  });
});

describe("House of Blood old saves", () => {
  it.each(
    ["aeschylus", "sophocles", "euripides"].flatMap((a) =>
      ["hearing", "refusal"].map((r) => [a, r]),
    ),
  )(
    "preserves an engine-20 %s %s commitment and tablet",
    (account, response) => {
      const engine = releasedCardEngine();
      let world = engine.dispatch({ op: "create" }).world;
      delete world.opening;
      world.packs["greek-drama"].scope = "full";
      world.actors.vale.place = "greek-argolid-road";
      world.actors["greek-rhapsode"].place = "greek-argolid-road";
      const act = (choiceId) => {
        const request = {
          world,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
        };
        const view = engine.dispatch({ ...request, op: "view" });
        expect(view.ok, view.error).toBe(true);
        const action = view.actions.find((a) => a.choiceId === choiceId);
        expect(action, choiceId).toBeTruthy();
        const result = engine.dispatch({ ...request, op: "play", action });
        expect(result.ok, result.error).toBe(true);
        world = result.world;
      };
      act("greek-atreid-" + account);
      const part = {
          aeschylus: "libation",
          sophocles: "palace-electra",
          euripides: "farm-electra",
        }[account],
        spec = HOUSE_PARTS[part];
      world.actors.vale.place = spec.teller;
      world.items[spec.record].holder = "vale";
      act("greek-hear-electra-" + account);
      act(`greek-atreid-${account}-${response}`);
      const before = structuredClone(world),
        after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"].revision).toBe(pack.revision);
      for (const key of ["choices", "flags", "receipts"])
        expect(houseState(after)[key]).toEqual(houseState(before)[key]);
      expect(after.items[spec.record]).toEqual(before.items[spec.record]);
      expect(after.log).toEqual(before.log);
      for (const id of ledger.added.avatars)
        expect(after.actors[id]).toBeTruthy();
      for (const id of ledger.added.items)
        expect(after.items[id].holder).toBe(pack.items[id].holder);
      expect(entityActive(after, "greek-hermione")).toBe(false);
      expect(reload(after)).toEqual(after);
    },
    30000,
  );
});

describe("House of Blood compiled rules", () => {
  it.each(Object.keys(HOUSE_PARTS))(
    "validates and continues the %s return in the bundled interpreter",
    (part) => {
      const bundle = currentCardEngine();
      const save = encodeSave(houseJourney(part));
      const original = dispatchShared({ op: "create", save });
      const compiled = bundle.dispatch({ op: "create", save });
      expect(original.ok, original.error).toBe(true);
      expect(compiled.ok, compiled.error).toBe(true);
      expect(compiled).toEqual(original);
      const fields = { actor: "vale", claimed: ["vale"], present: ["vale"] };
      const view = dispatchShared({
        op: "view",
        world: original.world,
        ...fields,
      });
      const action = view.actions.find((a) => a.kind === "wait");
      expect(action).toBeTruthy();
      const request = { op: "play", world: original.world, action, ...fields };
      const after = dispatchShared(request);
      const bundledAfter = bundle.dispatch(request);
      expect(after.ok, after.error).toBe(true);
      expect(bundledAfter.ok, bundledAfter.error).toBe(true);
      expect(bundledAfter).toEqual(after);
      expect(
        bundle.poem(
          after.world,
          bundle.packs.find((p) => p.id === "greek-drama"),
        ),
      ).toEqual(recitalPoem(after.world, pack));
    },
    30000,
  );
});
