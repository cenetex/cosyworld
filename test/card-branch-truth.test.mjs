import { describe, expect, it } from "vitest";
import {
  applyTalkDisclosure,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { knowledgeFacts } from "../v2/card-game/knowledge.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { claimTruth, claimsIn } from "../v2/card-game/claims.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const HELEN = "greek-helen-accounts",
  ATREID = "greek-atreid-record";
const [EGYPT, TROY] = claimsIn(HELEN).map((c) => c.text);
const act = (w, kind, test = () => true, who = "vale") => {
  const action = legalActions(w, who).find((a) => a.kind === kind && !a.sleep && test(a));
  if (!action) throw new Error(`${who} cannot ${kind}`);
  return play(w, action).state;
};
const wait = (w) => act(w, "wait");
const greek = (place = "greek-harbor") => {
  const w = createWorld({ packScopes: { "greek-drama": "full" } });
  w.crossings["pond-greek-harbor"].discovered = true;
  w.actors.vale.place = place;
  return w;
};
const holding = (w, book) => {
  w.items[book].holder = "vale";
  return w;
};
const read = (w, book) => act(holding(w, book), "read", (a) => a.item === book);
const committed = (key, value, choice) => {
  const w = wait(greek());
  w.packs["greek-drama"].choices[key] = value;
  w.packs["greek-drama"].receipts[choice] = w.turn;
  return w;
};
const held = (w, book, who = "vale") =>
  Object.fromEntries(
    claimsIn(book, w).map((c) => [c.claim, w.knowledge.known[who]?.[c.id]?.status ?? "belief"]),
  );
const beliefs = { egypt: "belief", troy: "belief" };

describe("a claim's truth follows the world's branch", () => {
  it("comes from the branch that the claim's subject exists on", () => {
    const branch = (book) => claimsIn(book).map((c) => claimTruth("greek-drama", c.about));
    expect(branch(HELEN)).toEqual(
      ["egypt", "troy"].map((value) => [{ kind: "choice", key: "greek-helen-account", value }]),
    );
    expect(branch(ATREID).map((t) => t.map((c) => c.value))).toEqual([["aeschylus"], ["sophocles"], ["euripides"]]);
    expect(branch("greek-decree")).toEqual([[]]);
  });

  for (const [value, other, at, subject, place] of [
    ["egypt", "troy", "greek-harbor", "greek-shipmaster", "greek-egypt-tomb"],
    ["troy", "egypt", "greek-well", "greek-elder", "greek-troy-beach"],
  ]) {
    const settled = { [value]: "confirmed", [other]: "disproved" };
    const give = (w) => act(w, "give", (a) => a.item === HELEN && a.target === subject);
    it(`settles Helen's tablet for a reader who saw the world commit to ${value}`, () => {
      const before = read(greek(at), HELEN);
      expect(held(before, HELEN)).toEqual(beliefs);
      const after = give(before);
      expect(after.packs["greek-drama"].choices["greek-helen-account"]).toBe(value);
      expect(held(after, HELEN)).toEqual(settled);
      const later = give(holding(greek(at), HELEN));
      expect(later.items[HELEN].holder).toBe(at);
      expect(held(read(later, HELEN), HELEN)).toEqual(settled);
    });

    it(`settles it at ${place}, and only there, for a reader who did not see it`, () => {
      let w = wait(read(committed("greek-helen-account", value, `greek-helen-${value}`), HELEN));
      expect(held(w, HELEN)).toEqual(beliefs);
      w.actors.vale.place = place;
      w = wait(w);
      expect(held(w, HELEN)).toEqual(settled);
    });
  }

  it("tells a settled claim as known or as a mistaken belief", () => {
    const w = act(read(greek(), HELEN), "give", (a) => a.target === "greek-shipmaster");
    const lines = knowledgeFacts(w, "vale", nameOf, [], 4);
    expect(lines).toContain(
      `I read this in Helen’s Account Tablet, by The Bard, and I know it is true: ${EGYPT}`,
    );
    expect(lines).toContain(
      `I read in Helen’s Account Tablet, by The Bard, that ${TROY.slice(0, -1)}; it was wrong.`,
    );
  });

  it("gives a claim told second-hand only as a belief until the listener witnesses", () => {
    let w = read(committed("greek-helen-account", "egypt", "greek-helen-egypt"), HELEN);
    w.actors.vale.place = "greek-egypt-tomb";
    w = wait(w);
    w.actors.vale.place = "greek-harbor";
    const heard = () => claimsIn(HELEN).find((c) => w.knowledge.known["greek-shipmaster"]?.[c.id]);
    // The shipmaster shares charted lanes before the conversation turns to the claim.
    for (let n = 0; n < 12 && !heard(); n++) {
      w = act(w, "talk", (a) => a.target === "greek-shipmaster");
      const context = narrativeContext(w);
      const disclosure = context.disclosures?.[0];
      if (disclosure)
        applyTalkDisclosure(w, disclosure, {
          actorId: disclosure.speaker,
          locationId: context.location,
        });
    }
    const told = heard();
    expect(told).toBeDefined();
    expect(w.knowledge.known.vale[told.id].status).toBeDefined();
    expect(w.knowledge.known["greek-shipmaster"][told.id]).toMatchObject({ kind: "heard", teller: "vale" });
    expect(held(w, HELEN, "greek-shipmaster")[told.claim]).toBe("belief");
    w.actors["greek-shipmaster"].place = "greek-egypt-tomb";
    w = wait(w);
    const status = w.knowledge.known["greek-shipmaster"][told.id].status;
    expect(status).toBe(told.claim === "egypt" ? "confirmed" : "disproved");
    expect(knowledgeFacts(w, "greek-shipmaster", nameOf)[0]).toMatch(/^Vale told me (this from|that) Helen’s Account Tablet/u);
  });

  it("settles nothing while the branch is open, and loads no status it could not have", () => {
    const w = wait(wait(read(greek(), HELEN)));
    expect(held(w, HELEN)).toEqual(beliefs);
    const egypt = committed("greek-helen-account", "egypt", "greek-helen-egypt");
    egypt.actors.vale.place = "greek-egypt-tomb";
    const known = wait(read(egypt, HELEN));
    expect(held(known, HELEN)).toEqual({ egypt: "confirmed", troy: "disproved" });
    for (const [world, id, status] of [
      [w, claimsIn(HELEN)[0].id, "confirmed"],
      [known, claimsIn(HELEN)[1].id, "confirmed"],
      [known, claimsIn(HELEN)[1].id, "unsure"],
    ]) {
      const forged = structuredClone(world);
      forged.knowledge.known.vale[id].status = status;
      expect(() => validateWorld(forged)).toThrow(expect.objectContaining({ check: "knowledge" }));
      expect(decodeSave(JSON.stringify(forged)).knowledge.known.vale[id].status).toBeUndefined();
    }
  });

  it("settles the Atreid record on each of its three branches, with the branch's resident", () => {
    const claims = claimsIn(ATREID);
    for (const [value, resident] of [
      ["aeschylus", "greek-orestes-aeschylus"],
      ["sophocles", "greek-electra-sophocles"],
      ["euripides", "greek-electra-euripides"],
    ]) {
      let w = read(committed("greek-atreid-account", value, `greek-atreid-${value}`), ATREID);
      expect(Object.values(held(w, ATREID))).toEqual(["belief", "belief", "belief"]);
      w.actors[resident].place = "greek-harbor";
      w = wait(w);
      expect(held(w, ATREID)).toEqual(
        Object.fromEntries(
          claims.map((c) => [
            c.claim,
            claimTruth("greek-drama", c.about)[0].value === value ? "confirmed" : "disproved",
          ]),
        ),
      );
    }
  });

  it("loads a rules 199 reader, locally and shared, to settle by witnessing", () => {
    const w = read(committed("greek-helen-account", "egypt", "greek-helen-egypt"), HELEN);
    const shared = dispatchShared({ op: "create", save: encodeSave(w) }).world;
    for (const world of [
      decodeSave(encodeSave(w)),
      dispatchShared({ op: "upgrade", from: "full-card-world/199", world: shared }).world,
    ]) {
      expect(held(world, HELEN)).toEqual(beliefs);
      world.actors.vale.place = "greek-egypt-tomb";
      expect(held(wait(world), HELEN)).toEqual({ egypt: "confirmed", troy: "disproved" });
    }
  });

  it("keeps a status across saves while its claim keeps its branch", () => {
    const egypt = committed("greek-helen-account", "egypt", "greek-helen-egypt");
    egypt.actors.vale.place = "greek-egypt-tomb";
    const saved = encodeSave(wait(read(egypt, HELEN)));
    expect(held(decodeSave(saved), HELEN)).toEqual({ egypt: "confirmed", troy: "disproved" });
    const troy = packDefinition("greek-drama").items[HELEN].claims[1];
    troy.about = "greek-harbor";
    try {
      expect(held(decodeSave(saved), HELEN)).toEqual({ egypt: "confirmed", troy: "belief" });
    } finally {
      troy.about = "greek-troy-beach";
    }
  });
});
