import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { availableCards, sealedReason } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

// Rules 133 package 3: every locked box of the Greek pack tells its want. The
// reason is what the context button shows when the play is blocked, so it is a
// short phrase in the pack's own voice, and nothing is written on a card.
const pack = packDefinition("greek-drama");
const full = () =>
  createWorld({
    opening: false,
    seed: 17,
    packScopes: { "greek-drama": "full" },
  });
const flags = (s) => s.packs["greek-drama"].flags;
const choices = (s) => s.packs["greek-drama"].choices;
const at = (s, place) => {
  s.actors.vale.place = place;
  s.actors.vale.visited.push(place);
  return s;
};
const canMove = (s, to) =>
  legalActions(s).some((a) => a.kind === "move" && a.target === to && !a.item);

// The one the pack leaves unsealed on purpose: the guard draws his own way
// (rules 100). Patroclus is a sealed card of the Charybdis (#2620).
const NOT_BOXES = new Set(["greek-gate>greek-battlefield"]);

describe("the Greek pack's locked boxes", () => {
  const gatedRoutes = pack.routes.filter(
    (r) => r.requires?.length || r.travelerRequires?.length,
  );
  const gatedPeople = Object.entries(pack.avatars).filter(
    ([, a]) => a.requires?.length,
  );

  it("seals every gated way and conditional resident, bar the guard", () => {
    for (const r of gatedRoutes) {
      const key = `${r.from}>${r.to}`;
      if (NOT_BOXES.has(key)) expect(r.sealed, key).toBeUndefined();
      else expect(r.sealed?.reason, key).toBeTruthy();
    }
    for (const [id, a] of gatedPeople) {
      if (NOT_BOXES.has(id)) expect(a.sealed, id).toBeUndefined();
      else expect(a.sealed?.reason, id).toBeTruthy();
    }
  });

  it("tells each want in one short phrase that names no removed branch", () => {
    const reasons = [
      ...gatedRoutes.map((r) => r.sealed?.reason),
      ...gatedPeople.map(([, a]) => a.sealed?.reason),
    ].filter(Boolean);
    expect(reasons.length).toBeGreaterThanOrEqual(28);
    for (const reason of reasons) {
      expect(reason.length, reason).toBeLessThanOrEqual(100);
      expect(reason, reason).toMatch(/\.$/u);
      expect(reason, reason).not.toMatch(/Theban account|earlier account/u);
    }
  });

  it("seals each resident at the place where it stands", () => {
    for (const [id, a] of gatedPeople)
      if (a.sealed) expect(a.sealed.at, id).toBe(a.place);
  });

  it("gives each sealed way a quest that a tap can take", () => {
    for (const r of gatedRoutes)
      if (r.sealed) expect(r.sealed.quest, `${r.from}>${r.to}`).toBeTruthy();
  });

  it("draws Helen's Egyptian road locked at the harbor, and opens it with the choice", () => {
    const s = at(full(), "greek-harbor");
    const card = "greek-egypt-tomb";
    expect(availableCards(s)).toContain(card);
    expect(isLockedBox(s, card)).toBe(true);
    expect(sealedReason(s, card)).toMatch(/Helen’s Account Tablet.*Egyptian/u);
    expect(canMove(s, card)).toBe(false);
    choices(s)["greek-helen-account"] = "egypt";
    expect(isLockedBox(s, card)).toBe(false);
    expect(canMove(s, card)).toBe(true);
  });

  it("draws the Atreid roads locked at the Argolid road, one for each account", () => {
    const s = at(full(), "greek-argolid-road");
    for (const [card, reason] of [
      ["greek-argos-tomb", /tomb account/u],
      ["greek-mycenae-palace", /palace account/u],
      ["greek-argive-farm", /farmhouse account/u],
    ]) {
      expect(isLockedBox(s, card), card).toBe(true);
      expect(sealedReason(s, card), card).toMatch(reason);
    }
  });

  it("keeps the Open Door residents sealed until Polynices is buried", () => {
    const s = at(full(), "greek-athens");
    flags(s)["greek-open-door-open"] = false;
    for (const id of [
      "greek-aethra",
      "greek-adrastus",
      "greek-theseus",
      "greek-colonus-keeper",
      "greek-marathon-keeper",
    ])
      expect(pack.avatars[id].sealed.reason, id).toBe(
        "Not here until Polynices is buried.",
      );
  });
});
