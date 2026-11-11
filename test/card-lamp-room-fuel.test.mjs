import { describe, expect, it } from "vitest";
import {
  filledLampRoomFuel,
  roomFuelFromTurns,
  settleLampRoomFuel,
  validLampRoomFuel,
  lampRoomFlame,
} from "../v2/card-game/lamp-room-fuel.mjs";

const hold = (state, place = state.fuelPlace) =>
  settleLampRoomFuel(state, { place, held: true });
const stow = (state, place = state.fuelPlace) =>
  settleLampRoomFuel(state, { place });
const putDown = (state, place = state.fuelPlace) =>
  settleLampRoomFuel(state, { place, grounded: true });
const reload = (state) => JSON.parse(JSON.stringify(state));

describe("inactive three-room lamp fuel", () => {
  it("counts the filled room first and goes out on a fourth lit visit", () => {
    let state = hold(filledLampRoomFuel("attic"));
    expect([state.fuelRooms, lampRoomFlame(state)]).toEqual([
      3,
      "A steady flame",
    ]);
    state = hold(state, "pond");
    expect([state.fuelRooms, lampRoomFlame(state)]).toEqual([
      2,
      "A smaller flame",
    ]);
    state = hold(state, "station");
    expect([state.fuelRooms, lampRoomFlame(state)]).toEqual([1, "A low flame"]);
    state = hold(state, "pond");
    expect([state.fuelRooms, lampRoomFlame(state)]).toEqual([0, "Unlit"]);
  });
  it("counts returns, not unique room IDs", () => {
    let state = hold(filledLampRoomFuel("attic"));
    for (const place of ["pond", "attic", "pond"]) state = hold(state, place);
    expect(state.fuelRooms).toBe(0);
  });
  it("keeps each room lit for arbitrary waits and hand toggles", () => {
    for (const fuelRooms of [3, 2, 1]) {
      let state = { ...filledLampRoomFuel("pond"), fuelRooms };
      for (let i = 0; i < 50; i++) {
        state = hold(stow(hold(state)));
        expect(state).toMatchObject({ fuelRooms, lit: true });
      }
    }
  });
  it("defers stowed travel until the destination is illuminated", () => {
    let state = stow(hold(filledLampRoomFuel("attic")));
    for (const place of ["pond", "station", "clearing"])
      state = stow(state, place);
    expect(state).toMatchObject({ fuelRooms: 3, fuelVisit: false, lit: false });
    state = hold(reload(state));
    expect(state).toMatchObject({ fuelRooms: 2, fuelVisit: true, lit: true });
    expect(hold(stow(state))).toEqual(state);
  });
  it("charges a later visit even when stowed travel returns to the last lit room", () => {
    let state = stow(hold(filledLampRoomFuel("attic")), "pond");
    state = stow(state, "attic");
    expect(hold(state).fuelRooms).toBe(2);
  });
  it("keeps a grounded lamp lit and pickup costs nothing", () => {
    let state = putDown(filledLampRoomFuel("pond"));
    for (let i = 0; i < 50; i++) state = putDown(state);
    expect(hold(state)).toEqual(state);
    expect(state).toMatchObject({ fuelRooms: 3, lit: true });
    expect(putDown(hold(stow(state)))).toEqual(state);
  });
  it("has the same movement rule for an NPC, player, or transport carrier", () => {
    const route = ["pond", "greek-ship", "greek-harbor"];
    // The adapter supplies actual lamp places, never the viewer's camera.
    const moved = route.reduce(
      (state, place) => hold(state, place),
      filledLampRoomFuel("station"),
    );
    expect(moved).toMatchObject({
      fuelRooms: 0,
      lit: false,
      fuelPlace: "greek-harbor",
    });
  });
  it("keeps an exhausted lamp dark through more moves and hand changes", () => {
    let state = roomFuelFromTurns(0, "attic");
    for (const place of ["pond", "station", "attic"]) {
      state = putDown(hold(stow(state, place)));
      expect(state).toMatchObject({ fuelRooms: 0, lit: false });
    }
  });
  it("a refill includes its current room even while stowed", () => {
    const empty = hold(roomFuelFromTurns(0, "pond"));
    const before = reload(empty);
    const full = stow(filledLampRoomFuel(empty.fuelPlace));
    expect(full).toMatchObject({ fuelRooms: 3, fuelVisit: true, lit: false });
    expect(hold(full).fuelRooms).toBe(3);
    expect(hold(full, "attic").fuelRooms).toBe(2);
    expect(empty).toEqual(before);
  });
  it("reloads do not reset a charged visit or spend a pending dark one", () => {
    for (const state of [
      hold(filledLampRoomFuel("attic"), "pond"),
      stow(filledLampRoomFuel("attic"), "pond"),
    ]) {
      const saved = reload(state);
      expect(validLampRoomFuel(saved)).toBe(true);
      expect(hold(saved)).toEqual(hold(state));
      expect(stow(saved)).toEqual(stow(state));
    }
  });
  it("never mutates input fuel or unrelated records", () => {
    const state = Object.freeze({
      ...filledLampRoomFuel("attic"),
      holder: "vale",
      history: Object.freeze(["Earlier event."]),
    });
    const before = JSON.stringify(state);
    expect(hold(state, "pond")).toEqual({
      fuelRooms: 2,
      fuelPlace: "pond",
      fuelVisit: true,
      lit: true,
    });
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
    [12, 3],
  ])("maps released turn fuel %s to %s room visits", (oldFuel, rooms) => {
    expect(roomFuelFromTurns(oldFuel, "attic")).toEqual({
      fuelRooms: rooms,
      fuelPlace: "attic",
      fuelVisit: true,
    });
  });
  it.each([undefined, null, -1, 13, 1.5, NaN, Infinity, "12"])(
    "rejects unsupported legacy fuel %s",
    (fuel) => {
      expect(() => roomFuelFromTurns(fuel, "attic")).toThrow();
    },
  );
  it("rejects malformed fuel, locations, or physical positions", () => {
    const state = filledLampRoomFuel("attic");
    for (const damage of [
      { fuelRooms: -1 },
      { fuelRooms: 4 },
      { fuelRooms: 1.5 },
      { fuelVisit: 1 },
      { fuelPlace: "" },
    ]) {
      const bad = { ...state, ...damage };
      expect(validLampRoomFuel(bad)).toBe(false);
      expect(() => hold(bad)).toThrow();
    }
    expect(() => filledLampRoomFuel("")).toThrow();
    expect(() => hold(state, null)).toThrow();
    expect(() =>
      settleLampRoomFuel(state, { place: "attic", held: true, grounded: true }),
    ).toThrow();
    expect(() =>
      settleLampRoomFuel(state, { place: "attic", held: 1 }),
    ).toThrow();
    expect(() => lampRoomFlame(state)).toThrow();
    expect(() =>
      lampRoomFlame({ ...state, fuelRooms: 0, lit: true }),
    ).toThrow();
  });
});
