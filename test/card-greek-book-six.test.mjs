import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";
import {
  comedyId,
  comedyJourney,
  comedyPack,
  comedyResult,
  comedyRoutes,
  comedyStart,
  comedyState,
  ComedyPlayer,
} from "./helpers/greek-book-six.mjs";

const prefix = "greek-comedy-";
const poem = (world, work) =>
  recitalPoem(world, comedyPack).stanzas.filter((verse) =>
    verse.id.startsWith(comedyId(work, "")),
  );
const offered = (world, id) =>
  legalActions(world).some((action) => action.choiceId === id);

// Let the worker report completed tasks between the synchronous save walks.
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("The City Eats", () => {
  for (const [work, routes] of Object.entries(comedyRoutes)) {
    it.each(routes)(
      `${work}: completes %s and carries the signed result to Dione`,
      (route) => {
        const player = comedyJourney(work, route),
          world = player.world;
        const id = (suffix) => comedyId(work, suffix);
        expect(world.actors.vale.place).toBe("greek-courtyard");
        expect(comedyState(world).choices[id("ending")]).toBe(route);
        expect(comedyState(world).flags[id("returned")]).toBe(true);
        expect(knowsFact(world, "vale", id("signed-account"))).toBe(true);
        const paper = Object.keys(comedyPack.items).find(
          (item) => item.startsWith(id("")) && item.includes("signed-"),
        );
        expect(world.items[paper].holder).toBe("greek-courtyard");
        expect(poem(world, work).map((verse) => verse.id)).toEqual([
          comedyPack.recital.verses.find(
            (verse) => verse.quest === `story-quest-${id("beat-1")}`,
          ).choice,
          comedyPack.recital.verses.find(
            (verse) => verse.quest === `story-quest-${id("beat-2")}`,
          ).choice,
          id(`end-${route}`),
          id("return"),
        ]);
        expect(decodeSave(encodeSave(world))).toEqual(world);
        expect(offered(world, id("return"))).toBe(false);
        expect(world.items[paper].history.at(-1)).toContain("Dione");
        const unaware = structuredClone(player.beforeReturn);
        delete unaware.knowledge.known.vale[id("signed-account")];
        expect(unaware.items[paper].holder).toBe("vale");
        expect(offered(unaware, id("return"))).toBe(false);
      },
      30000,
    );
  }

  it("keeps the exact roster and earlier verse definitions", () => {
    for (const [kind, count] of [
      ["avatars", 47],
      ["items", 58],
      ["places", 16],
    ])
      expect(
        Object.keys(comedyPack[kind]).filter((id) => id.startsWith(prefix)),
      ).toHaveLength(count);
    expect(
      comedyPack.recital.verses.filter((verse) =>
        verse.choice.startsWith(prefix),
      ),
    ).toHaveLength(48);
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          "../v2/content/greek-drama/recital-rules20.json",
          import.meta.url,
        ),
      ),
    );
    for (const verse of frozen.verses)
      expect(
        comedyPack.recital.verses.find(
          (entry) => entry.choice === verse.choice,
        ),
      ).toEqual(verse);
    const earlier = releasedCardEngine(20).packs.find(
      (pack) => pack.id === "greek-drama",
    );
    for (const choice of earlier.choices)
      expect(
        comedyPack.choices.find((entry) => entry.id === choice.id),
      ).toEqual(choice);
    expect(comedyPack.avatars[comedyId("wasps", "labes")].expression).toBe(
      "movement",
    );
    expect(
      comedyPack.avatars[comedyId("wealth", "plutus")].journey.path,
    ).toHaveLength(3);
  });

  it("requires a paper carrier to know the authorised account", () => {
    const player = comedyResult("acharnians", "private");
    player.do("trader-signature", "signed-account");
    const id = (s) => comedyId("acharnians", s),
      paper = id("signed-market-account");
    player.take(paper).walk("greek-courtyard");
    const before = structuredClone(player.world);
    delete before.knowledge.known.vale[id("signed-account")];
    expect(offered(before, id("return"))).toBe(false);
    const action = legalActions(player.world).find(
      (a) => a.choiceId === id("return"),
    );
    expect(play(before, action, before.revision).ok).toBe(false);
    player.step("drop", { item: paper, target: "greek-courtyard" });
    expect(offered(player.world, id("return"))).toBe(false);
    player.take(paper).do("return");
    expect(poem(player.world, "acharnians")).toHaveLength(4);
  }, 30000);

  it("waits for an actual agreed market arrival", () => {
    const player = comedyStart("acharnians"),
      id = (s) => comedyId("acharnians", s);
    player.do(
      "offered-truces",
      "private-terms",
      "set-truce",
      "lost-farm",
      "megarian-household",
      "boeotian-market",
      "lay-boundary",
      "two-suppers-report",
      "pledge-shared",
      "shared-farmer-assent",
      "shared-megarian-assent",
      "shared-boeotian-assent",
      "open-lane",
      "first-exchange",
    );
    expect(offered(player.world, id("end-shared"))).toBe(false);
    expect(comedyState(player.world).flags[id("done")]).toBeUndefined();
    player.escort(id("dercetes"), id("trading-lane")).do("end-shared");
    expect(comedyState(player.world).flags[id("done")]).toBe(true);
  }, 30000);

  it("adds the new civic cast behind its invitation", () => {
    const world = comedyStart("acharnians").world;
    expect(entityActive(world, comedyId("wasps", "labes"))).toBe(true);
    expect(
      entityActive(world, comedyId("wealth", "distribution-granary")),
    ).toBe(true);
    expect(Object.keys(world.actors)).toHaveLength(113);
  });

  it.each(Object.keys(comedyRoutes))(
    "%s: teaches a second human before the paper's shared return",
    (work) => {
      const original = comedyResult(work, comedyRoutes[work][0]);
      if (work === "acharnians") original.do("trader-signature");
      if (work === "lysistrata") original.do("lampito-signature");
      original.do("signed-account");
      const id = (s) => comedyId(work, s);
      const paper = Object.keys(comedyPack.items).find(
        (item) => item.startsWith(id("")) && item.includes("signed-"),
      );
      original.take(paper);
      const shared = dispatchShared({
        op: "create",
        save: encodeSave(original.world),
      });
      expect(shared.ok, shared.error).toBe(true);
      // Start the carrier beside the signer; all custody and later travel are played.
      shared.world.actors.mara.place = shared.world.actors.vale.place;
      const carrier = new ComedyPlayer(shared.world, "mara", true).in(work);
      const give = carrier
        .offered("vale")
        .find(
          (a) => a.kind === "give" && a.item === paper && a.target === "mara",
        );
      expect(give).toBeTruthy();
      carrier.request("play", "vale", { action: give });
      const ending = comedyState(carrier.world).choices[id("ending")];
      const signed = comedyState(carrier.world).receipts[id("signed-account")];
      expect(knowsFact(carrier.world, "mara", id("signed-account"))).toBe(
        false,
      );
      if (work === "thesmophoria") {
        carrier.actor = "vale";
        carrier
          .take(id("the-womens-approved-reply"))
          .walk(carrier.world.actors.mara.place);
        carrier.step("give", {
          item: id("the-womens-approved-reply"),
          target: "mara",
        });
        carrier.actor = "mara";
      }
      carrier.walk("greek-courtyard");
      expect(carrier.offered().some((a) => a.choiceId === id("return"))).toBe(
        false,
      );
      carrier.learn(id("signed-account")).walk("greek-courtyard");
      carrier.step("choose", { choiceId: id("return") });
      expect(carrier.world.items[paper].holder).toBe("greek-courtyard");
      expect(comedyState(carrier.world).choices[id("ending")]).toBe(ending);
      expect(comedyState(carrier.world).receipts[id("signed-account")]).toBe(
        signed,
      );
      expect(knowsFact(carrier.world, "mara", id("signed-account"))).toBe(true);
      expect(comedyState(carrier.world).recitals[id("return")].actor).toBe(
        "mara",
      );
    },
    30000,
  );

  it.each([
    ["acharnians", "shared", "grain-basket"],
    ["wasps", "open", "myrtias-fourteen-obol-compensation-purse"],
    ["clouds", "repayment", "settlement-purse"],
    ["wealth", "share", "workers-wage-purse"],
  ])(
    "%s: checks the delivered %s evidence again before its result",
    (work, route, item) => {
      const original = comedyResult(work, route);
      const player = new ComedyPlayer(original.beforeEnding).in(work);
      const id = (s) => comedyId(work, s),
        object = id(item);
      const ending = legalActions(player.world).find(
        (a) => a.choiceId === id(`end-${route}`),
      );
      expect(ending).toBeTruthy();
      const delivery = player.world.items[object].holder;
      player
        .take(object)
        .walk(comedyPack.choices.find((c) => c.id === ending.choiceId).at);
      expect(offered(player.world, ending.choiceId)).toBe(false);
      expect(play(player.world, ending, player.world.revision).ok).toBe(false);
      player.walk(delivery).step("drop", { item: object, target: delivery });
      player.do(`end-${route}`);
      expect(comedyState(player.world).flags[id("done")]).toBe(true);
    },
    30000,
  );

  it("preserves earlier cast, custody, poem and ship while adding revision 8", () => {
    const context = vm.createContext({});
    vm.runInContext(
      readFileSync(
        new URL(
          "../v2/orchestrator-rust/src/card_shared/engine-v20.js",
          import.meta.url,
        ),
        "utf8",
      ),
      context,
    );
    const before = JSON.parse(
      context.cardShared(JSON.stringify({ op: "create" })),
    ).world;
    delete before.opening;
    before.packs["greek-drama"].scope = "full";
    before.actors.vale.place = "greek-athens";
    before.items.lamp.holder = "vale";
    const after = decodeSave(JSON.stringify(before));
    expect(after.packs["greek-drama"].revision).toBe(8);
    expect(after.items.lamp).toEqual(before.items.lamp);
    expect(after.transports).toEqual(before.transports);
    expect(after.packs["greek-drama"].recitals).toEqual(
      before.packs["greek-drama"].recitals,
    );
    for (const [id, actor] of Object.entries(before.actors)) {
      expect(after.actors[id].place).toBe(actor.place);
      for (const [other, trust] of Object.entries(actor.trust))
        expect(after.actors[id].trust[other]).toBe(trust);
    }
    for (const [id, item] of Object.entries(before.items))
      expect(after.items[id]).toEqual(item);
    expect(entityActive(after, comedyId("wasps", "labes"))).toBe(false);
    expect(decodeSave(encodeSave(after))).toEqual(after);
  });
});
