import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { blindLockText, lockText } from "./helpers/lock-text.mjs";

// Rules 133 package 3: every locked box of the Greek pack shows its want. No
// pack writes the words: what a lock waits on is read from its conditions and
// worded by the one wording of a want (world/want-words.mjs).
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
      else expect(r.sealed, key).toBeTruthy();
    }
    for (const [id, a] of gatedPeople) {
      if (NOT_BOXES.has(id)) expect(a.sealed, id).toBeUndefined();
      else expect(a.sealed, id).toBeTruthy();
    }
  });

  it("writes no sentence for any lock", () => {
    for (const r of gatedRoutes)
      expect(r.sealed?.reason, `${r.from}>${r.to}`).toBeUndefined();
    for (const [id, a] of gatedPeople)
      expect(a.sealed?.reason, id).toBeUndefined();
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
    // The choice that opens it is a Give of the tablet to one avatar.
    expect(lockText(s, card)).toMatch(/^Give Helen’s Account Tablet to .+/u);
    expect(blindLockText(s, card)).not.toMatch(/Helen|Tablet/u);
    expect(canMove(s, card)).toBe(false);
    choices(s)["greek-helen-account"] = "egypt";
    expect(isLockedBox(s, card)).toBe(false);
    expect(canMove(s, card)).toBe(true);
  });

  it("draws the Atreid roads locked at the Argolid road, each waiting on its own giver", () => {
    const s = at(full(), "greek-argolid-road");
    const wants = [
      "greek-argos-tomb",
      "greek-mycenae-palace",
      "greek-argive-farm",
    ].map((card) => {
      expect(isLockedBox(s, card), card).toBe(true);
      return lockText(s, card);
    });
    for (const want of wants) expect(want).toMatch(/^Give .+ to .+/u);
    expect(new Set(wants).size).toBe(3);
  });

  it("locks the Open Door's people on their own things, never on a flag", () => {
    const s = at(full(), "greek-athens");
    expect(flags(s)["greek-burial-performed"]).toBeFalsy();
    const ids = [
      "greek-aethra",
      "greek-adrastus",
      "greek-theseus",
      "greek-colonus-keeper",
      "greek-quay-host",
    ];
    for (const id of ids) {
      const read = JSON.stringify(pack.avatars[id].requires);
      expect(read, id).toMatch(/"kind":"item_(near|at)"/u);
      expect(read, id).not.toMatch(/"kind":"(flag|choice)"/u);
      const w = {
        ...s,
        actors: {
          ...s.actors,
          vale: { ...s.actors.vale, place: pack.avatars[id].place },
        },
      };
      expect(isLockedBox(w, id), id).toBe(true);
      expect(lockText(w, id), id).toMatch(/^Bring .+ to .+/u);
    }
    // Marathon's keeper is a rumour in new worlds and keeps no lock.
    expect(pack.avatars["greek-marathon-keeper"].requires).toBeUndefined();
  });
});
