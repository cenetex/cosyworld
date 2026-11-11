import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import {
  encodeSave,
  exits,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { reload } from "./helpers/world-life.mjs";

const charm = "forest-wolfprint-charm",
  cottage = "forest-cottage";
const garden = "forest-garden",
  trail = "forest-trail",
  oak = "forest-oak";
const pack = (world) => world.packs["lonely-forest"];
const endingReceipts = (world) =>
  ["forest-keep-charm", "forest-leave-charm"].map(
    (id) => pack(world).receipts[id],
  );
const fresh = () => createLandingWorld(packDefinition("lonely-forest"), 17);
const seat = { actor: "vale", claimed: ["vale", "mara"], present: ["vale"] };
// serde_json sorts request-world keys before Rust invokes QuickJS.
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
const route = [
  ["talk", "rati"],
  ["talk", "rati"],
  ["move", garden],
  ["wait"],
  ["move", trail],
  ["talk", "skull"],
  ["take", charm],
  ["move", oak],
  ["talk", "oak"],
  ["move", garden],
  ["move", cottage],
];
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/forest-charm-rules-131.json", import.meta.url),
  ),
);

for (const shared of [false, true])
  for (const ending of ["keep", "give"])
    it(`preserves Forest ${ending} through return and reload (shared ${shared})`, () => {
      const engine = shared && currentSharedEngine();
      const view = (world) =>
        shared
          ? dispatchShared({ ...seat, op: "view", world }).actions
          : legalActions(world);
      const step = (world, kind, target, recipient) => {
        const before = structuredClone(world);
        const action = view(world).find(
          (a) =>
            a.kind === kind &&
            !a.sleep &&
            !a.guards &&
            (!target ||
              a[kind === "take" || kind === "give" ? "item" : "target"] ===
                target) &&
            (!recipient || a.target === recipient),
        );
        expect(action, `${kind} ${target}`).toBeTruthy();
        const request = { ...seat, op: "play", world, action };
        const result = shared
          ? dispatchShared(request)
          : play(world, action, world.revision);
        expect(result.ok, result.error).toBe(true);
        if (shared)
          expect(
            JSON.parse(engine.cardShared(JSON.stringify(request))),
          ).toEqual(result);
        expect(world).toEqual(before);
        const next = result.world || result.state;
        validateWorld(structuredClone(next));
        for (const [id, turn] of Object.entries(pack(before).met))
          expect(pack(next).met[id]).toBe(turn);
        const loaded = reload(next);
        expect(view(loaded)).toEqual(view(next));
        return shared ? sorted(loaded) : loaded;
      };
      let world = shared
        ? sorted(
            dispatchShared({
              op: "create",
              seed: 17,
              save: encodeSave(fresh()),
            }).world,
          )
        : fresh();
      let reached = 0;
      for (const command of route) {
        world = step(world, ...command);
        reached++;
      }
      expect(world.turn).toBe(11);
      expect(pack(world).met).toMatchObject({ rati: 1, skull: 5, oak: 8 });
      // Leaving before choosing an ending preserves progress without completing it.
      const retreat = step(world, "move", garden);
      expect(pack(retreat).flags["forest-homecoming-shared"]).toBeUndefined();
      expect(endingReceipts(retreat)).toEqual([undefined, undefined]);
      expect(pack(retreat).receipts).toEqual(pack(world).receipts);
      expect(retreat.items[charm].holder).toBe("vale");
      world =
        ending === "keep"
          ? step(world, "wait")
          : step(world, "give", charm, "rati");
      reached++;
      const receipts = ending === "keep" ? [12, undefined] : [undefined, 12];
      const holder = ending === "keep" ? "vale" : cottage;
      const check = (state) => {
        expect(endingReceipts(state)).toEqual(receipts);
        expect(pack(state).flags["forest-homecoming-shared"]).toBe(true);
        expect(pack(state).met).toMatchObject({ rati: 1, skull: 5, oak: 8 });
      };
      check(world);
      expect(world.items[charm].holder).toBe(holder);
      const unchanged = encodeSave(world);
      view(world);
      view(world);
      expect(encodeSave(world)).toBe(unchanged);
      const stale = shared
        ? dispatchShared({
            ...seat,
            op: "play",
            world,
            action: view(world)[0],
            revision: world.revision - 1,
          })
        : play(world, view(world)[0], world.revision - 1);
      expect(stale.ok).toBe(false);
      expect(encodeSave(world)).toBe(unchanged);
      if (ending === "keep") {
        const gifted = step(world, "give", charm, "rati");
        check(gifted); // The legal offer commits, but RATi declines this gift.
        expect(gifted.items[charm].holder).toBe("vale");
        expect(gifted.log.at(-1).accepted).toBe(false);
      } else {
        const action = { kind: "give", item: charm, target: "rati" };
        const rejected = shared
          ? dispatchShared({ ...seat, op: "play", world, action })
          : play(world, action, world.revision);
        expect(rejected.ok).toBe(false);
        expect(encodeSave(world)).toBe(unchanged);
      }
      for (const target of [garden, cottage, garden, oak]) {
        world = step(world, "move", target);
        reached++;
        check(world);
        expect(world.items[charm].holder).toBe(holder);
        if (target === garden)
          expect(exits(world, garden, "vale")).toContain(trail);
        if (target === cottage) {
          let talked = step(world, "talk", "rati");
          talked = step(talked, "talk", "rati");
          check(talked);
          expect(talked.items[charm].holder).toBe(holder);
        }
      }
      expect(reached).toBe(16);
      expect(exits(world, oak, "vale").includes(trail)).toBe(ending === "keep");
      if (ending === "keep") {
        const gifted = step(world, "give", charm, "oak");
        check(gifted);
        expect(gifted.items[charm].holder).toBe("oak");
        expect(gifted.log.at(-1).accepted).toBe(true);
      }
      if (shared) {
        const before = structuredClone(world);
        const mara = dispatchShared({
          ...seat,
          actor: "mara",
          present: ["vale", "mara"],
          op: "view",
          world,
        });
        expect(mara.room).toBe("theatre"); // Projection, not fabricated travel to the cottage.
        check(mara.world);
        expect(mara.world.items[charm].holder).toBe(holder);
        expect(world).toEqual(before);
      }
    });

it("pins both reviewed rules-131 Forest histories in compiled JS", () => {
  const hash = (path) =>
    createHash("sha256")
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest("hex");
  expect(hash("./fixtures/card-content-rules-131.json")).toBe(
    fixture.contentSha256,
  );
  expect(hash("../v2/orchestrator-rust/src/card_shared/engine-v131.js")).toBe(
    fixture.engineSha256,
  );
  const engine = currentSharedEngine(131);
  for (const [ending, steps] of Object.entries(fixture.branches)) {
    let world = fixture.initial;
    for (const step of steps) {
      const response = JSON.parse(
        engine.cardShared(JSON.stringify({ ...step.request, world })),
      );
      expect(response.ok, response.error).toBe(true);
      expect(response.world).toEqual(step.world);
      world = sorted(response.world);
    }
    expect(steps).toHaveLength(16);
    expect(endingReceipts(world)).toEqual(
      ending === "keep" ? [12, undefined] : [undefined, 12],
    );
    expect(world.items[charm].holder).toBe(
      ending === "keep" ? "vale" : cottage,
    );
  }
});
