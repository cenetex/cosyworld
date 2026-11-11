import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  boxesAt,
  boxOpen,
  boxWant,
  creditOpened,
} from "../v2/card-game/world/boxes.mjs";
import {
  availableCards,
  cardPlay,
  sealedReason,
} from "../v2/card-game/cards.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import {
  entityActive,
  entityShown,
  latchRoutes,
  packDefinition,
  packThings,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { consume, settleSealedItems } from "../v2/card-game/pack-items.mjs";
import { usedUp } from "../v2/card-game/item-use.mjs";

// Sealed items (rules 133): an item that lies shut where it is until its
// `requires` hold. The shovel opens when the figs lie at the gate and then
// latches; the household token follows its facts (`live`): it opens while the
// wine skin lies in the sanctuary. The rules memo the box lists on first use,
// so the content is patched here, before any world is read.
const SHOVEL = "greek-shovel",
  TOKEN = "greek-household-token",
  FIGS = "greek-figs",
  SKIN = "greek-wine-skin",
  gate = "greek-gate",
  sanctuary = "greek-sanctuary";
const at = (item, place) => [{ kind: "item_at", item, place }];
packThings[SHOVEL].requires = at(FIGS, gate);
packThings[SHOVEL].sealed = {};
packThings[TOKEN].requires = at(SKIN, sanctuary);
packThings[TOKEN].sealed = { live: true };

const world = (place = gate) => {
  const s = createWorld({ seed: 7, packScopes: { "greek-drama": "full" } });
  s.actors.vale.place = place;
  return s;
};
const act = (s, kind, fields = {}) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const done = play(s, action, s.revision);
  expect(done.ok, done.error).toBe(true);
  return done.state;
};
const touches = (s, id) =>
  legalActions(s).filter((a) => a.item === id || a.target === id);
const quiet = () => {};
const the = (id) => id;

describe("a sealed item lies shut", () => {
  it("is drawn locked where it lies, with its want, and keeps its record", () => {
    const s = world();
    expect(s.items[SHOVEL].holder).toBe(gate);
    expect(entityActive(s, SHOVEL)).toBe(false);
    expect(entityShown(s, SHOVEL)).toBe(true);
    expect(boxesAt(s, gate, "vale").filter((b) => b.kind === "item")).toEqual([
      {
        id: SHOVEL,
        kind: "item",
        at: gate,
        open: false,
        want: {
          kind: "item",
          target: FIGS,
          step: { verb: "bring", at: gate },
        },
        goals: [
          { kind: "item", target: FIGS, step: { verb: "bring", at: gate } },
        ],
      },
    ]);
    expect(availableCards(s)).toContain(SHOVEL);
    expect(isLockedBox(s, SHOVEL)).toBe(true);
    expect(lockedQuest(s, SHOVEL, () => true).text).toMatch(/Dried Figs/);
    expect(lockedQuest(s, SHOVEL).text).not.toMatch(/Figs/);
    expect(boxOpen(s, { kind: "item", at: gate, id: SHOVEL }, "vale")).toBe(
      false,
    );
    expect(boxWant(s, { kind: "item", at: gate, id: SHOVEL }, "vale")).toEqual({
      kind: "item",
      target: FIGS,
      step: { verb: "bring", at: gate },
    });
    // Elsewhere it is not on the table.
    expect(
      boxesAt(world("greek-courtyard"), "greek-courtyard").map((b) => b.id),
    ).not.toContain(SHOVEL);
  });
  it("cannot be taken, held, given or used", () => {
    const s = world();
    expect(touches(s, SHOVEL)).toEqual([]);
    // Selecting it plays nothing and says why on the button.
    const pick = cardPlay(s, [SHOVEL]);
    expect(pick.action).toBeFalsy();
    expect(pick.hint).toBe(sealedReason(s, SHOVEL));
    // A forged play is refused.
    const forged = {
      ...legalActions(s).find((a) => a.kind === "take"),
      item: SHOVEL,
      key: `take:vale:${SHOVEL}:`,
    };
    expect(play(s, forged, s.revision).ok).toBe(false);
  });
});

