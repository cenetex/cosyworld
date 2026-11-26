import { afterEach, expect, it, vi } from "vitest";
import { createElysiumPortrait } from "../v2/card-game/elysium-portrait.mjs";

afterEach(() => vi.unstubAllGlobals());

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
