import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  availableCards,
  cardActions,
  cardChoices,
  cardPlay,
  playLabel,
  TOO_MANY_ITEMS,
  playText,
  restPlays,
} from "../v2/card-game/cards.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { isArcanum } from "../v2/card-game/world/arcana.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

function meeting() {
  const world = createWorld();
  world.actors.moth.place = "station";
  world.items.lamp.holder = "vale";
  return world;
}
const kinds = (world, cards) =>
  cardActions(world, cards).actions.map((a) => a.kind);
function primary(world, cards) {
  const offer = cardActions(world, cards).actions[0];
  expect(offer).toBeTruthy();
  expect(legalActions(world)).toContainEqual(offer);
  expect(cardActions(world, [...cards].reverse()).actions).toEqual(
    cardActions(world, cards).actions,
  );
  return offer;
}
describe("named card actions", () => {
  it("routes talk to a person and a threat to Vale plus that person", () => {
    let world = meeting();
    const before = encodeSave(world);
    expect(kinds(world, ["moth"])).toEqual(["talk"]);
    const threat = primary(world, ["vale", "moth"]);
    expect(threat.kind).toBe("threaten");
    expect(playLabel(threat)).toBe("Threaten Pip for Black cloth");
    expect(encodeSave(world)).toBe(before);
    const result = play(world, threat);
    expect(result.ok).toBe(true);
    world = result.state;
    // In battle the selection names the verb, and Talk becomes Strike.
    expect(kinds(world, ["moth"])).toEqual(["attack"]);
    expect(kinds(world, ["vale", "moth"])).toEqual(["intercept"]);
    expect(kinds(world, ["vale"])).toEqual(["guard"]);
    const here = world.actors.vale.place;
    expect(kinds(world, [here])).toEqual(["wait"]);
    expect(playLabel(primary(world, ["vale", "moth"]))).toBe("Cover");
  });
  it("names the recipient, owner, trade items and invited person", () => {
    const world = meeting();
    expect(playLabel(primary(world, ["lamp", "moth"]))).toBe("Give to Pip");
    expect(playLabel(primary(world, ["cloth"]))).toBe(
      "Ask Pip for Black cloth",
    );
    expect(primary(world, ["cloth", "moth"]).kind).toBe("ask");
    expect(playLabel(primary(world, ["lamp", "cloth"]))).toBe(
      "Trade Lamp for Black cloth",
    );
    expect(playLabel(primary(world, ["moth", "pond"]))).toBe(
      "Invite Pip along",
    );
    expect(playLabel(primary(world, ["lamp", "pond"]))).toBe(
      "Carry to Black pond",
    );
    expect(primary(world, ["vale", "pond"]).kind).toBe("move");
    expect(primary(world, ["lamp", "station"]).kind).toBe("drop");
  });
  it("supports use, cover and uncover in either order", () => {
    const world = meeting();
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "vale";
    expect(kinds(world, ["vale", "lamp"])).toEqual([]);
    // The flask refuels an empty lamp on its own; the pair has no play.
    expect(kinds(world, ["oil", "lamp"])).toEqual([]);
    expect(primary(world, ["cloth", "lamp"]).kind).toBe("cover");
    world.items.cloth.holder = "lamp";
    expect(playLabel(primary(world, ["cloth", "lamp"]))).toBe("Uncover");
    world.items.lamp.holder = "station";
    world.items.cloth.holder = "vale";
    expect(kinds(world, ["lamp", "station"])).toEqual([]);
    world.items.lamp.lit = true;
    expect(kinds(world, ["lamp", "station"])).toEqual([]);
    expect(primary(world, ["bell", "station"]).kind).toBe("ring");
  });
  it("shows the wait verb as Wait", () => {
    const world = createWorld();
    const { action, hint } = cardPlay(world, ["vale"]);
    expect(action.kind).toBe("wait");
    expect(playLabel(action)).toBe("Wait");
    expect(hint).toBe("Vale waits one turn.");
  });

  it("names the combat verbs Strike, Brace and Guard over the rules kinds", () => {
    const strike = { kind: "attack", actor: "vale", target: "keeper" };
    const brace = { kind: "guard", actor: "moth", target: null };
    const guard = { kind: "intercept", actor: "moth", target: "vale" };
    expect(playLabel(strike)).toBe("Strike");
    expect(playLabel(brace)).toBe("Brace");
    expect(playText(strike)).toBe("Vale strikes the keeper.");
    expect(playText(brace)).toBe("Pip braces.");
    expect(playText(guard)).toBe("Pip covers Vale.");
  });
  it("lists local fixtures and carries spoken clues through Talk", () => {
    const world = createWorld();
    world.actors.vale.place = "clearing";
    const local = cardActions(world, ["clearing"]).actions;
    expect(local.map(playLabel)).toEqual(["Ring the Steam Clock"]);
    expect(local).toEqual([cardPlay(world, ["clearing"]).action]);
    world.actors.vale.place = "greek-gate";
    world.crossings["pond-greek-harbor"].discovered = true;
    const story = cardActions(world, ["greek-guard"]).actions;
    expect(story[0].kind).toBe("talk");
    // The decree is told on meeting the guard; it is never a button.
    expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
    for (const action of story)
      expect(legalActions(world)).toContainEqual(action);
  });
  it("offers no authored choose play, even for a choice with no trigger", () => {
    const pack = packDefinitions.find((p) => p.id === "badger-forest");
    const { choices } = pack;
    pack.choices = [
      ...(choices ?? []),
      {
        id: "test-inspect-cloth",
        at: "clearing",
        subject: "cloth",
        label: "Inspect the cloth",
        text: "Vale inspects the cloth.",
        effects: [],
      },
    ];
    try {
      const world = createWorld();
      world.actors.vale.place = "clearing";
      world.items.cloth.holder = "vale";
      expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
      expect(kinds(world, ["cloth"])).not.toContain("choose");
    } finally {
      if (choices === undefined) delete pack.choices;
      else pack.choices = choices;
    }
  });
  it("keeps selections with no play free and provides a pairing hint", () => {
    const world = meeting(),
      before = encodeSave(world);
    for (const cards of [
      [],
      ["missing"],
      ["vale", "lamp", "bell"],
    ]) {
      const result = cardActions(world, cards);
      expect(result.actions).toEqual([]);
      expect(result.hint).toBeTruthy();
    }
    expect(encodeSave(world)).toBe(before);
  });
  it("names no item pairing for a selection with no play", () => {
    const world = meeting();
    world.actors.keeper.place = "station";
    world.items.oil.holder = world.items.cloth.holder = "vale";
    world.items.bell.holder = "station";
    for (const cards of [
      ["moth", "keeper"],
      ["lamp", "bell"],
      ["oil", "lamp"],
    ])
      expect(cardActions(world, cards)).toEqual({ actions: [], hint: "" });
    for (const id of ["oil", "cloth", "lamp"]) {
      const { actions, hint } = cardActions(world, [id]);
      expect(actions).toEqual([]);
      expect(hint).toMatch(/this place to put it down/u);
      expect(hint).not.toMatch(/Lamp|Bell|Oil|cloth/u);
      expect(kinds(world, [id, "station"])).toEqual(["drop"]);
    }
    expect(kinds(world, ["oil", "moth"])).toEqual(["give"]);
  });
  it("hints at Ask only when an Ask for that person is legal", () => {
    const ask = /ask for it/u;
    const world = meeting();
    expect(legalActions(world).some((a) => a.kind === "ask")).toBe(true);
    expect(cardActions(world, ["moth"]).hint).toMatch(ask);
    // Pip carries nothing, so nothing can be asked for.
    world.items.cloth.holder = "station";
    expect(legalActions(world).some((a) => a.kind === "ask")).toBe(false);
    expect(cardActions(world, ["moth"]).hint).not.toMatch(ask);
    // A present resident not yet met has no plays, so no hint names one.
    const unmet = createWorld({ opening: true });
    unmet.actors.moth.place = unmet.actors.vale.place;
    delete unmet.opening.met.moth;
    expect(availableCards(unmet)).toContain("moth");
    expect(cardActions(unmet, ["moth"])).toEqual({ actions: [], hint: "" });
  });
  it("says why Take is missing when the avatar's hands are full", () => {
    const world = createWorld({ opening: false });
    world.items.oil.holder = "station";
    expect(kinds(world, ["oil"])).toEqual(["take"]);
    for (const id of ["lamp", "bell", "hoppycat-red-thread-spool"])
      world.items[id].holder = "vale";
    world.items.cloth.holder = "station";
    for (const cards of [["oil"], ["vale", "oil"], ["oil", "vale"]]) {
      expect(cardPlay(world, cards).action).toBeFalsy();
      expect(cardActions(world, cards).hint).toBe(TOO_MANY_ITEMS);
    }
    world.items.bell.holder = "station";
    expect(cardActions(world, ["oil"]).hint).not.toBe(TOO_MANY_ITEMS);
  });
  it("puts the full-hands reason in the context button, not on cards", () => {
    const app = readFileSync(
      new URL("../v2/card-game/app.mjs", import.meta.url),
      "utf8",
    );
    const body = (name) => {
      const at = app.indexOf(`function ${name}(`);
      return app.slice(at, app.indexOf("\nfunction ", at + 1));
    };
    // The context button names the item and never plays (#2018, #2023).
    const actions = body("renderActions");
    expect(actions).toContain(
      "`You have too many items to take ${theName(crowded).toLowerCase()}`",
    );
    expect(actions).toContain("blockPlay(blocked, kind);");
    expect(body("blockPlay")).toContain('"aria-disabled", "true"');
    expect(body("updateCardCooldown")).toContain(
      "selectionBlocked() && !button.dataset.blocked",
    );
    // Cards keep their accessible name and tooltip.
    for (const name of ["card", "updateCardSelection"]) {
      expect(body(name)).not.toContain("TOO_MANY_ITEMS");
      expect(body(name)).not.toMatch(/\.title\b/u);
    }
  });
  it("places carried and nested items directly after their holders", () => {
    const world = meeting();
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "lamp";
    const cards = availableCards(world).filter((id) => !isArcanum(id));
    expect(cards.slice(0, 5)).toEqual(["vale", "lamp", "cloth", "oil", "moth"]);
    expect(
      cards.slice(cards.indexOf("station"), cards.indexOf("pond")),
    ).toEqual(["station", ...(world.items["ratiradio-request-slip"] ? ["ratiradio-request-slip"] : []), "bell"]);
    expect(cards.slice(-1)).toEqual(["pond"]);
    world.items.lamp.holder = "moth";
    const moved = availableCards(world);
    expect(
      moved.slice(moved.indexOf("moth"), moved.indexOf("moth") + 3),
    ).toEqual(["moth", "lamp", "cloth"]);
  });
});

