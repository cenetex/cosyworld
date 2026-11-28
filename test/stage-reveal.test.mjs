import { describe, expect, it, vi } from "vitest";
import { roomItemLead } from "../v2/card-game/mystery-view.mjs";
import { sceneStaging } from "../v2/card-game/scene.mjs";
import { createWorld } from "../v2/card-game/world.mjs";
import {
  STAGE_REVEAL_MS,
  fadeInRevealed,
  revealedCover,
  revealedStage,
} from "../v2/card-game/stage-reveal.mjs";

describe("the revealed stage", () => {
  it("shows only revealed figures and things", () => {
    const covered = (id) => ["pip", "lamp"].includes(id);
    expect(
      revealedStage(
        {
          cast: ["vale", "pip", "moth"],
          floorItems: [{ id: "lamp" }, { id: "cloth", lit: false }],
        },
        covered,
      ),
    ).toEqual({
      cast: ["vale", "moth"],
      floorItems: [{ id: "cloth", lit: false }],
    });
  });

  it("opens a new world on its player alone", () => {
    const shown = new Set(["vale"]);
    expect(
      revealedStage({ cast: ["vale", "moth"] }, (id) => !shown.has(id)),
    ).toEqual({ cast: ["vale"], floorItems: [] });
  });

  it("fills all floor slots with revealed props and keeps the lead visible on a phone", () => {
    const world = createWorld({ seed: 7 });
    world.actors.vale.place = "station";
    const props = ["willows-map", "willows-rope", "willows-sheet", "willows-paddle", "ratiradio-glass", "ratiradio-thermos"];
    for (const id of props) world.items[id].holder = "station";
    const lead = props.at(-1);
    const { floorItems } = sceneStaging(world, {
      currentState: true, floorCovered: (id) => !props.includes(id), floorLead: lead,
    });
    expect(floorItems.map(({ id }) => id).sort()).toEqual(props.toSorted());
    expect(floorItems[0].id).toBe(lead);
    for (const size of ["narrow", "short"])
      expect(floorItems.filter(({ spots }) => spots[size]).map(({ id }) => id))
        .toMatchObject([lead, expect.any(String), expect.any(String)]);
  });

  it("uses the current quest item before other actions and ignores covered clues", () => {
    const world = {
      actors: { vale: { place: "station" } },
      items: {
        bell: { holder: "station" }, lamp: { holder: "station" }, cloth: { holder: "bell" },
        log: { holder: "station" }, map: { holder: "station" },
      },
    };
    const cards = ["station", "bell", "cloth", "lamp", "log", "map"];
    const closed = (id) => id === "cloth" || id === "map";
    const actions = [
      { kind: "take", item: "bell", cards: ["bell"] },
      { kind: "read", item: "log", cards: ["log"] },
      { kind: "cover", item: "cloth", cards: ["cloth", "bell"] },
    ];
    expect(roomItemLead(world, cards, [{ target: "lamp" }], actions, closed)).toBe("lamp");
    expect(roomItemLead(world, cards, [{ target: "map" }, { target: "bell", face: "down" }], actions, closed)).toBe("log");
    expect(roomItemLead(world, cards, [], [actions[0], actions[2]], closed)).toBe("bell");
    expect(revealedCover("cloth", closed)).toBeNull();
    expect(revealedCover("cloth", () => false)).toBe("cloth");
  });

  it("fades a revealed figure in, or shows it at once under reduced motion", () => {
    const element = { animate: vi.fn(() => "fade") };
    expect(fadeInRevealed(element)).toBe("fade");
    expect(element.animate.mock.calls[0][1].duration).toBe(STAGE_REVEAL_MS);
    expect(fadeInRevealed(element, { reduced: true })).toBe(null);
    expect(element.animate).toHaveBeenCalledTimes(1);
  });
});
