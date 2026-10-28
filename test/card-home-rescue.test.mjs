import { describe, it, expect } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  placeText,
  willingToGive,
} from "../v2/card-game/world.mjs";
import { enableMotives, recordReaction } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatars, humanAvatarIds } from "../v2/card-game/human-cast.mjs";

const opening = () => createWorld({ opening: true });
const view = (world, actor, present = humanAvatarIds) =>
  dispatchShared({
    op: "view",
    world,
    actor,
    claimed: humanAvatarIds,
    present,
  });
const shared = () =>
  dispatchShared({ op: "create", save: encodeSave(createWorld()) }).world;
const move = (state, actor, target) =>
  legalActions(state, actor).find(
    (a) => a.kind === "move" && a.target === target,
  );

describe("a path out of a stranded home", () => {
  it("keeps a fueled, unlit or covered lamp as an ordinary recovery", () => {
    for (const covered of [false, true]) {
      const s = opening();
      if (covered) s.items.cloth.holder = "lamp";
      expect(exits(s, "attic", "vale")).toEqual([]);
      expect(placeText(s, "attic")).not.toContain("narrow path");
    }
  });
  it("offers the station after fuel runs dry and survives a solo save", () => {
    let s = opening();
    s.items.lamp.fuel = 0;
    s.items.lamp.lit = false;
    s = decodeSave(encodeSave(s));
    expect(exits(s, "attic", "vale")).toEqual(["station"]);
    expect(placeText(s, "attic")).toContain(
      "A narrow path leads to Empty station.",
    );
    const result = play(s, move(s, "vale", "station"));
    expect(result.ok).toBe(true);
    expect(result.state.actors.vale.place).toBe("station");
    expect(result.state.items.lamp.fuel).toBe(0);
    const restored = decodeSave(encodeSave(result.state));
    const continued = play(restored, move(restored, "vale", "pond"));
    expect(continued.ok).toBe(true);
    expect(continued.state.actors.vale.place).toBe("pond");
    expect(() => decodeSave(encodeSave(continued.state))).not.toThrow();
  });
  it("keeps local usable oil as recovery and spends it through the ordinary action", () => {
    const s = opening();
    s.items.lamp.fuel = 0;
    s.items.oil.holder = "attic";
    expect(exits(s, "attic", "vale")).toEqual([]);
    const refill = legalActions(s, "vale").find((a) => a.kind === "refill");
    expect(refill).toBeDefined();
    expect(play(s, refill).state.items.lamp.fuel).toBeGreaterThan(0);
    s.items.oil.doses = 0;
    expect(exits(s, "attic", "vale")).toEqual(["station"]);
  });
  it("uses local floor and nested resources while distant resources leave a path", () => {
    const s = opening();
    s.items.lamp.fuel = 0;
    s.items.oil.holder = "attic";
    s.items.cloth.holder = "lamp";
    expect(exits(s, "attic", "vale")).toEqual([]);
    s.items.oil.holder = "station";
    expect(exits(s, "attic", "vale")).toEqual(["station"]);
    s.items.lamp.holder = "station";
    s.items.lamp.fuel = 8;
    expect(exits(s, "attic", "vale")).toEqual(["station"]);
  });
  it.each(humanAvatars.filter((a) => a.id !== "vale"))(
    "uses the same rule in $name's home",
    (avatar) => {
      const w = shared();
      const home = avatar.home.id,
        item = avatar.item.id;
      expect(view(w, avatar.id).exits).toEqual([]);
      w.items[item].holder = "station";
      const stranded = view(w, avatar.id);
      expect(stranded.exits).toEqual(["station"]);
      const action = stranded.actions.find(
        (a) => a.kind === "move" && a.target === "station",
      );
      const result = dispatchShared({
        op: "play",
        world: w,
        actor: avatar.id,
        claimed: humanAvatarIds,
        present: humanAvatarIds,
        action,
      });
      expect(result.ok).toBe(true);
      expect(result.world.actors[avatar.id].place).toBe("station");
      expect(result.world.items[item].holder).toBe("station");
      w.items[item].holder = home;
      expect(view(w, avatar.id).exits).toEqual([]);
      w.items[item].holder = "vale";
      w.actors.vale.place = home;
      expect(view(w, avatar.id).exits).toEqual([
        avatar.home.connection || "pond",
      ]);
      expect(
        view(
          w,
          avatar.id,
          humanAvatarIds.filter((a) => a !== "vale"),
        ).exits,
      ).toEqual(["station"]);
      w.actors.vale.place = "pond";
      expect(view(w, avatar.id).exits).toEqual(["station"]);
    },
  );
  it("counts present helpers' lamp and oil and keeps absence meaningful", () => {
    const w = dispatchShared({ op: "create" }).world;
    w.actors.mara.place = "attic";
    w.items.lamp.fuel = 0;
    w.items.oil.holder = "mara";
    expect(view(w, "vale").exits).toEqual([]);
    expect(view(w, "vale", ["vale"]).exits).toEqual(["station"]);
    w.items.oil.holder = "attic";
    w.items.lamp.holder = "mara";
    expect(view(w, "vale").exits).toEqual([]);
    expect(view(w, "vale", ["vale"]).exits).toEqual(["station"]);
  });
  it("keeps crowding as a wait and respects station capacity", () => {
    const w = shared();
    const a = humanAvatars[1];
    w.items[a.item.id].holder = a.id;
    for (const id of ["vale", "ash", "nell", "tavi"])
      w.actors[id].place = "pond";
    expect(view(w, a.id).exits).toEqual([]);
    w.items[a.item.id].holder = "attic";
    for (const id of ["vale", "ash", "nell", "tavi"])
      w.actors[id].place = "station";
    expect(view(w, a.id).exits).toEqual([]);
    w.actors.tavi.place = "pond";
    expect(view(w, a.id).exits).toEqual(["station"]);
  });
  it("keeps accepted resident gifts and trades as real recovery routes", () => {
    for (const kind of ["ask", "trade"]) {
      const s = enableMotives(opening());
      s.opening.crossed = true;
      s.opening.met.moth = s.opening.met.keeper = 0;
      s.locations.attic.anchored = true;
      s.actors.keeper.place = "attic";
      s.items.lamp.holder = "keeper";
      s.items.bell.holder = "vale";
      if (kind === "trade") {
        recordReaction(s, { kind: "ring", actor: "vale", item: "bell" }, [
          "keeper",
        ]);
        expect(willingToGive(s, "keeper", "lamp", "vale")).toBe(false);
      }
      expect(exits(s, "attic", "vale")).toEqual([]);
      const action = legalActions(s, "vale").find(
        (a) =>
          a.kind === kind &&
          (kind === "ask" ? a.item === "lamp" : a.receive === "lamp"),
      );
      expect(action).toBeDefined();
      const result = play(s, action);
      expect(result.ok).toBe(true);
      expect(result.state.items.lamp.holder).toBe("vale");
    }
    const refused = opening();
    refused.opening.crossed = true;
    refused.opening.met.moth = 0;
    refused.locations.attic.anchored = true;
    refused.actors.moth.place = "attic";
    refused.items.lamp.holder = "moth";
    expect(willingToGive(refused, "moth", "lamp", "vale")).toBe(false);
    expect(
      legalActions(refused, "vale").some(
        (a) => a.kind === "trade" && a.receive === "lamp",
      ),
    ).toBe(false);
    expect(exits(refused, "attic", "vale")).toEqual(["station"]);
  });
  it("offers rescue only for the human who stands in the queried home", () => {
    const s = opening();
    s.items.lamp.fuel = 0;
    expect(exits(s, "attic", "vale")).toEqual(["station"]);
    s.actors.vale.place = "station";
    expect(exits(s, "attic", "vale")).toEqual([]);
    expect(placeText(s, "attic")).not.toContain("narrow path");
  });
  it("keeps recovery limited to home rooms and controlled humans", () => {
    const s = opening();
    s.items.lamp.fuel = 0;
    expect(exits(s, "attic", "moth")).toEqual([]);
    expect(exits(s, "pond", "vale")).toEqual([
      "station",
      "hoppycat-halfway-tea-garden",
    ]);
    expect(move(s, "vale", "pond")).toBeUndefined();
  });
});