describe("opening", () => {
  it("opens on the play that makes its conditions true, pays one XP once, and latches", () => {
    let s = world();
    s.items[FIGS].holder = "vale";
    const xp = s.actors.vale.xp;
    s = act(s, "drop", { item: FIGS });
    expect(entityActive(s, SHOVEL)).toBe(true);
    expect(boxesAt(s, gate, "vale").some((b) => b.id === SHOVEL)).toBe(false);
    expect(s.opened[SHOVEL]).toEqual(["vale"]);
    expect(s.actors.vale.xp).toBe(xp + 1);
    expect(s.openedRoutes).toContain(`item:${SHOVEL}`);
    // Taken like any item.
    s = act(s, "take", { item: SHOVEL });
    expect(s.items[SHOVEL].holder).toBe("vale");
    // The default latch: the fact lapsing does not shut it again, and
    // picking the figs up again pays nothing.
    s = act(s, "take", { item: FIGS });
    expect(entityActive(s, SHOVEL)).toBe(true);
    expect(s.items[SHOVEL].holder).toBe("vale");
    expect(s.actors.vale.xp).toBe(xp + 1);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("reads its conditions as they stand until the latch has run", () => {
    const s = world();
    s.items[FIGS].holder = gate;
    expect(entityActive(s, SHOVEL)).toBe(true);
    s.items[FIGS].holder = sanctuary;
    expect(entityActive(s, SHOVEL)).toBe(false);
    s.items[FIGS].holder = gate;
    latchRoutes(s);
    s.items[FIGS].holder = sanctuary;
    expect(entityActive(s, SHOVEL)).toBe(true);
  });
});

describe("a live seal locks again", () => {
  const carried = () => {
    const s = world(sanctuary);
    const before = structuredClone(s);
    s.items[SKIN].holder = sanctuary;
    s.items[TOKEN].holder = "vale";
    expect(entityActive(s, TOKEN)).toBe(true);
    return { s, before };
  };
  it("sends a carried item home, shut, instead of stranding it", () => {
    const { s } = carried();
    s.items[SKIN].holder = gate;
    const lines = [];
    settleSealedItems(s, the, (text, where) => lines.push([text, where]));
    expect(s.items[TOKEN].holder).toBe(packThings[TOKEN].holder);
    expect(usedUp(s, TOKEN)).toBe(false);
    expect(entityActive(s, TOKEN)).toBe(false);
    expect(entityShown(s, TOKEN)).toBe(true);
    expect(lines).toEqual([
      [expect.stringMatching(/sealed again/u), sanctuary],
    ]);
    expect(boxesAt(s, sanctuary, "vale").some((b) => b.id === TOKEN)).toBe(
      true,
    );
    expect(touches(s, TOKEN)).toEqual([]);
    // Nothing moves a second time.
    settleSealedItems(s, the, () => lines.push("again"));
    expect(lines).toHaveLength(1);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("happens inside a play, and opens again on its facts without paying twice", () => {
    let s = world(sanctuary);
    s.items[SKIN].holder = "vale";
    const xp = s.actors.vale.xp;
    s = act(s, "drop", { item: SKIN });
    expect(s.actors.vale.xp).toBeGreaterThan(xp);
    expect(s.opened[TOKEN]).toEqual(["vale"]);
    s = act(s, "take", { item: TOKEN });
    expect(s.items[TOKEN].holder).toBe("vale");
    // Taking the skin away shuts the token and it goes home.
    s = act(s, "take", { item: SKIN });
    expect(s.items[TOKEN].holder).toBe(sanctuary);
    expect(entityActive(s, TOKEN)).toBe(false);
    expect(s.log.some((entry) => /sealed again/u.test(entry.text))).toBe(true);
    // Opening it again pays nothing more.
    const xpNow = s.actors.vale.xp;
    s = act(s, "drop", { item: SKIN });
    expect(entityActive(s, TOKEN)).toBe(true);
    expect(s.actors.vale.xp).toBe(xpNow);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("lets a latching seal alone, wherever it is carried", () => {
    const s = world();
    s.items[FIGS].holder = gate;
    latchRoutes(s);
    s.items[SHOVEL].holder = "vale";
    s.items[FIGS].holder = sanctuary;
    settleSealedItems(s, the, quiet);
    expect(s.items[SHOVEL].holder).toBe("vale");
  });
  it("pays nothing to a second reading of the same opening", () => {
    const { s, before } = carried();
    const first = creditOpened(before, s, "vale").filter(
      (box) => box.box === TOKEN,
    );
    expect(first).toHaveLength(1);
    expect(creditOpened(before, s, "vale")).toEqual([]);
  });
});

describe("made things and consumed items", () => {
  it("lists a made thing exactly as before", () => {
    const s = createWorld();
    s.actors.vale.place = "greek-courtyard";
    const bread = boxesAt(s, "greek-courtyard", "vale").find(
      (b) => b.id === "greek-bread",
    );
    expect(bread).toMatchObject({ kind: "item", open: false });
    expect(bread.goals).toHaveLength(1);
    expect(s.items["greek-bread"]).toBeDefined();
  });
  it("brings a consumed sealed item home still shut", () => {
    const s = world();
    s.items[FIGS].holder = gate;
    latchRoutes(s);
    s.items[SHOVEL].holder = "vale";
    // Eaten or used, a thing goes home: shut, if its seal is live.
    packThings[SHOVEL].sealed = { live: true };
    try {
      s.items[FIGS].holder = sanctuary;
      consume(s, SHOVEL);
      expect(usedUp(s, SHOVEL)).toBe(false);
      expect(s.items[SHOVEL].holder).toBe(gate);
      expect(entityShown(s, SHOVEL)).toBe(true);
      expect(entityActive(s, SHOVEL)).toBe(false);
    } finally {
      packThings[SHOVEL].sealed = {};
    }
  });
});

describe("schema", () => {
  const attempt = (patch) => {
    const p = structuredClone(packDefinition("greek-drama"));
    patch(p.items[SHOVEL]);
    return validatePackDefinition(p);
  };
  const shut = { requires: at(FIGS, gate) };
  it("takes requires, at a place of the pack", () => {
    expect(() => attempt(() => {})).not.toThrow();
    expect(() =>
      attempt((i) => {
        Object.assign(i, shut, { sealed: { live: true } });
      }),
    ).not.toThrow();
  });
  it("rejects a seal with nothing to open it, an authored reason, or a bad place", () => {
    const bad = (sealed, extra = {}) =>
      expect(() =>
        attempt((i) => Object.assign(i, shut, extra, { sealed })),
      ).toThrow();
    bad({}, { requires: [] });
    bad({ reason: "Shut." });
    bad({ live: false });
    bad({ quest: {} });
    bad({}, { holder: "greek-antigone" });
    bad({}, { home: "greek-courtyard" });
  });
});
