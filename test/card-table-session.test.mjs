import { expect, it, vi } from "vitest";
import { openTableSession } from "../v2/card-game/table-session.mjs";
import { SAVE_BASE } from "../v2/card-game/avatar-world.mjs";

it("keeps local table slots distinct and rejects invalid slot names", async () => {
  const connect = vi.fn();
  for (const [query, suffix] of [
    ["", ""],
    ["?table=night-2", ".night-2"],
    ["?table=bad.name", ""],
  ]) {
    const session = await openTableSession(
      `https://example.test/${query}`,
      connect,
    );
    expect(session.saveKey).toBe(SAVE_BASE + suffix);
    expect(session.sharedSession).toBeNull();
  }
  expect(connect).not.toHaveBeenCalled();
});

it("connects the linked shared world before choosing its actor's slot", async () => {
  const shared = { state: { actor: "mara", world: {} } };
  const connect = vi.fn(async () => shared);
  const session = await openTableSession(
    "https://example.test/?world=friend%20world&table=local",
    connect,
  );
  expect(connect).toHaveBeenCalledWith("friend world");
  expect(session.sharedSession).toBe(shared);
  expect(session.saveKey).toBe(`${SAVE_BASE}.shared.friend world.mara`);
});

it("keeps a pack landing's save separate and gives a named table priority", async () => {
  const pack = await openTableSession("https://example.test/?pack=greek-drama");
  expect(pack.startingPack.id).toBe("greek-drama");
  expect(pack.saveKey).toBe(`${SAVE_BASE}.pack.greek-drama`);
  const table = await openTableSession(
    "https://example.test/?pack=greek-drama&table=night",
  );
  expect(table.saveKey).toBe(`${SAVE_BASE}.night`);
});
