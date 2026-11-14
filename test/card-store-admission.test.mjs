import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admitStore } from "../v2/scripts/card-store-admission.mjs";

const roots = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-admission-"));
  roots.push(root);
  fs.cpSync(
    fileURLToPath(new URL("./fixtures/card-store", import.meta.url)),
    root,
    { recursive: true },
  );
  return root;
};
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
const table = () => ({
  hub: { switchable: { shore: { name: "Shore", packs: ["hub"] } } },
});
const change = (root, file, update) => {
  const target = path.join(root, file);
  const data = JSON.parse(fs.readFileSync(target, "utf8"));
  update(data);
  fs.writeFileSync(target, JSON.stringify(data));
};

it("admits the verified payload and preserves native groups", () => {
  const hub = table();
  const [[id, world, bridge]] = admitStore(fixture(), hub, { check: true });
  expect(id).toBe("sample");
  expect(world.id).toBe(id);
  expect(bridge.pack).toBe(id);
  expect(hub.hub.switchable.sample.packs).toEqual([id]);
  expect(hub.hub.switchable.shore).toEqual(table().hub.switchable.shore);
});

it("does not admit an unmounted pack or leave its switch behind", () => {
  const root = fixture();
  change(root, "worldpacks/store.json", (data) => {
    data.packs[0].mounted = false;
  });
  const hub = table();
  expect(admitStore(root, hub, { check: false })).toEqual([]);
  expect(admitStore(root, table(), { check: true })).toEqual([]);
  expect(hub).toEqual(table());
});

it.each(["index", "asset", "proof"])(
  "rejects %s tampering before compiler admission",
  (kind) => {
    const root = fixture();
    if (kind === "index")
      change(root, "worldpacks/store.json", (data) => {
        data.packs = [];
      });
    if (kind === "asset")
      fs.appendFileSync(
        path.join(root, "card-game/assets/sample/nested/pixel.png"),
        "tamper",
      );
    if (kind === "proof")
      change(root, "worldpacks/store.json", (data) => {
        data.packs[0].source.commit = "a".repeat(40);
      });
    const hub = table();
    expect(() => admitStore(root, hub, { check: true })).toThrow();
    expect(hub).toEqual(table());
  },
);

it("rejects a group collision without replacing the hub", () => {
  const hub = table();
  hub.hub.switchable.sample = { name: "Existing", packs: ["hub"] };
  const original = structuredClone(hub);
  expect(() => admitStore(fixture(), hub, { check: true })).toThrow(
    /conflicts/,
  );
  expect(hub).toEqual(original);
});
