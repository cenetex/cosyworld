import { describe, expect, it, vi } from "vitest";

// The server hosts the shared rules bundle with content from the host; the
// browser runs the same modules directly. Through a whole item cycle (the
// set give, a spending voyage with the cargo on deck, regrowth, the dawn safeguard, a kit scatter
// and a sealed gate's quest) both must commit the same world, step by step.
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const { sealedGardenFixture } = await import(
    "./helpers/item-cycle-fixture.mjs"
  );
  return { default: sealedGardenFixture((await importOriginal()).default) };
});

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { sharedContentInput } from "../v2/scripts/shared-content-input.mjs";
import { sealedGardenFixture } from "./helpers/item-cycle-fixture.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
async function hosted() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["v2/card-game/shared-world-entry.mjs"],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "iife",
    target: "es2022",
    legalComments: "none",
    plugins: [sharedContentInput(root)],
  });
  const content = JSON.parse(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const packs = "v2/card-game/packs.json";
  content.files[packs] = sealedGardenFixture(content.files[packs]);
  const runtime = vm.createContext({ structuredClone, cardContent: content });
  vm.runInContext(result.outputFiles[0].text, runtime);
  return (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
}

const players = ["vale", "mara"];
function start() {
  let s = enableMotives(createWorld({ seed: 7 }));
  s.actors.vale.place = "greek-courtyard";
  s.crossings["pond-greek-harbor"].discovered = true;
  for (const id of ["lamp", "cloth"]) s.items[id].holder = "pond";
  s.items["greek-water-jar"].holder = "vale";
  const jar = legalActions(s).find(
    (a) => a.kind === "give" && a.target === "greek-baker",
  );
  s = play(s, jar).state;
  s.actors.vale.place = "greek-harbor";
  for (const id of ["greek-bread", "greek-test-figs", "greek-test-wine"])
    s.items[id].holder = "vale";

  return decodeSave(encodeSave(s));
}

describe("rules 95 item cycle on the server", () => {
  it("commits the same worlds as the browser rules", async () => {
    const server = await hosted();
    const both = (request) => {
      const local = dispatchShared(structuredClone(request));
      const remote = server(structuredClone(request));
      expect(remote.error).toBeUndefined();
      expect(JSON.parse(JSON.stringify(local.world))).toEqual(remote.world);
      return remote;
    };
    let world = both({ op: "create", save: encodeSave(start()) }).world;
    world.actors.mara.place = "greek-harbor";
    const ask = (actor, op, extra = {}) =>
      both({
        world,
        actor,
        op,
        claimed: players,
        present: players,
        ...extra,
      });
    const doing = (actor, kind, test = () => true, present = players) => {
      const action = ask(actor, "view").actions.find(
        (a) => a.kind === kind && test(a),
      );
      expect(action, `${actor} ${kind}`).toBeDefined();
      world = both({
        world,
        actor,
        op: "play",
        action,
        claimed: players,
        present,
      }).world;
    };
    // The City Gate is guarded (rules 102), so the sealed card is the
    // garden's way to the trail.
    world.actors.mara.place = "forest-garden";
    // The box's quest is held by the play that finds mara there (rules 134).
    doing("mara", "wait");
    expect(world.actors.mara.want.step).toEqual({
      verb: "give",
      to: "oak",
    });
    world.actors.mara.place = "greek-harbor";
    doing("vale", "give", (a) => a.target === "greek-shipmaster");
    expect(world.items["greek-provisions"].holder).toBe("greek-harbor");
    doing("vale", "take", (a) => a.item === "greek-provisions");
    doing("vale", "move", (a) => a.target === "greek-ship");
    // The lane opens on the provisions lying on deck (rules 102).
    doing("vale", "drop", (a) => a.item === "greek-provisions");
    doing("vale", "course", (a) => a.target === "greek-piraeus");
    doing("vale", "wait");
    // The test's lane still spends the cargo lying on deck.
    expect(world.usedUp).toContain("greek-provisions");
    // Mara holds the figs and leaves; at dawn they go home.
    world.turn = DAYLIGHT_TURNS * 2 - 1;
    world.revision = Math.max(world.revision, world.turn);
    world.items["greek-test-figs"].holder = "mara";
    world.usedUp = world.usedUp.filter((id) => id !== "greek-test-figs");
    doing("vale", "wait", () => true, ["vale"]);
    expect(world.items["greek-bread"].holder).toBe("greek-courtyard");
    expect(world.items["greek-test-figs"].holder).toBe("greek-sanctuary");
    expect(world.scatters).toEqual({ "greek-test-kit": 1 });
  });
});
