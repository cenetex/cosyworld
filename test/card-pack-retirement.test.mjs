import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
  packDefinitions,
  hub,
  validatePackStates,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  hippolytusCare,
  hippolytusEnding,
  medeaEnding,
  ivId,
  ivWalk,
  ivTake,
  ivPlay,
} from "./helpers/book-iv.mjs";

const id = (slug) => ivId("hippolytus", slug),
  P = id("phaedra"),
  N = id("nurse");
const pack = packDefinition("greek-drama");
function deathTalk(world) {
  const action = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === N,
  );
  const result = play(world, action, world.revision);
  expect(result.ok, result.error).toBe(true);
  const context = narrativeContext(result.state, action);
  expect(context.disclosures[0].factId).toBe(id("phaedra-death-words"));
  return { world: result.state, context };
}
function publishDeath(world, finalWords = false) {
  const pending = deathTalk(world);
  return applyGeneratedText(pending.world, pending.context, {
    revision: pending.context.revision,
    model: "retirement-fixture",
    entries: pending.context.entities
      .filter((e) => e.id === N || (finalWords && e.id === P))
      .map((e) => ({
        id: e.id,
        text:
          e.id === N
            ? pending.context.disclosures[0].text
            : "Phaedra speaks her final sickroom words.",
      })),
    omitted: pending.context.entities
      .filter((e) => e.id !== N && !(finalWords && e.id === P))
      .map((e) => e.id),
  });
}
describe("fixed scene retirement", () => {
  it("keeps an earlier ordinary gift recoverable with its nested cloth and saved history", () => {
    let world = hippolytusCare();
    // A valid older save may already have its black cloth around the lamp.
    world.items.cloth.holder = "lamp";
    world = decodeSave(encodeSave(world));
    world = ivWalk(world, "greek-courtyard");
    world = ivTake(world, "lamp");
    world = ivWalk(world, id("sickroom"));
    const staleTalk = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === P,
    );
    const staleGive = legalActions(world).find(
      (a) => a.kind === "give" && a.item === "lamp" && a.target === P,
    );
    expect(staleGive).toBeTruthy();
    world = ivPlay(world, "give", { item: "lamp", target: P });
    const actor = structuredClone(world.actors[P]),
      memory = structuredClone(world.memories[P]);
    const cloth = structuredClone(world.items.cloth),
      lamp = structuredClone(world.items.lamp);
    const known = structuredClone(world.knowledge.known[P]);
    const pending = deathTalk(world);
    expect(entityActive(pending.world, P)).toBe(true);
    expect(pending.world.items.lamp.holder).toBe(P);
    world = publishDeath(world);
    expect(entityActive(world, P)).toBe(false);
    expect(world.actors[P]).toEqual(actor);
    expect(world.memories[P]).toMatchObject({
      text: memory.text,
      turn: memory.turn,
      model: memory.model,
    });
    expect(world.memories[P].events).toEqual(
      expect.arrayContaining(memory.events.slice(-8)),
    );
    expect(world.memories[P].landmarks).toEqual(
      expect.arrayContaining(memory.landmarks.slice(-4)),
    );
    expect(world.knowledge.known[P]).toEqual(known);
    expect(world.items.cloth).toEqual(cloth);
    expect(world.items.lamp).toMatchObject({
      holder: id("sickroom"),
      fuel: lamp.fuel,
      lit: lamp.lit,
    });
    expect(world.items.lamp.history).toEqual(
      [
        ...lamp.history,
        expect.stringContaining("Phaedra’s carried belongings"),
      ].slice(-12),
    );
    expect(play(world, staleTalk, world.revision).ok).toBe(false);
    world = ivTake(world, "lamp");
    expect(play(world, staleGive, world.revision).ok).toBe(false);
    expect(
      play(
        world,
        {
          kind: "accompany",
          actor: "vale",
          target: P,
          destination: "greek-troezen",
        },
        world.revision,
      ).ok,
    ).toBe(false);
    expect(legalActions(world).filter((a) => a.target === P)).toEqual([]);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("accepts an earlier appearance on the report turn and places final words before its witness", () => {
    let world = hippolytusCare();
    // Recreate an imported scene with knowledge already learned and a fresh appearance.
    delete world.packs[pack.id].met[P];
    delete world.opening.met[P];
    world = validateWorld(world);
    const pending = deathTalk(world);
    expect(pending.world.packs[pack.id].met[P]).toBe(pending.world.turn);
    expect(pending.context.speakers.indexOf(P)).toBeLessThan(
      pending.context.speakers.indexOf(N),
    );
    world = publishDeath(world, true);
    expect(world.packs[pack.id].met[P]).toBe(
      world.packs[pack.id].receipts[id("phaedra-death")],
    );
    const spoken = world.log.filter(
      (e) => e.turn === world.turn && e.generated && e.actorId,
    );
    expect(spoken.findIndex((e) => e.actorId === P)).toBeLessThan(
      spoken.findIndex((e) => e.actorId === N),
    );
    expect(world.memories[P].text).toBe(
      "Phaedra speaks her final sickroom words.",
    );
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("checks the positive opening date and keeps the fixed-role saved guards", () => {
    const world = publishDeath(hippolytusCare());
    const opened = world.packs[pack.id].receipts[ivId("invitation", "accept")];
    for (const turn of [opened - 1, world.turn + 1]) {
      const forged = structuredClone(world);
      forged.packs[pack.id].met[P] = turn;
      forged.opening.met[P] = turn;
      if (turn > forged.turn) forged.turn = turn;
      expect(validatePackStates(forged)).toBe(false);
    }
    for (const fields of [
      { place: "greek-troezen" },
      { crossed: 1 },
      { lastTalk: world.turn },
    ]) {
      const forged = structuredClone(world);
      Object.assign(forged.actors[P], fields);
      expect(validatePackStates(forged)).toBe(false);
    }
    const other = structuredClone(world);
    other.actors["greek-helen-troy"].place = "greek-courtyard";
    expect(validatePackStates(other)).toBe(false);
  });
  it.each([
    [
      () => hippolytusEnding("source"),
      "hippolytus",
      "hippolytus",
      "finish-source",
      "messenger",
    ],
    [() => medeaEnding("source"), "medea", "creon", "royal-deaths", "jason"],
  ])(
    "retains each other source report and its own witness",
    (journey, work, role, report, witness) => {
      const world = journey(),
        actor = ivId(work, role),
        choice = ivId(work, report);
      expect(entityActive(world, actor)).toBe(false);
      const turn = world.packs[pack.id].receipts[choice];
      expect(
        world.log.some(
          (e) =>
            e.actorId === ivId(work, witness) && e.generated && e.turn === turn,
        ),
      ).toBe(true);
      expect(
        world.log.some(
          (e) => e.actorId === actor && e.generated && e.turn > turn,
        ),
      ).toBe(false);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
  it("requires a known witness report and a fixed, positively opened role", () => {
    for (const mutate of [
      (p) => (p.avatars[P].retireAfter = "unknown-report"),
      (p) => (p.avatars[P].retireAfter = id("hear-phaedra")),
      (p) => (p.avatars[P].travels = true),
      (p) => (p.avatars[P].personalQuests = true),
      (p) =>
        p.avatars[P].requires.push({
          kind: "flag",
          key: id("phaedra-dead"),
          value: false,
        }),
    ]) {
      const changed = structuredClone(pack);
      mutate(changed);
      expect(
        packProblems(
          changed,
          hub,
          packDefinitions.flatMap((p) => Object.keys(p.places)),
        ).join(" "),
      ).toContain("retirement");
    }
  });
  it("rejects shared speech from a person after their report has committed", () => {
    const world = dispatchShared({
      op: "create",
      save: encodeSave(publishDeath(hippolytusCare())),
    }).world;
    expect(() =>
      dispatchShared({
        op: "speech",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        room: id("sickroom"),
        lines: [
          { actorId: "vale", text: "I heard the report." },
          { actorId: P, text: "I answer after the death report." },
        ],
      }),
    ).toThrow("Each line needs a present speaker");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
});