describe("Sleep after a Wait (#2028)", () => {
  const waited = () => {
    const world = createWorld();
    const wait = legalActions(world).find((a) => a.kind === "wait");
    return play(world, wait, world.revision).state;
  };
  const labels = (world, again, cards = ["vale"]) =>
    restPlays(world, cardActions(world, cards).actions, again, cards).map(
      playLabel,
    );
  it("offers Sleep only for the same cards chosen again", () => {
    const world = waited();
    expect(legalActions(world).some((a) => a.sleep)).toBe(true);
    expect(labels(world, true)).toEqual(["Sleep"]);
    expect(labels(world, false)).toEqual(["Wait"]);
    expect(labels(createWorld(), true)).toEqual(["Wait"]);
  });
  it("gives Wake and Sleep on their own selections", () => {
    const world = waited();
    const place = world.actors.vale.place;
    world.actors.vale.sleeping = { since: world.turn, place, present: [] };
    expect(labels(world, false)).toEqual(["Wake"]);
    expect(labels(world, true)).toEqual(["Wake"]);
    expect(labels(world, false, ["vale", place])).toEqual(["Sleep on"]);
    expect(playLabel(cardPlay(world, [place, "vale"]).action)).toBe("Sleep on");
  });
});

describe("Wait gives way; a wait at sea is Sail (#2027)", () => {
  const shown = (world, cards, again = false) =>
    restPlays(world, cardActions(world, cards).actions, again, cards);
  it("separates the Steam Clock from resting in the clearing", () => {
    const world = createWorld();
    world.actors.vale.place = "clearing";
    const clock = ["clearing"],
      rest = ["vale", "clearing"];
    expect(shown(world, clock).map(playLabel)).toEqual([
      "Ring the Steam Clock",
    ]);
    expect(shown(world, rest).map(playLabel)).toEqual(["Wait"]);
    const waited = play(world, shown(world, rest)[0]).state;
    expect(shown(waited, clock, true).map(playLabel)).toEqual([
      "Ring the Steam Clock",
    ]);
    expect(shown(waited, rest, true).map(playLabel)).toEqual(["Sleep"]);
    waited.actors.vale.sleeping = {
      since: waited.turn,
      place: "clearing",
      present: [],
    };
    expect(shown(waited, clock).map(playLabel)).toEqual([
      "Ring the Steam Clock",
    ]);
    expect(shown(waited, rest).map(playLabel)).toEqual(["Sleep on"]);
  });
  it("names the Wait aboard a ship at sea Sail and carries the voyage on", () => {
    let world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    const step = (pick) =>
      (world = play(world, legalActions(world).find(pick)).state);
    step((a) => a.kind === "move" && a.target === "greek-ship");
    // Docked, a wait goes nowhere yet, so it stays Wait for every selection.
    for (const cards of [["vale"], ["greek-ship"], ["vale", "greek-ship"]]) {
      expect(shown(world, cards).map(playLabel)).toEqual(["Wait"]);
      expect(playText(shown(world, cards)[0])).toBe("Vale waits one turn.");
    }
    step((a) => a.target === "pond" && a.kind !== "wait");
    expect(world.transports["greek-ship"].phase).toBe("sea");
    const [sail] = shown(world, ["greek-ship"]);
    expect(playLabel(sail)).toBe("Sail");
    expect(playText(sail)).toBe("Vale sails on.");
    expect(sail.kind).toBe("wait");
    // Sail is choosing the ship: the ship's card, alone or with Vale's.
    for (const cards of [["greek-ship"], ["vale", "greek-ship"]]) {
      const [play] = shown(world, cards);
      expect([playLabel(play), playText(play), play.kind]).toEqual([
        "Sail",
        "Vale sails on.",
        "wait",
      ]);
      expect(playLabel(cardPlay(world, cards).action)).toBe("Sail");
    }
    // Vale alone waits, the same rules wait, and Sleep stays off aboard.
    const [wait] = shown(world, ["vale"]);
    expect([playLabel(wait), playText(wait), wait.kind]).toEqual([
      "Wait",
      "Vale waits one turn.",
      "wait",
    ]);
    expect(wait.key).toBe(sail.key);
    expect(playLabel(cardPlay(world, ["vale"]).action)).toBe("Wait");
    expect(shown(world, ["vale"], true).map(playLabel)).toEqual(["Wait"]);
    expect(play(world, sail).state.transports["greek-ship"]).toMatchObject({
      phase: "arrived",
      dock: "pond",
    });
  });
});
