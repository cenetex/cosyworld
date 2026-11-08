import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStore } from "../v2/scripts/card-store.mjs";
const roots = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-store-"));
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
    .forEach((r) => fs.rmSync(r, { recursive: true, force: true })),
);
const read = (r, file) =>
  JSON.parse(fs.readFileSync(path.join(r, file), "utf8"));
const write = (r, file, data) =>
  fs.writeFileSync(path.join(r, file), JSON.stringify(data));
const asset = "card-game/assets/sample/nested/pixel.png";

it("keeps the unconnected catalog empty", () => {
  expect(verifyStore(fileURLToPath(new URL("../v2", import.meta.url)))).toEqual(
    [],
  );
});

it("verifies nested assets, then excludes an unmounted pack", () => {
  const root = fixture();
  expect(verifyStore(root).map(({ entry }) => entry.id)).toEqual(["sample"]);
  const index = read(root, "worldpacks/store.json");
  index.packs[0].mounted = false;
  write(root, "worldpacks/store.json", index);
  expect(() => verifyStore(root)).toThrow(/manifest/);
  verifyStore(root, { check: false });
  expect(verifyStore(root)).toEqual([]);
});
it.each(["removed", "added", "stale"])(
  "rejects %s manifest entries",
  (change) => {
    const root = fixture();
    const file =
      change === "removed"
        ? "worldpacks/store.json"
        : "worldpacks/vendor-manifest.json";
    const data = read(root, file);
    if (change === "removed") data.packs = [];
    if (change === "added") data.packs.push({ id: "unverified" });
    if (change === "stale") data.packs[0].pinned.sha256 = "0".repeat(64);
    write(root, file, data);
    expect(() => verifyStore(root)).toThrow(/manifest/);
  },
);
it.each(["changed", "missing", "extra"])(
  "rejects %s published assets in both modes",
  (change) => {
    const root = fixture();
    if (change === "changed")
      fs.appendFileSync(path.join(root, asset), "tamper");
    if (change === "missing") fs.unlinkSync(path.join(root, asset));
    if (change === "extra")
      fs.writeFileSync(
        path.join(root, asset.replace("pixel", "extra")),
        "extra",
      );
    for (const check of [true, false])
      expect(() => verifyStore(root, { check })).toThrow(/Published assets/);
  },
);
it.each(["contract", "revision", "mounted", "traversal", "commit", "unknown"])(
  "rejects invalid %s metadata",
  (change) => {
    const root = fixture();
    const data = read(root, "worldpacks/store.json");
    const entry = data.packs[0];
    if (change === "contract") entry.pinned.contract = "unsupported/999";
    if (change === "revision") entry.pinned.revision = 999;
    if (change === "mounted") entry.mounted = "false";
    if (change === "traversal") entry.id = "../escape";
    if (change === "commit") entry.source.commit = "0".repeat(40);
    if (change === "unknown") entry.path = "../escape";
    write(root, "worldpacks/store.json", data);
    expect(() => verifyStore(root)).toThrow();
  },
);
it.each(["vendor", "published"])(
  "rejects a %s symlink even when the bytes match",
  (side) => {
    const root = fixture();
    const from =
      side === "vendor" ? "worldpacks/sample/assets/nested/pixel.png" : asset;
    const to =
      side === "vendor" ? asset : "worldpacks/sample/assets/nested/pixel.png";
    fs.unlinkSync(path.join(root, from));
    fs.symlinkSync(path.join(root, to), path.join(root, from));
    expect(() => verifyStore(root)).toThrow(/symlink/);
  },
);
it.each(["commit", "sha256"])("rejects array-valued %s pins", (field) => {
  const root = fixture();
  for (const name of ["store.json", "vendor-manifest.json"]) {
    const data = read(root, `worldpacks/${name}`);
    const entry = data.packs[0];
    const pin = field === "commit" ? entry.source : entry.pinned;
    pin[field] = [pin[field]];
    write(root, `worldpacks/${name}`, data);
  }
  expect(() => verifyStore(root)).toThrow(/Pin an exact|Invalid contract/);
});
it.each(["tamper", "executable", "oversize", "missing-provenance"])(
  "rejects %s payloads",
  (change) => {
    const root = fixture();
    const file = path.join(root, "worldpacks/sample/assets/nested/pixel.png");
    if (change === "tamper") fs.appendFileSync(file, "tamper");
    if (change === "executable") fs.chmodSync(file, 0o755);
    if (change === "oversize") fs.truncateSync(file, 16 * 1024 * 1024 + 1);
    if (change === "missing-provenance")
      fs.unlinkSync(path.join(root, "worldpacks/sample/PROVENANCE.md"));
    expect(() => verifyStore(root)).toThrow();
  },
);
