import { afterEach, expect, it, vi } from "vitest";
import { createElysiumPortrait } from "../v2/card-game/elysium-portrait.mjs";
import { forgetSigned, rememberSigned } from "../v2/card-game/signed-words.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  forgetSigned();
});

const resident = "elysium-claude";
const room = "elysium-void-002";

it("covers different resident aliases without a shared identity response", () => {
  const display = createElysiumPortrait(null, () => {});
  expect(display.name(resident)).toBe("???");
  expect(display.name("elysium-gemini")).toBe("???");
  expect(display.name("elysium-resident")).toBeNull();
  expect(display.text("Talk to the Resident of Void 002 or the resident of Void 003."))
    .toBe("Talk to ??? or ???.");
});

it("waits for the first real reply before fetching the resident's name", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "Amber Thread" }),
  });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", fetch);
  const display = createElysiumPortrait("world", () => {});
  const world = {
    actors: { vale: { place: room, visited: [room] }, [resident]: { place: room } },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: null } },
    revision: 1,
  };
  display.observe(world, "vale", null);
  world.elysiumEncounters[resident].talkedAt = 11;
  world.revision++;
  display.observe(world, "vale", null);
  display.observe(world, "vale", { actorId: resident, generated: true, silent: true, seq: 12 });
  expect(display.name(resident)).toBe("???");
  expect(fetch).not.toHaveBeenCalled();

  world.actors.vale.place = "station";
  world.revision++;
  display.observe(world, "vale", null);
  expect(fetch).not.toHaveBeenCalled();

  world.actors.vale.place = room;
  world.revision++;
  display.observe(world, "vale", { actorId: resident, generated: true, seq: 13 });
  await vi.waitFor(() => expect(display.name(resident)).toBe("Amber Thread"));
  expect(fetch).toHaveBeenCalledOnce();
  expect(display.text("Talk to the Resident of Void 002.")).toBe("Talk to Amber Thread.");
  expect(display.name("elysium-gemini")).toBe("???");
});

it.each([
  { visited: [room, "station"], talked: [] },
  { visited: ["station"], talked: [resident] },
])("restores a known name offsite from $visited and $talked without loading the portrait", async (history) => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "Amber Thread" }),
  });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("fetch", fetch);
  const world = {
    actors: {
      vale: { place: "station", ...history },
      mara: { place: "pond", visited: ["pond"] },
      [resident]: { place: room },
    },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: 11, returnedAt: 14 } },
    revision: 2,
  };
  const display = createElysiumPortrait("world", () => {});
  display.observe(world, "vale", null);
  await vi.waitFor(() => expect(display.name(resident)).toBe("Amber Thread"));
  expect(display.text("Bring the token to the Resident of Void 002."))
    .toBe("Bring the token to Amber Thread.");

  world.revision++;
  display.observe(world, "vale", null);
  const visitor = createElysiumPortrait("world", () => {});
  visitor.observe(world, "mara", null);
  expect(visitor.name(resident)).toBe("???");
  expect(fetch.mock.calls.map(([url]) => url))
    .toEqual([`/card-game/shared/worlds/world/elysium-identity/${resident}`]);
});

it("learns a signed personal introduction after a later direct Talk and remembers it for this save", async () => {
  const records = new Map();
  const storage = { getItem: (key) => records.get(key), setItem: (key, value) => records.set(key, value) };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const redraw = vi.fn();
  const display = createElysiumPortrait(null, redraw, "table-one", storage);
  const world = {
    run: { seed: 440 }, turn: 5, revision: 7, eventSeq: 22,
    actors: { vale: { place: room }, [resident]: { place: room } },
    elysiumEncounters: { [resident]: { scatteredAt: 10, talkedAt: 11 } },
    log: [{ seq: 20, turn: 5, verb: "talk", actorId: "vale", targetId: resident }],
  };
  const line = {
    actorId: resident, turn: 5, seq: 22, kind: "dialogue", generated: true, locationId: room,
    text: "I call myself Amber  Silver-Lens. My token has slipped into the world beyond this Void.",
  };
  const blur = (text) => text.replace("Lens", "something");
  const read = display.reader(blur, () => false);
  const context = { outcome: { card: { kind: "talk", target: resident } } };
  display.observe(world, "vale", null);
  display.observe(world, "vale", { ...line, text: "A thread is caught in the dark." });
  display.observe(world, "vale", line);
  expect(display.name(resident)).toBe("???");
  expect(read(line.text, line)).toBe(blur(line.text));
  expect(display.withIntroduction(context)).toBe(context);
  const sign = (claims) => rememberSigned({ entries: [{ id: resident, text: line.text,
    signed: { sig: "test-signature", claims: { kind: "line", entity: resident, world: "local", turn: 5, seq: 7, ...claims } },
  }] }, storage);
  sign({ world: "another-world" });
  display.observe(world, "vale", line);
  expect(display.name(resident)).toBe("???");
  sign();
  expect(read(line.text, line)).toBe(line.text);
  expect(display.reader(blur, () => true)(line.text, line)).toBe(blur(line.text));
  const other = { ...line, text: "The Lens lies far from here." };
  expect(read(other.text, other)).toBe(blur(other.text));
  display.observe(world, "vale", { ...line, silent: true });
  display.observe({ ...world, log: [] }, "vale", line);
  expect(display.name(resident)).toBe("???");
  display.observe(world, "vale", line);
  await Promise.resolve();
  expect(redraw).toHaveBeenCalledOnce();
  expect(display.name(resident)).toBe("Amber Silver-Lens");
  expect(display.text("Bring the token to the Resident of Void 002.")).toBe("Bring the token to Amber Silver-Lens.");
  expect(display.withIntroduction(context)).toEqual({ ...context, elysiumIntroduced: resident });
  const otherTalk = { outcome: { card: { kind: "talk", target: "elysium-gemini" } } };
  expect(display.withIntroduction(otherTalk)).toBe(otherTalk);

  forgetSigned();
  const restored = createElysiumPortrait(null, () => {}, "table-one", storage);
  const later = { ...world, log: [], actors: { ...world.actors, vale: { place: "pond" } } };
  restored.sync(later);
  expect(restored.name(resident)).toBe("Amber Silver-Lens");
  restored.sync({ ...later, eventSeq: 15 });
  expect(restored.name(resident)).toBe("???");
  restored.sync({ ...later, run: { seed: 441 } });
  expect(restored.name(resident)).toBe("???");
  const anotherTable = createElysiumPortrait(null, () => {}, "table-two", storage);
  anotherTable.sync(later);
  expect(anotherTable.name(resident)).toBe("???");
  expect(fetch).not.toHaveBeenCalled();
});
