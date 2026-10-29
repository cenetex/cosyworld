import { currentPlaces } from "./helpers/card-place-graph.mjs";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  validateWorld,
  things,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { generateProgram, programFor } from "../v2/card-game/quests.mjs";
import { learnFact } from "../v2/card-game/knowledge.mjs";
import {
  packDefinitions,
  packDefinition,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  situationProblems,
  SITUATION_KINDS,
} from "../v2/card-game/pack-situation-schema.mjs";
import compiled from "../v2/card-game/packs.json" with { type: "json" };

const mounted = compiled.packs.flatMap((p) => Object.keys(p.places));
const AUTHORED = [
  "willows",
  "badger-forest",
  "hoppycat-archive",
  "lonely-forest",
];

// A continuing world whose authored opening is done, so new purposes generate.
function visit(place, packId, { life = true } = {}) {
  const old = createWorld();
  old.schema = 2;
  old.turn = old.revision = 20;
  for (const id of ["vale", "moth", "keeper"])
    old.actors[id].progress = {
      program: 2,
      step: 0,
      marks: Array.from({ length: id === "vale" ? 5 : 4 }, (_, i) => i + 1),
    };
  let s = decodeSave(JSON.stringify(old));
  if (life) s = enableMotives(s, { personalQuests: true });
  s.actors.vale.place = place;
  for (const c of packDefinition(packId).crossings || [])
    s.crossings[c.id].discovered = true;
  const met = s.packs[packId].met;
  if (met)
    for (const id of Object.keys(packDefinition(packId).avatars)) met[id] = 1;
  return s;
}
const generate = (s, actor = "vale") =>
  generateProgram(s, actor, currentPlaces(s), things);
const fromPack = (p, packId) =>
  p.steps
    .flatMap((step) => step.any || [step])
    .some((h) => packDefinition(packId).places[h.location]);
const withTemplate = (packId, template, fn) => {
  const pack = packDefinition(packId);
  const saved = pack.situations;
  pack.situations = [template];
  try {
    return fn();
  } finally {
    pack.situations = saved;
  }
};

