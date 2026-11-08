import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanFiles, verifyStore } from "../v2/scripts/card-store.mjs";
import { installSnapshot } from "../v2/scripts/card-store-install.mjs";
const fixture = fileURLToPath(
  new URL("./fixtures/card-store/", import.meta.url),
);
const read = (root, relative) => fs.readFileSync(path.join(root, relative));
const proof = JSON.parse(read(fixture, "worldpacks/proofs/sample.json"));
const snapshot = () => ({
  proof: structuredClone(proof),
  files: scanFiles(path.join(fixture, "worldpacks/sample")).map((file) => ({
    path: file.path,
    bytes: read(fixture, `worldpacks/sample/${file.path}`),
  })),
});
const roots = [];
const setup = (existing = false) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-install-"));
  roots.push(root);
  fs.cpSync(fixture, root, { recursive: true });
  if (!existing) {
    for (const relative of [
      "worldpacks/sample",
      "worldpacks/proofs",
      "card-game/assets/sample",
    ])
      fs.rmSync(path.join(root, relative), { recursive: true });
    for (const relative of [
      "worldpacks/store.json",
      "worldpacks/vendor-manifest.json",
    ])
      fs.writeFileSync(
        path.join(root, relative),
        '{"schemaVersion":1,"packs":[]}\n',
      );
  }
  return root;
};
afterEach(() => {
  vi.restoreAllMocks();
  roots
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});
const noInstall = (root) => {
  for (const relative of [
    "worldpacks/sample",
    "worldpacks/proofs",
    "card-game/assets/sample",
    "worldpacks/.import.lock",
  ])
    expect(fs.existsSync(path.join(root, relative))).toBe(false);
  expect(
    fs
      .readdirSync(path.join(root, "worldpacks"))
      .some((name) => name.startsWith(".import-")),
  ).toBe(false);
};
it("installs exact verified bytes with mounted=false and an unchanged vendor manifest", () => {
  const root = setup();
  const manifest = read(root, "worldpacks/vendor-manifest.json");
  const entry = installSnapshot(root, proof.source, snapshot());
  expect(entry.mounted).toBe(false);
  expect(verifyStore(root)).toEqual([]);
  expect(read(root, "worldpacks/vendor-manifest.json")).toEqual(manifest);
  expect(scanFiles(path.join(root, "worldpacks/sample"))).toEqual(
    scanFiles(path.join(fixture, "worldpacks/sample")),
  );
});
it.each(["payload", "published", "proof", "case-collision", "symlink"])(
  "preserves an existing %s destination",
  (kind) => {
    const root = setup();
    if (kind === "symlink")
      fs.symlinkSync(setup(), path.join(root, "worldpacks/proofs"), "junction");
    const target = path.join(
      root,
      {
        payload: "worldpacks/sample/private-input",
        published: "card-game/assets/sample/private-input",
        proof: "worldpacks/proofs/sample.json",
        symlink: "worldpacks/proofs/sample.json",
        "case-collision": "card-game/assets/Sample/private-input",
      }[kind],
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "untouched");
    const index = read(root, "worldpacks/store.json");
    expect(() => installSnapshot(root, proof.source, snapshot())).toThrow(
      /destination|real directory/,
    );
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
    expect(read(root, "worldpacks/store.json")).toEqual(index);
  },
);
it("refuses an existing indexed pack and preserves its files", () => {
  const root = setup(true);
  const index = read(root, "worldpacks/store.json");
  expect(() => installSnapshot(root, proof.source, snapshot())).toThrow(
    /Existing/,
  );
  expect(read(root, "worldpacks/store.json")).toEqual(index);
  expect(verifyStore(root).map(({ entry }) => entry.id)).toEqual(["sample"]);
});
it.each(["bytes", "path"])(
  "rejects altered snapshot %s before writing",
  (kind) => {
    const root = setup();
    const incoming = snapshot();
    if (kind === "bytes") incoming.files[0].bytes = Buffer.from("tampered");
    else incoming.files[0].path = "../private-input";
    expect(() => installSnapshot(root, proof.source, incoming)).toThrow();
    noInstall(root);
  },
);
it("rolls back new paths after a late copy failure", () => {
  const root = setup();
  const index = read(root, "worldpacks/store.json");
  const copy = fs.cpSync;
  let copies = 0;
  vi.spyOn(fs, "cpSync").mockImplementation((...args) => {
    if (++copies === 2) throw new Error("simulated copy failure");
    return copy(...args);
  });
  expect(() => installSnapshot(root, proof.source, snapshot())).toThrow(
    /copy failure/,
  );
  expect(read(root, "worldpacks/store.json")).toEqual(index);
  noInstall(root);
});
it("preserves a concurrent index edit while rolling back its new files", () => {
  const root = setup();
  const copy = fs.cpSync;
  vi.spyOn(fs, "cpSync").mockImplementation((...args) => {
    fs.writeFileSync(
      path.join(root, "worldpacks/store.json"),
      "concurrent edit",
    );
    return copy(...args);
  });
  expect(() => installSnapshot(root, proof.source, snapshot())).toThrow(
    /Store changed/,
  );
  expect(read(root, "worldpacks/store.json").toString()).toBe(
    "concurrent edit",
  );
  noInstall(root);
});
it("preserves an existing import lock", () => {
  const root = setup();
  const lock = path.join(root, "worldpacks/.import.lock");
  fs.writeFileSync(lock, "another import");
  expect(() => installSnapshot(root, proof.source, snapshot())).toThrow(
    /EEXIST/,
  );
  expect(fs.readFileSync(lock, "utf8")).toBe("another import");
});
