// The Open Door as five interlocking puzzles (docs/design/open-door-rework.md),
// played from a new world with real plays. Each puzzle is solved two ways and
// each way has its cost: a trust, a trip, a want left open, or a road.
import { beforeAll, describe, expect, it } from "vitest";
import { exits, validateWorld } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import {
  burial,
  holds,
  landRoad,
  satisfied,
  seaRoad,
  traveler,
  whereIs,
} from "./helpers/open-door.mjs";

const valid = (s) => expect(() => validateWorld(s)).not.toThrow();
const urnMade = (s) => !s.usedUp.includes("greek-ash-urn");
const gateOpen = (s) => exits(s, "greek-gate", "vale").includes("greek-battlefield");

// Out of Thebes by land with the cloth and oil, and the petition picked up at
// Eleusis: the start of puzzles 1, 3 and 4.
let atEleusis;
beforeAll(() => {
  const t = landRoad();
  t.move("gate").drop("shovel");
  t.move("battlefield", "cithaeron", "eleusis").take("burial-petition");
  atEleusis = t.s;
});
const fromEleusis = () => traveler(structuredClone(atEleusis));

describe("5. three hands, one loaf: the first crossing", () => {
  it("(a) by land: the loaf buys the decree, the decree the writ, and the gate opens", () => {
    const t = landRoad();
    expect(gateOpen(t.s)).toBe(true);
    expect(t.hands()).toEqual([
      "greek-funeral-cloth",
      "greek-oil-flask",
      "greek-shovel",
    ]);
    // Cost: the loaf went to the guard, so the provisions cannot be packed.
    expect(t.s.usedUp).toContain("greek-bread");
    // The wheat it was baked from went home to the Piraeus quay.
    expect(whereIs(t.s, "greek-wheat")).toBe("greek-piraeus");
    t.move("battlefield", "cithaeron", "eleusis");
    expect(entityActive(t.s, "greek-aethra")).toBe(true);
    valid(t.s);
  });

  it("(b) by sea: the loaf goes into the provisions and the gate stays shut", () => {
    const t = seaRoad();
    expect(t.s.actors.vale.place).toBe("greek-piraeus");
    expect(t.hands()).toEqual(["greek-funeral-cloth", "greek-oil-flask"]);
    // Cost: the guard cannot be fed; the land road waits for a second loaf
    // or the truce.
    expect(t.s.usedUp).toContain("greek-bread");
    expect(gateOpen(t.s)).toBe(false);
    t.move("athens", "eleusis");
    expect(entityActive(t.s, "greek-aethra")).toBe(true);
    valid(t.s);
  });
});

describe("1. the king and the altar", () => {
  it("(a) trades the petition for the truce in the Agora; Aethra still waits", () => {
    const t = fromEleusis();
    t.give("funeral-cloth", "aethra").give("oil-flask", "aethra");
    const start = t.s.turn;
    t.move("road-athens-eleusis", "athens");
    expect(entityActive(t.s, "greek-theseus")).toBe(true);
    t.trade("burial-petition", "theseus", "olive-branch");
    expect(holds(t.s, "theseus", "greek-burial-petition")).toBe(true);
    expect(holds(t.s, "vale", "greek-olive-branch")).toBe(true);
    expect(satisfied(t.s, "theseus")).toBe(true);
    // Cost: Aethra's son never came to the altar.
    t.move("road-athens-eleusis", "eleusis");
    expect(satisfied(t.s, "aethra")).toBe(false);
    expect(t.s.turn - start).toBeLessThanOrEqual(6);
    valid(t.s);
  });

  it("(b) keeps the petition and walks Theseus to the altar: both are met", () => {
    const t = fromEleusis();
    t.give("funeral-cloth", "aethra").give("oil-flask", "aethra");
    t.move("road-athens-eleusis", "athens");
    // The trip serves his want, so he comes without trust.
    expect(t.s.actors["greek-theseus"].trust.vale).toBe(0);
    t.walkWith("theseus", "eleusis");
    expect(t.s.actors["greek-theseus"].place).toBe("greek-eleusis");
    t.trade("burial-petition", "theseus", "olive-branch").act("wait");
    expect(satisfied(t.s, "theseus")).toBe(true);
    expect(satisfied(t.s, "aethra")).toBe(true);
    // Cost: Theseus is away from the Agora and walks home on his own.
    expect(t.s.actors["greek-theseus"].place).not.toBe("greek-athens");
    valid(t.s);
  });
});

