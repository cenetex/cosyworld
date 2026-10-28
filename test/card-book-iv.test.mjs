import { readFileSync } from "node:fs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { knowsFact, knowledgeFacts } from "../v2/card-game/knowledge.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { describe, it, expect } from "vitest";
import {
  encodeSave,
  decodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  entityActive,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import {
  andromacheJourney,
  hippolytusJourney,
  medeaJourney,
  helenEnding,
  ionEnding,
  ionRecognitionReady,
  ivWalk,
  ivMove,
  ivPlay,
  ivTalk,
  ivChoose,
  ionJourney,
  helenJourney,
  helenPrepared,
  ivStart,
  ivId,
} from "./helpers/book-iv.mjs";
const pack = packDefinition("greek-drama");
describe("The Faces of Home: Helen", () => {
  it.each(["hearing", "sanctuary", "escape"])(
    "brings the %s account home through actual deeds and published words",
    (route) => {
      const world = helenJourney(route);
      const state = world.packs["greek-drama"];
      expect(state.choices[ivId("helen", "ending")]).toBe(route);
      expect(state.choices[ivId("helen", "return")]).toBe(route);
      expect(world.items[ivId("helen", "account")].holder).toBe(
        "greek-courtyard",
      );
      const stanzas = recitalPoem(world, pack).stanzas.filter((v) =>
        v.id.startsWith(ivId("helen", "")),
      );
      expect(stanzas.map((v) => v.id)).toEqual([
        ivId("helen", "confirm-witness"),
        ivId("helen", "hear-theonoe"),
        ivId("helen", `finish-${route}`),
        ivId("helen", `return-${route}`),
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
      if (route === "escape")
        for (const person of ["greek-helen-egypt", "greek-menelaus-egypt"])
          expect(world.actors[person].place).toBe(ivId("helen", "boat"));
    },
  );
  it("keeps the Trojan body and evidence in its chosen account", () => {
    const world = ivStart("troy");
    expect(entityActive(world, "greek-helen-troy")).toBe(true);
    expect(entityActive(world, "greek-helen-egypt")).toBe(false);
    expect(entityActive(world, ivId("helen", "theonoe"))).toBe(false);
    expect(
      world.packs["greek-drama"].flags[ivId("helen", "done")],
    ).toBeUndefined();
  });
  it("keeps a prepared escape open until the travellers actually arrive", () => {
    const world = helenEnding("escape", { pauseAfterSupplies: true });
    expect(
      world.packs["greek-drama"].flags[ivId("helen", "voyage-prepared")],
    ).toBe(true);
    for (const item of ["cloth", "provisions"])
      expect(world.items[ivId("helen", item)].holder).toBe(
        ivId("helen", "boat"),
      );
    for (const person of ["greek-helen-egypt", "greek-menelaus-egypt"])
      expect(world.actors[person].place).toBe("greek-egypt-tomb");
    expect(
      world.packs["greek-drama"].choices[ivId("helen", "ending")],
    ).toBeUndefined();
    expect(
      legalActions(world).some(
        (a) => a.choiceId === ivId("helen", "finish-escape"),
      ),
    ).toBe(false);
  });
});

describe("The Faces of Home: Andromache", () => {
  it.each(["protection", "departure"])(
    "finishes the %s road with mother, child and Delphic report",
    (route) => {
      const world = andromacheJourney(route),
        id = (slug) => ivId("andromache", slug);
      expect(world.packs["greek-drama"].choices[id("return")]).toBe(route);
      for (const who of ["andromache", "molossus"])
        expect(world.actors[id(who)].place).toBe(
          id(route === "protection" ? "household" : "boundary"),
        );
      expect(world.items[id("account")].holder).toBe("greek-courtyard");
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
});

describe("The Faces of Home: Hippolytus", () => {
  it.each(["hearing", "source"])(
    "carries the %s result after its separate reports",
    (route) => {
      const world = hippolytusJourney(route),
        id = (slug) => ivId("hippolytus", slug);
      expect(world.packs["greek-drama"].choices[id("return")]).toBe(route);
      expect(entityActive(world, id("phaedra"))).toBe(false);
      expect(entityActive(world, id("hippolytus"))).toBe(route === "hearing");
      expect(world.items[id("account")].holder).toBe("greek-courtyard");
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
});

describe("The Faces of Home: Medea", () => {
  it.each(["departure", "source", "reckoning"])(
    "carries the %s account after its actual result",
    (route) => {
      const world = medeaJourney(route),
        id = (slug) => ivId("medea", slug);
      expect(world.packs["greek-drama"].choices[id("return")]).toBe(route);
      expect(world.items[id("account")].holder).toBe("greek-courtyard");
      if (route === "departure")
        for (const who of ["medea", "nurse"])
          expect(world.actors[id(who)].place).toBe(id("quay"));
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
});
describe("The Faces of Home: Ion", () => {
  it.each(["private", "public", "temple"])(
    "returns the %s care excerpt after real recognition",
    (route) => {
      const world = ionJourney(route),
        id = (slug) => ivId("ion", slug);
      expect(world.packs["greek-drama"].choices[id("return")]).toBe(route);
      for (const thing of ["basket", "cloth", "snakes", "wreath"])
        expect(world.items[id(thing)].holder).toBe("greek-delphi");
      expect(world.actors[id("creusa")].place).toBe("greek-delphi");
      expect(world.actors[id("xuthus")].place).toBe(id("guesthouse"));
      expect(world.items[id("account")].holder).toBe("greek-courtyard");
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
});

describe("Book IV saved evidence and audiences", () => {
  it("keeps the full source ID union exact and all released stanzas intact", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../v2/content/greek-drama/book-iv-ids.json", import.meta.url),
      ),
    );
    expect(manifest.counts).toEqual({
      avatars: 23,
      items: 30,
      places: 12,
      choices: 112,
      topics: 64,
      storyQuests: 20,
      verses: 36,
    });
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          "../v2/content/greek-drama/recital-rules20.json",
          import.meta.url,
        ),
      ),
    );
    const old = Array.isArray(frozen) ? frozen : frozen.verses;
    expect(pack.recital.verses.slice(0, old.length)).toEqual(old);
    for (const kind of ["avatars", "items", "places"])
      for (const id of manifest[kind]) expect(pack[kind][id]).toBeTruthy();
  });
  it("requires the real named signs for Ion’s recognition", () => {
    let world = ionRecognitionReady();
    const id = (slug) => ivId("ion", slug);
    world = ivPlay(world, "take", { item: id("snakes") });
    const action = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === id("creusa"),
    );
    const pending = ivPlay(world, "talk", { target: id("creusa") });
    expect(
      narrativeContext(pending, action).disclosures?.some(
        (d) => d.factId === id("recognition-words"),
      ),
    ).toBeFalsy();
    expect(
      pending.packs["greek-drama"].receipts[id("recognition")],
    ).toBeUndefined();
    world = ivPlay(world, "drop", { item: id("snakes") });
    world = ivTalk(world, id("creusa"), id("recognition-words"));
    expect(world.packs["greek-drama"].receipts[id("recognition")]).toBe(
      world.turn,
    );
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("keeps Ion’s private instruction out of Xuthus, Dione and the Bard’s supplied facts", () => {
    let world = ionEnding("private"),
      id = (slug) => ivId("ion", slug);
    expect(knowledgeFacts(world, id("xuthus"))).toEqual([]);
    for (const actor of ["greek-baker", "greek-rhapsode"])
      expect(JSON.stringify(knowledgeFacts(world, actor))).not.toContain(
        "Apollo is Ion’s father",
      );
    expect(JSON.stringify(knowledgeFacts(world, "vale"))).not.toContain(
      "Apollo is Ion’s father",
    );
    world = ivMove(world, id("guesthouse"));
    const action = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === id("xuthus"),
    );
    const result = ivPlay(world, "talk", { target: id("xuthus") });
    const context = narrativeContext(result, action);
    expect(JSON.stringify(context)).not.toContain("Apollo is Ion’s father");
    expect(context.entities.map((e) => e.id)).not.toContain(id("creusa"));
    world = ivChoose(
      ivWalk(result, "greek-courtyard"),
      "ion",
      "return-private",
    );
    const breadAction = legalActions(world).find(
      (a) => a.kind === "talk" && a.target === "greek-baker",
    );
    const bread = ivPlay(world, "talk", { target: "greek-baker" });
    expect(JSON.stringify(narrativeContext(bread, breadAction))).not.toContain(
      "Apollo is Ion’s father",
    );
    const poem = recitalPoem(world, pack).stanzas.filter((v) =>
      v.id.startsWith(ivId("ion", "")),
    );
    expect(poem).toHaveLength(4);
    expect(JSON.stringify(poem)).not.toContain("Apollo");
  });
  it("lets a second carrier learn the signed result through actual shared speech", () => {
    const id = (slug) => ivId("helen", slug);
    let world = dispatchShared({
      op: "create",
      save: encodeSave(helenEnding("hearing")),
    }).world;
    world.actors.mara.place = id("court");
    const claimed = ["vale", "mara"];
    const request = (op, actor, fields = {}) => {
      const r = dispatchShared({
        op,
        world,
        actor,
        claimed,
        present: claimed,
        ...fields,
      });
      expect(r.ok, r.error).toBe(true);
      world = r.world;
      return r;
    };
    const act = (actor, kind, fields = {}) => {
      const action = request("view", actor).actions.find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, JSON.stringify({ actor, kind, fields })).toBeTruthy();
      return request("play", actor, { action });
    };
    act("vale", "give", { item: id("account"), target: "mara" });
    expect(knowsFact(world, "mara", id("finish-hearing-words"))).toBe(false);
    const { context } = act("mara", "talk", { target: id("theoclymenus") });
    expect(context.disclosures[0].factId).toBe(id("finish-hearing-words"));
    request("speech", "mara", {
      room: id("court"),
      disclosures: context.disclosures,
      lines: [
        { actorId: "mara", text: "Please read this signed account." },
        { actorId: id("theoclymenus"), text: context.disclosures[0].text },
      ],
    });
    expect(knowsFact(world, "mara", id("finish-hearing-words"))).toBe(true);
    for (const target of [
      "greek-egypt-tomb",
      id("landing"),
      "greek-ship",
      "greek-harbor",
      "greek-courtyard",
    ]) {
      if (target === "greek-ship")
        for (
          let i = 0;
          i < 32 &&
          !request("view", "mara").actions.some(
            (a) => a.kind === "move" && a.target === target,
          );
          i++
        )
          act("mara", "wait");
      act("mara", "move", { target });
    }
    act("mara", "choose", { choiceId: id("return-hearing") });
    expect(world.items[id("account")].holder).toBe("greek-courtyard");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
});
