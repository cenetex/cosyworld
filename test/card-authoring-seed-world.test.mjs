import { it, expect } from "vitest";
import {
  emptySeedWorld,
  seedEdit,
  seedContext,
} from "../v2/card-game/authoring-seed-world.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
const cards = [
  { kind: "avatar", name: "Mara", text: "A ferry keeper looking for a lamp." },
  { kind: "item", name: "Lamp", text: "Blue glass keeps the flame steady." },
  { kind: "place", name: "Quay", text: "The last ferry waits here." },
];
function fixture() {
  let serial = 0,
    saved,
    fail = false;
  const session = createAuthoringSession({
    store: {
      write: async (_key, record, generation) => {
        if (fail) throw new Error("disk full");
        saved = structuredClone(record);
        return generation + 1;
      },
    },
  });
  session.open({ key: "test", record: { ...emptySeedWorld(), generation: 0 } });
  const prepare = (input) =>
    seedEdit(session.snapshot(), input, () => `made-${++serial}`);
  return {
    session,
    prepare,
    saved: () => saved,
    fail: (value) => {
      fail = value;
    },
  };
}
it("saves the trio atomically and retries the same prepared text", async () => {
  const f = fixture(),
    prepared = f.prepare({ kind: "world", cards });
  f.fail(true);
  await expect(f.session.accept(prepared)).rejects.toThrow("disk full");
  expect(f.session.snapshot().draft.pack.avatars).toEqual({});
  f.fail(false);
  await f.session.accept(prepared);
  const before = f.session.snapshot();
  expect(before.draft.pack.avatars["made-2"].want).toEqual({
    kind: "item",
    target: "made-3",
  });
  expect(before.draft.pack.items["made-3"].holder).toBe("made-1");
  expect(before.launch.place).toBe("made-1");
  f.session.open({ key: "test", record: { ...f.saved(), generation: 1 } });
  expect(f.session.snapshot()).toEqual(before);
  await f.session.accept(
    f.prepare({
      kind: "item",
      replacing: "made-3",
      cards: [{ ...cards[1], name: "Bell" }],
    }),
  );
  expect(f.session.snapshot().draft.pack.avatars).toEqual(
    before.draft.pack.avatars,
  );
  f.session.dispatch({ type: "undo" });
  expect(f.session.snapshot().draft).toEqual(before.draft);
});
it("repairs custody, routes and quests when a card is discarded", async () => {
  const f = fixture();
  await f.session.accept(f.prepare({ kind: "world", cards }));
  const want = f.session.snapshot().draft.pack.avatars["made-2"].want;
  await f.session.accept(f.prepare({ kind: "place", discard: "made-1" }));
  expect(f.session.snapshot().draft.pack.avatars["made-2"].want).toEqual(want);
  f.session.dispatch({ type: "undo" });
  await f.session.accept(
    f.prepare({ kind: "place", cards: [{ ...cards[2], name: "Garden" }] }),
  );
  const before = f.session.snapshot();
  await f.session.accept(f.prepare({ kind: "place", discard: "made-1" }));
  const pack = f.session.snapshot().draft.pack;
  expect(pack.entry).toBe("made-4");
  expect(pack.places["made-4"].exits).toEqual([]);
  expect(pack.items["made-3"].holder).toBe("made-4");
  expect(pack.avatars["made-2"].place).toBe("made-4");
  f.session.dispatch({ type: "undo" });
  expect(f.session.snapshot().draft).toEqual(before.draft);
  await f.session.accept(f.prepare({ kind: "item", discard: "made-3" }));
  expect(
    f.session.snapshot().draft.pack.avatars["made-2"].want,
  ).toBeUndefined();
});
it("respects a discarded quest and rejects stale or malformed proposals", async () => {
  const f = fixture();
  await f.session.accept(f.prepare({ kind: "world", cards }));
  await f.session.accept(f.prepare({ quest: "made-2", discard: true }));
  const stale = f.prepare({
    kind: "item",
    cards: [{ ...cards[1], name: "Key" }],
  });
  await f.session.accept(
    f.prepare({ kind: "item", cards: [{ ...cards[1], name: "Bell" }] }),
  );
  await expect(f.session.accept(stale)).rejects.toThrow("draft changed");
  expect(
    f.session.snapshot().draft.pack.avatars["made-2"].want,
  ).toBeUndefined();
  expect(() => f.prepare({ kind: "avatar", cards: [cards[0]] })).toThrow(
    "fresh name",
  );
  expect(() => f.prepare({ kind: "item", cards: [cards[0]] })).toThrow(
    "requested kind",
  );
  expect(seedContext(f.session.state.source, "made-2")[0].text).toContain(
    "At Quay",
  );
  expect(seedContext(f.session.state.source, "made-2")).toHaveLength(4);
  const record = f.session.snapshot();
  record.draft.pack.routes = [{ from: "made-1", to: "made-1" }];
  expect(() => seedEdit(record, { kind: "place", discard: "made-1" })).toThrow(
    "linked rules",
  );
});
