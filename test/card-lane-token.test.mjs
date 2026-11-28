import { describe, expect, it, vi } from "vitest";

const TOKEN = {
  kind: "home_item_present",
  home: "co-far-pier",
  place: "co-ship",
};

vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  const { companyPacks } = await import("./helpers/company-world.mjs");
  const [home, away] = structuredClone(companyPacks);
  home.transports["co-ship"].lanes = [
    {
      from: "co-dock",
      to: "co-far-pier",
      oneWay: true,
      opensWith: [
        { kind: "home_item_present", home: "co-far-pier", place: "co-ship" },
      ],
    },
    { from: "co-far-pier", to: "co-dock", oneWay: true },
  ];
  const thing = (name, holder) => ({
    name,
    text: `${name}.`,
    holder,
    persona: `${name}.`,
    art: "assets/co-home/k.png",
  });
  home.items["co-pebble"] = thing("Dock Pebble", "co-dock");
  away.items = { "co-shell": thing("Pier Shell", "co-far-pier") };
  away.items["co-shell"].art = "assets/co-away/k.png";
  return {
    default: { ...real.default, packs: [...real.default.packs, home, away] },
  };
});

const { createWorld, legalActions } = await import(
  "../v2/card-game/world.mjs"
);
const { act, reload } = await import("./helpers/play.mjs");
const { conditionMet } = await import("../v2/card-game/pack-rules.mjs");
const { learnLane } = await import("../v2/card-game/pack-transport.mjs");
const { laneFact } = await import("../v2/card-game/world/lanes.mjs");
const { hub, packDefinition, packDefinitions } = await import(
  "../v2/card-game/pack-registry.mjs"
);
const { packProblems } = await import("../v2/card-game/pack-schema.mjs");

const aboard = () => {
  const s = createWorld({ seed: 5 });
  s.turn = s.revision = 60;
  s.actors.vale.place = "co-ship";
  learnLane(s, "vale", "co-dock", "co-far-pier");
  return s;
};
const courses = (s) =>
  legalActions(s, "vale")
    .filter((a) => a.kind === "course")
    .map((a) => a.target);

describe("a lane opens only while a thing from its port is aboard", () => {
  it("stays shut with no token, even for a traveller who knows it", () => {
    const s = reload(aboard());
    expect(s.transports["co-ship"].dock).toBe("co-dock");
    expect(conditionMet(s, TOKEN)).toBe(false);
    expect(courses(s)).not.toContain("co-far-pier");
  });

  it("stays shut with a thing from elsewhere aboard", () => {
    const s = aboard();
    s.items["co-pebble"].holder = "vale";
    s.items["co-key"].holder = "co-ship";
    expect(courses(reload(s))).not.toContain("co-far-pier");
  });

  it("opens with the token in hand or on deck, and closes when it leaves", () => {
    let s = aboard();
    s.items["co-shell"].holder = "vale";
    s = reload(s);
    expect(conditionMet(s, TOKEN)).toBe(true);
    expect(courses(s)).toEqual(["co-far-pier"]);

    s.items["co-shell"].holder = "co-ship";
    s = reload(s);
    expect(courses(s)).toEqual(["co-far-pier"]);

    s.items["co-shell"].holder = "co-dock";
    s = reload(s);
    expect(conditionMet(s, TOKEN)).toBe(false);
    expect(courses(s)).not.toContain("co-far-pier");

    s.items["co-shell"].holder = "vale";
    s = reload(s);
    act(s, { kind: "course", target: "co-far-pier" });
  });

  it("is told as something from that port", () => {
    expect(laneFact("co-dock", "co-far-pier").text).toBe(
      "Ships for The Far Pier leave from Home Dock only with something from The Far Pier aboard.",
    );
  });

  it("is checked as pack data", () => {
    const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
    const problems = (edit) => {
      const pack = structuredClone(packDefinition("co-home"));
      edit(pack.transports["co-ship"].lanes[0].opensWith[0]);
      return packProblems(pack, hub, mounted).join(" ");
    };
    expect(problems(() => {})).toBe("");
    expect(problems((c) => (c.home = "nowhere-at-all"))).toMatch(/condition/);
    expect(problems((c) => delete c.home)).toMatch(/condition/);
  });
});
