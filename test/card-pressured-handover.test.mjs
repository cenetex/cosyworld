import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { actionCaption } from "../v2/card-game/beats.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

function act(s, kind, target = null, item = null) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      !a.sleep &&
      (!target || a.target === target) &&
      (!item || a.item === item),
  );
  expect(a).toBeTruthy();
  const result = play(s, a);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function meeting() {
  const s = createWorld({ seed: 7 });
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "vale";
  s.items.cloth.holder = "attic";
  s.actors.moth.want = { ...newWant("item", "lamp", 0), refusals: 1 };
  s.actors.keeper.want = null;
  delete s.actors.moth.metTurn;
  return s;
}
const demand = () => act(act(meeting(), "wait"), "wait");
const reload = (s) => decodeSave(encodeSave(s));
it("records a wanted handover from the actual threat without gift affection", () => {
  let s = reload(demand());
  const threat = s.log.findLast((e) => e.verb === "threaten");
  expect(s.standoffs[0].sourceSeq).toBe(threat.seq);
  const life = structuredClone(s.life.actors.moth);
  s = act(s, "give", "moth", "lamp");
  const event = s.log.findLast((e) => e.verb === "give");
  expect(event).toMatchObject({
    accepted: true,
    handover: {
      kind: "pressure",
      sourceSeq: threat.seq,
      openedTurn: threat.turn,
    },
  });
  expect(event.text).toBe("Vale hands the Lamp to Pip under pressure.");
  expect(actionCaption(event, { viewer: "vale", here: "station" }).text).toBe(
    "Vale handed the Lamp to Pip under pressure.",
  );
  expect(s.actors.moth.trust.vale).toBe(0);
  expect(s.life.actors.moth).toEqual(life);
  expect(s.standoffs).toEqual([]);
  expect(s.items.lamp.holder).toBe("moth");
  expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  expect(reload(s).log.find((e) => e.seq === event.seq)).toEqual(event);
});

it("keeps a voluntary wanted gift's trust, keepsake and company", () => {
  const s = act(meeting(), "give", "moth", "lamp");
  expect(s.log.find((e) => e.verb === "give").handover).toBeUndefined();
  expect(s.actors.moth.trust.vale).toBe(1);
  expect(s.life.actors.moth.attachments.lamp.from).toBe("vale");
  expect(s.life.actors.moth.company.vale).toBeGreaterThan(s.turn);
  expect(s.life.actors.moth.experiences.some((e) => e.kind === "gift")).toBe(
    true,
  );
});
it("keeps both actual threat grievances open after the pressured handover", () => {
  let s = meeting();
  s.actors.moth.want = null;
  s.actors.moth.metTurn = 0;
  s = act(act(s, "threaten", "moth"), "guard");
  while (s.peaceUntil.moth > s.turn) s = act(s, "wait");
  s.actors.moth.want = { ...newWant("item", "lamp", s.turn), refusals: 1 };
  delete s.actors.moth.metTurn;
  s = act(act(s, "wait"), "wait");
  const old = s.motives.grievances.moth.find(
    (g) => g.other === "vale",
  ).incident;
  s = act(s, "give", "moth", "lamp");
  expect(
    s.motives.grievances.moth.find((g) => g.incident === old).repaired,
  ).toBe(false);
  expect(
    s.motives.grievances.vale.find((g) => g.other === "moth").repaired,
  ).toBe(false);
  expect(
    Object.values(s.knowledge.facts).some((f) => f.source.kind === "repair"),
  ).toBe(false);
});
it("meets the real Give quest at once, and gives no trust for a coerced gift", () => {
  let s = demand();
  s.actors.vale.visited.push("pond");
  s.actors.vale.want = {
    ...newWant("item", "lamp", s.turn),
    step: { verb: "give", to: "moth" },
  };
  const before = s.actors.vale.xp;
  s = act(s, "give", "moth", "lamp");
  expect(s.actors.vale.xp).toBe(before);
  expect(s.actors.vale.want).toBeNull();
  expect(s.actors.vale.questRewards).toBeUndefined();
  expect(s.actors.moth.trust.vale).toBe(0);
});
it("gives one more trust, and no XP, for a voluntary gift that meets Pip's want", () => {
  const s0 = meeting();
  const before = s0.actors.vale.xp;
  const s = act(s0, "give", "moth", "lamp");
  expect(s.actors.vale.xp).toBe(before);
  expect(s.actors.moth.trust.vale).toBe(1);
});
it("rejects a full recipient and unrelated item or recipient requests", () => {
  const s = demand();
  for (const key of ["give:vale:cloth:moth", "give:vale:lamp:keeper"])
    expect(play(s, { key }).ok).toBe(false);
  for (const id of ["cloth", "bell", "oil"]) s.items[id].holder = "moth";
  expect(play(s, { key: "give:vale:lamp:moth" }).ok).toBe(false);
  expect(s.items.lamp.holder).toBe("vale");
  expect(s.log.some((e) => e.handover)).toBe(false);
});
it("keeps a declined Give separate from a pressured transfer", () => {
  const s = meeting();
  s.items.bell.holder = "vale";
  const result = act(s, "give", "moth", "bell");
  expect(result.log.find((e) => e.verb === "give")).toMatchObject({
    accepted: false,
  });
  expect(result.log.some((e) => e.handover)).toBe(false);
  expect(result.items.bell.holder).toBe("vale");
});
it("preserves real source anchors after log trimming and marks older battles unknown", () => {
  const s = demand(),
    source = s.standoffs[0].sourceSeq;
  s.log = s.log.filter((e) => e.seq !== source);
  expect(
    act(reload(s), "give", "moth", "lamp").log.find((e) => e.handover).handover
      .sourceSeq,
  ).toBe(source);
  delete s.standoffs[0].sourceSeq;
  const old = act(reload(s), "give", "moth", "lamp");
  expect(old.log.find((e) => e.handover).handover.sourceSeq).toBeNull();
  const forged = demand();
  forged.standoffs[0].sourceSeq = forged.log.find((e) => e.verb === "ask").seq;
  expect(() => validateWorld(forged)).toThrow();
  const event = old.log.find((e) => e.handover);
  event.handover.sourceSeq = event.seq;
  expect(() => validateWorld(old)).toThrow();
});
it.each([
  ["actorId", "keeper"],
  ["itemId", "cloth"],
  ["locationId", "pond"],
  ["generated", true],
])("rejects a retained threat source with changed %s", (field, value) => {
  const s = demand();
  s.log.find((e) => e.seq === s.standoffs[0].sourceSeq)[field] = value;
  expect(() => validateWorld(s)).toThrow();
});
it("rejects extra handover metadata", () => {
  const s = act(demand(), "give", "moth", "lamp");
  s.log.find((e) => e.handover).handover.guessed = true;
  expect(() => validateWorld(s)).toThrow();
});
it("preserves the shared player's threat and the NPC's custody", () => {
  const s = meeting();
  s.items.lamp.holder = "moth";
  s.actors.moth.want = null;
  const world = dispatchShared({ op: "create", save: encodeSave(s) }).world;
  const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const action = dispatchShared({ op: "view", world, ...context }).actions
    .find((a) => a.kind === "threaten" && a.target === "moth");
  const r = dispatchShared({ op: "play", world, ...context, action, expectedRevision: world.revision });
  expect(r.ok, r.error).toBe(true);
  expect(r.world.items.lamp.holder).toBe("moth");
  expect(r.world.standoffs[0].sourceSeq).toBe(r.world.log.find((e) => e.verb === "threaten").seq);
  expect(r.world.log.some((e) => e.handover)).toBe(false);
});