describe("2. two dead, one kit", () => {
  it("(a) buries first: the rites send the kit home and open Aethra and the keeper", () => {
    const t = burial(landRoad());
    expect(t.s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(whereIs(t.s, "greek-funeral-cloth")).toBe("greek-eleusis");
    expect(whereIs(t.s, "greek-oil-flask")).toBe("greek-colonus");
    // Nobody carried them there: the two boxes opened by themselves.
    expect(entityActive(t.s, "greek-aethra")).toBe(true);
    expect(entityActive(t.s, "greek-colonus-keeper")).toBe(true);
    // The keeper's want is the oil in his grove; it is met when he is next
    // spoken to. Cost: the whole Theban road first, and the shade's night.
    t.move("battlefield", "cithaeron", "eleusis", "colonus").talk("colonus-keeper");
    expect(satisfied(t.s, "colonus-keeper")).toBe(true);
    valid(t.s);
  });

  it("(b) makes the urn first, then borrows the cloth and oil back for the Hollow", () => {
    const t = fromEleusis();
    t.give("funeral-cloth", "aethra").give("oil-flask", "aethra");
    t.move("road-athens-eleusis", "athens").trade("burial-petition", "theseus", "olive-branch");
    t.move("road-athens-eleusis", "eleusis").give("olive-branch", "aethra");
    expect(urnMade(t.s)).toBe(true);
    // The urn spends the kit and sends it home: cloth to Eleusis, oil to the
    // grove, truce to Dione's table.
    expect(whereIs(t.s, "greek-funeral-cloth")).toBe("greek-eleusis");
    expect(whereIs(t.s, "greek-oil-flask")).toBe("greek-colonus");
    expect(whereIs(t.s, "greek-olive-branch")).toBe("greek-courtyard");
    // Borrow them back. Cost: a walk to the grove and over Cithaeron, and the
    // grove stands empty while the oil is away.
    t.take("funeral-cloth").move("colonus").take("oil-flask");
    t.move("eleusis", "cithaeron", "battlefield", "gate").take("shovel");
    burial(t);
    expect(t.s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(whereIs(t.s, "greek-oil-flask")).toBe("greek-colonus");
    valid(t.s);
  });
});

describe("3. one truce, three hands", () => {
  // By sea, so the guard was never fed and the City Gate is shut.
  const withTruce = () => {
    const t = seaRoad();
    t.move("athens");
    t.move("eleusis").give("funeral-cloth", "aethra").give("oil-flask", "aethra");
    t.take("burial-petition").move("athens");
    t.trade("burial-petition", "theseus", "olive-branch");
    return t.move("eleusis");
  };
  it("(a) urn first: the truce goes home to Dione's table and opens the gate", () => {
    const t = withTruce().give("olive-branch", "aethra");
    expect(urnMade(t.s)).toBe(true);
    expect(whereIs(t.s, "greek-olive-branch")).toBe("greek-courtyard");
    // Home by the free ship, then the truce from the table to the guard.
    t.move("piraeus", "harbor", "courtyard").take("olive-branch");
    t.move("gate").waitFor("guard").give("olive-branch", "guard");
    expect(gateOpen(t.s)).toBe(true);
    // Cost: Adrastus never holds it, and the urn is spent from the guard's
    // side of the story: taking it back shuts the gate again.
    expect(satisfied(t.s, "adrastus")).toBe(false);
    valid(t.s);
  });

  it("(b) Adrastus first: he is met, and the urn must ask it back from him", () => {
    const t = withTruce().give("olive-branch", "adrastus");
    expect(satisfied(t.s, "adrastus")).toBe(true);
    expect(urnMade(t.s)).toBe(false);
    // Cost: a second visit to his hands. Satisfied, he gives it back when
    // asked; he holds it no longer.
    t.act("ask", { target: "greek-adrastus", item: "greek-olive-branch" });
    expect(holds(t.s, "vale", "greek-olive-branch")).toBe(true);
    t.give("olive-branch", "aethra");
    expect(urnMade(t.s)).toBe(true);
    valid(t.s);
  });
});

describe("4. one urn, two mourners", () => {
  const withUrn = () => {
    const t = fromEleusis();
    t.give("funeral-cloth", "aethra").give("oil-flask", "aethra");
    t.move("road-athens-eleusis", "athens").trade("burial-petition", "theseus", "olive-branch");
    t.move("road-athens-eleusis", "eleusis").give("olive-branch", "aethra");
    return t.take("ash-urn");
  };
  it("(a) gives the urn to the Argive Mother: Eleusis settles, Iphis waits", () => {
    const t = withUrn().give("ash-urn", "argive-mother");
    expect(satisfied(t.s, "argive-mother")).toBe(true);
    t.talk("iphis");
    expect(satisfied(t.s, "iphis")).toBe(false);
    valid(t.s);
  });

  it("(b) lays the urn on the Piraeus quay for Iphis: the Mother goes without", () => {
    const t = withUrn();
    t.move("road-athens-eleusis", "athens", "road-athens-piraeus", "piraeus").drop("ash-urn");
    t.move("athens", "road-athens-eleusis", "eleusis").waitFor("iphis").talk("iphis");
    expect(satisfied(t.s, "iphis")).toBe(true);
    expect(satisfied(t.s, "argive-mother")).toBe(false);
    // Myrine walks down to the quay with the traveler; Thaleia, whose wheat
    // came home when the loaf was baked, is met by her arrival.
    t.waitFor("household-witness").walkWith("household-witness", "piraeus").act("wait");
    expect(satisfied(t.s, "household-witness")).toBe(true);
    expect(satisfied(t.s, "quay-host")).toBe(true);
    valid(t.s);
  });
});
