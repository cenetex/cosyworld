import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "v2/content/core-ruby/registry.json"), "utf8"),
);
const browser = fs.readFileSync(
  path.join(repoRoot, "v2/orchestrator-rust/src/index.html"),
  "utf8",
);
const checkerPath = path.join(repoRoot, "v2/scripts/check-worldpack.mjs");

describe("Core + Ruby High composition", () => {
  it("mounts the peer worlds with only their explicit bridge resources", () => {
    expect(registry.manifest.id).toBe("cosyworld.core-ruby");
    expect(registry.manifest.packs.map((pack) => pack.id)).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-srd5",
      "cosyworld.core",
      "ruby-high.first-bell",
      "cosyworld.composition.core-ruby",
    ]);
    expect(registry.resources.exits.filter((exit) =>
      [1, 11].includes(exit.from_location_id)
      && [1, 11].includes(exit.to_location_id))).toEqual([
      expect.objectContaining({
        from_location_id: 1,
        to_location_id: 11,
        pack_id: "cosyworld.composition.core-ruby",
      }),
      expect.objectContaining({
        from_location_id: 11,
        to_location_id: 1,
        pack_id: "cosyworld.composition.core-ruby",
      }),
    ]);
    const locationPacks = new Map(
      registry.resources.locations.map((location) => [location.id, location.pack_id]),
    );
    expect(registry.resources.exits.filter((exit) =>
      locationPacks.get(exit.from_location_id)
        !== locationPacks.get(exit.to_location_id)))
      .toEqual(registry.resources.exits.filter((exit) =>
        exit.pack_id === "cosyworld.composition.core-ruby"));
    expect(registry.resources.actor_facets).toEqual([
      expect.objectContaining({
        id: "rati-first-bell",
        actor_ref: "pack://cosyworld.core/actor/1001",
        pack_id: "ruby-high.first-bell",
      }),
    ]);
    expect(registry.resources.card_bindings).toEqual([
      expect.objectContaining({
        entity_ref: "pack://cosyworld.core/actor/1001",
        external_card_id: "rati",
        pack_id: "ruby-high.first-bell",
      }),
    ]);
  });

  it("keeps both location rule vocabularies and cards available at the boundary", () => {
    expect(registry.resources.action_vocabulary).toEqual([
      expect.objectContaining({ pack_id: "cosyworld.core", travel: "Travel" }),
      expect.objectContaining({ pack_id: "ruby-high.first-bell", travel: "Head to" }),
    ]);
    expect(registry.resources.cards.find((card) =>
      card.subject_kind === "location" && card.subject_id === 1)).toEqual(
      expect.objectContaining({ card_id: "cosy-cottage", pack_id: "cosyworld.core" }),
    );
    expect(registry.resources.cards.find((card) =>
      card.subject_kind === "location" && card.subject_id === 11)).toEqual(
      expect.objectContaining({
        card_id: "location-homeroom",
        pack_id: "ruby-high.first-bell",
      }),
    );
    expect(browser).toContain("composition_id: offer.composition_id");
  });

  it("rejects a reusable pack that claims a cross-pack path", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cosyworld-composition-bridge-"));
    const compiledRoot = path.join(tempRoot, "core-ruby");
    try {
      fs.cpSync(path.join(repoRoot, "v2/content/core-ruby"), compiledRoot, {
        recursive: true,
      });
      const exitsPath = path.join(compiledRoot, "exits.json");
      const registryPath = path.join(compiledRoot, "registry.json");
      const exits = JSON.parse(fs.readFileSync(exitsPath, "utf8"));
      const registryCopy = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      const crossPackExit = exits.find((exit) =>
        exit.pack_id === "cosyworld.composition.core-ruby");
      crossPackExit.pack_id = "ruby-high.first-bell";
      registryCopy.resources.exits = exits;
      fs.writeFileSync(exitsPath, `${JSON.stringify(exits, null, 2)}\n`);
      fs.writeFileSync(registryPath, `${JSON.stringify(registryCopy, null, 2)}\n`);

      const checked = spawnSync(process.execPath, [checkerPath, compiledRoot], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(checked.status).not.toBe(0);
      expect(checked.stderr).toContain("outside a composition bridge pack");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