describe("pack situations", () => {
  it("authors validated situations for every pack that had none", () => {
    for (const id of AUTHORED) {
      const pack = compiled.packs.find((p) => p.id === id);
      expect(pack.situations.length, id).toBeGreaterThanOrEqual(2);
      expect(pack.situations.length, id).toBeLessThanOrEqual(4);
      expect(packProblems(pack, compiled.hub, mounted)).toEqual([]);
      for (const t of pack.situations) {
        expect(SITUATION_KINDS).toContain(t.kind);
        expect(t.purpose.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it("fails closed on unknown references and shapes", () => {
    const pack = structuredClone(
      compiled.packs.find((p) => p.id === "willows"),
    );
    const good = pack.situations[0];
    const bad = (change) => {
      const t = structuredClone(good);
      change(t);
      return situationProblems({ ...pack, situations: [t] }, compiled.hub);
    };
    expect(situationProblems(pack, compiled.hub)).toEqual([]);
    expect(bad((t) => (t.kind = "heist"))).not.toEqual([]);
    expect(bad((t) => (t.steps[1].hold = ["willows-anchor"]))).not.toEqual([]);
    expect(bad((t) => (t.steps[1].at = "greek-gate"))).not.toEqual([]);
    expect(bad((t) => (t.steps[0].with = ["$stranger"]))).not.toEqual([]);
    expect(
      bad((t) => (t.steps[0].conditions = [{ kind: "knows", topic: "nope" }])),
    ).not.toEqual([]);
    expect(
      bad(
        (t) => (t.steps[0].conditions = [{ kind: "lit", item: "willows-pot" }]),
      ),
    ).not.toEqual([]);
    expect(bad((t) => (t.consequence = { kind: "anchor" }))).not.toEqual([]);
    expect(bad((t) => (t.takers = ["everyone"]))).not.toEqual([]);
    expect(bad((t) => delete t.roles.partner)).not.toEqual([]);
    expect(bad((t) => (t.roles.food = { item: ["no-such-item"] }))).not.toEqual(
      [],
    );
    expect(bad((t) => (t.extra = true))).not.toEqual([]);
    expect(bad((t) => delete t.steps[0].at)).not.toEqual([]);
    // A feasibility rule uses the pack's own condition vocabulary.
    expect(
      bad(
        (t) =>
          (t.requires = [{ kind: "flag", key: "never-written", value: true }]),
      ),
    ).toEqual([]);
    expect(
      packProblems(
        {
          ...pack,
          situations: [
            {
              ...structuredClone(good),
              requires: [{ kind: "flag", key: "never-written", value: true }],
            },
          ],
        },
        compiled.hub,
        mounted,
      ).some((p) => p.includes("unwritten flag")),
    ).toBe(true);
  });

  it("gives a visitor a pack situation with a middle, deterministically", () => {
    const s = visit("willows-camp", "willows");
    const before = encodeSave(s);
    const p = generate(s);
    expect(generate(s)).toEqual(p);
    expect(encodeSave(s)).toBe(before);
    expect(fromPack(p, "willows")).toBe(true);
    expect(p.generated.partner).toBe("willows-swede");
    expect(["delivery", "crossing", "answer"]).toContain(p.generated.situation);
    // The first step is a conversation: the Swede must tell the visitor.
    expect(p.steps[0].conditions?.[0]).toMatchObject({ kind: "knows" });
    expect(p.steps.at(-1).consequence).toEqual({
      kind: "trust",
      avatar: "willows-swede",
    });
  });

  it("uses hub items carried into a pack and drops infeasible alternatives", () => {
    const s = visit("clearing", "badger-forest");
    s.items.bell.holder = "vale";
    s.items.cloth.holder = "vale";
    s.items.lamp.holder = "station";
    const p = generate(s);
    expect(p.generated.situation).toBe("answer");
    expect(p.name).toBe("Moss without bells");
    expect(p.steps[1]).toMatchObject({
      items: ["bell"],
      location: "clearing",
      avatars: ["badger"],
      conditions: [{ kind: "covered", item: "bell" }],
    });
    // Without the cloth the bell cannot be muffled; the lamp then serves.
    s.items.cloth.holder = "station";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 2;
    const q = generate(s);
    expect(q.name).toBe("A warm light on the moss");
  });

  it("checks pack feasibility rules and the people nearby", () => {
    const s = visit("forest-garden", "lonely-forest");
    const watch = packDefinition("lonely-forest").situations.find(
      (t) => t.id === "forest-watch-light",
    );
    withTemplate("lonely-forest", watch, () => {
      expect(generate(s).name).not.toBe(watch.name);
      s.packs["lonely-forest"].flags["forest-path-cleared"] = true;
      const bellOnly = generate(s);
      expect(bellOnly.name).toBe(watch.name);
      // The lamp is out of reach, so only the Watch Bell answers the watch.
      expect(bellOnly.steps[1]).toEqual({
        items: ["forest-watch-bell"],
        location: "forest-trail",
        avatars: ["skull"],
        consequence: { kind: "trust", avatar: "skull" },
      });
      s.items.lamp.holder = "vale";
      s.items.lamp.fuel = 2;
      expect(generate(s).steps[1].any).toHaveLength(2);
      // A closed path removes the purpose again.
      s.packs["lonely-forest"].flags["forest-path-cleared"] = false;
      expect(generate(s).name).not.toBe(watch.name);
    });
  });

  it("offers Talk middles only to avatars whose quiet spells refresh purposes", () => {
    const s = visit("willows-camp", "willows", { life: false });
    s.items.bell.holder = s.items.cloth.holder = "vale";
    s.actors.vale.progress.recentKinds = ["answer", "crossing"];
    const p = generate(s);
    const hands = p.steps.flatMap((step) => step.any || [step]);
    expect(
      hands.some((h) => (h.conditions || []).some((c) => c.kind === "knows")),
    ).toBe(false);
    s.actors.vale.progress.recentKinds = [];
    expect(generate(s).name).toBe("No bells among the willows");
  });

  it("keeps saved programs unchanged when templates change or vanish", () => {
    const s = visit("hoppycat-halfway-tea-garden", "hoppycat-archive");
    s.actors.vale.progress.current = generate(s);
    const program = structuredClone(s.actors.vale.progress.current);
    expect(fromPack(program, "hoppycat-archive")).toBe(true);
    const save = encodeSave(s);
    const pack = packDefinition("hoppycat-archive");
    const saved = pack.situations;
    pack.situations = [];
    try {
      const loaded = decodeSave(save);
      validateWorld(loaded);
      expect(loaded.actors.vale.progress.current).toEqual(program);
      expect(programFor(loaded, "vale")).toEqual(program);
    } finally {
      pack.situations = saved;
    }
  });

  it("loads an earlier save with a hub program unchanged", () => {
    const s = visit("station", "willows");
    s.items.bell.holder = "vale";
    s.actors.vale.progress.current = generate(s);
    const old = structuredClone(s.actors.vale.progress.current);
    expect(fromPack(old, "willows")).toBe(false);
    const loaded = decodeSave(encodeSave(s));
    expect(loaded.actors.vale.progress.current).toEqual(old);
    // A hub resident is never sent into a pack by a pack template.
    for (const actor of ["moth", "keeper"]) {
      s.actors[actor].place = "station";
      const p = generate(s, actor);
      for (const id of AUTHORED) expect(fromPack(p, id)).toBe(false);
    }
  });

  it("lets a template name its takers and choose items by role", () => {
    const s = visit("willows-camp", "willows");
    const template = {
      ...structuredClone(
        packDefinition("willows").situations.find(
          (t) => t.id === "willows-supper",
        ),
      ),
      takers: ["willows-swede"],
    };
    withTemplate("willows", template, () => {
      for (const p of [generate(s)]) expect(p.name).not.toBe(template.name);
    });
    template.takers = ["visitors"];
    // Other kinds are recent, so the delivery is the fresh purpose.
    s.actors.vale.progress.recentKinds = ["answer", "crossing"];
    withTemplate("willows", template, () => {
      const p = generate(s);
      expect(p.name).toBe(template.name);
      expect(p.steps[1].items).toEqual(["willows-pot", "willows-provisions"]);
      // Food in an unmet stranger's keeping is out of reach.
      s.items["willows-provisions"].holder = "greek-guard";
      expect(generate(s).steps[1].items).toEqual([
        "willows-pot",
        "willows-spoon",
      ]);
      // A gift already made leaves nothing to change.
      s.items["willows-pot"].holder = "willows-swede";
      expect(generate(s).name).not.toBe(template.name);
    });
  });
});
