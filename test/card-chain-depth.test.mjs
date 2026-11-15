import { describe, it, expect } from "vitest";
import { chainDepth, depthReport } from "../v2/scripts/card-chain-depth.mjs";

const place = (name, exits) => ({ name, exits });
const flag = (key) => ({ kind: "flag", key, value: true });
const setter = (id, key, requires = []) => ({ id, subject: "p1", requires, effects: [{ kind: "set_flag", key, value: true }] });
const item = (holder, locked) => ({ name: "I", holder, ...(locked ? { locked } : {}) });
const find = (out, id) => out.rows.find((r) => r.id === id);

function run(pack) {
  const packsJson = {
    hub: { player: "vale", start: "pond", places: ["pond"], avatars: ["vale"], items: [], packEntries: {} },
    packs: [{ id: "t", entry: "a", places: { a: place("A", ["b"]), b: place("B", ["a"]) }, avatars: { p1: { name: "P", place: "a" } }, ...pack }],
  };
  const forest = { places: { pond: place("Pond", []) }, people: { vale: { name: "Vale" } }, opening: { actors: { vale: { place: "pond" } } } };
  return chainDepth(packsJson, forest);
}

describe("card chain depth", () => {
  it("counts a chain of three locked items", () => {
    const out = run({ items: { one: item("a"), two: item("a", { by: "p1", consumes: ["one"] }), three: item("a", { by: "p1", consumes: ["two"] }), four: item("a", { by: "p1", consumes: ["three"] }) } });
    expect(find(out, "item:two").depth).toBe(1);
    expect(find(out, "item:three").depth).toBe(2);
    expect(find(out, "item:four").depth).toBe(3);
    expect(out.all.longest).toBe(3);
    expect(out.all.path).toEqual(["item:two", "item:three", "item:four"]);
    expect(depthReport(out)).toMatch(/longest chain item:two -> item:three -> item:four/);
  });
  it("returns on a cycle and names it", () => {
    const out = run({ items: { x: item("a", { by: "p1", consumes: ["y"] }), y: item("a", { by: "p1", consumes: ["x"] }) } });
    expect(out.all.cycle.sort()).toEqual(["item:x", "item:y"]);
    expect(out.all.mystery).toEqual([]);
  });
  it("reports a flag with no setter as mystery and what hangs on it as behind mystery", () => {
    const out = run({
      avatars: { p1: { name: "P", place: "a" }, g: { name: "G", place: "b", sealed: { at: "b" }, requires: [flag("nowhere")] } },
      items: { k: item("g"), lk: item("a", { by: "p1", consumes: ["k"] }) },
    });
    expect(out.all.mystery).toEqual(["person:g"]);
    expect(out.all.behind).toEqual(["item:lk"]);
  });
  it("follows a flag to the choice that sets it", () => {
    const out = run({
      avatars: { p1: { name: "P", place: "a" }, g: { name: "G", place: "b", sealed: { at: "b" }, requires: [flag("ok")] } },
      items: { one: item("a"), two: item("a", { by: "p1", consumes: ["one"] }) },
      choices: [setter("c1", "ok", [{ kind: "holding", item: "two", role: "actor" }])],
    });
    expect(find(out, "person:g").depth).toBe(2);
  });
});
