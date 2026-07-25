import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(repoRoot, "v2/content/rules-profile-commons");
const compiledRoot = path.join(repoRoot, "v2/content/five-e-commons");

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(...parts), "utf8"));
}

function rustSource() {
  const root = path.join(repoRoot, "v2/orchestrator-rust/src");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.name.endsWith(".rs")) files.push(filePath);
    }
  };
  visit(root);
  return files.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
}

describe("Five E Commons rules profile", () => {
  it("selects its own profile while reusing the SRD reference capability", () => {
    const manifest = readJson(sourceRoot, "pack.json");
    const world = readJson(repoRoot, "v2/worlds/five-e-commons/world.json");

    expect(manifest.rules_profile).toBe("cosyworld.commons5/1");
    expect(manifest.rules_namespace).toBe("cosyworld.commons5");
    expect(world.rules_profile).toBe(manifest.rules_profile);
    expect(world.packs).toEqual([
      "cosyworld.rules-srd-5.2.1",
      "cosyworld.rules-profile-commons",
    ]);
    expect(manifest.dependencies).toContainEqual(expect.objectContaining({
      id: "cosyworld.rules-srd-5.2.1",
      capabilities: ["cosyworld.rules-srd-5.2.1/reference"],
    }));
    expect(manifest.rules).not.toHaveProperty("conditions");
    expect(manifest.rules).not.toHaveProperty("monster_seeds");
    expect(fs.existsSync(path.join(sourceRoot, "conditions.json"))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, "monster_seeds.json"))).toBe(false);
  });

  it("binds every action to complete conformance and real replay coverage", () => {
    const actions = readJson(sourceRoot, "actions.json");
    const rows = readJson(sourceRoot, "conformance.json");
    const byAction = new Map(rows.map((row) => [row.action_id, row]));
    const cKernelSource = fs.readFileSync(
      path.join(repoRoot, "v2/core-c/tests/test_kernel.c"),
      "utf8",
    );
    const orchestratorSource = rustSource();

    expect(rows).toHaveLength(actions.length);
    for (const action of actions) {
      expect(action.id.startsWith("cosyworld.commons5:")).toBe(true);
      const row = byAction.get(action.id);
      expect(row).toEqual(expect.objectContaining({
        support_status: action.support_status,
        resolver_kind: action.resolver_kind,
      }));
      if (action.support_status === "unsupported") {
        expect(row.replay_fixture).toBeNull();
        continue;
      }
      const fixtureParts = row.replay_fixture.split("::").filter(Boolean);
      const suite = fixtureParts[0];
      const symbol = fixtureParts.at(-1);
      expect(symbol).toBeTruthy();
      if (suite === "core-c/tests/test_kernel.c") {
        expect(cKernelSource).toContain(symbol);
      } else {
        expect(suite).toBe("orchestrator-rust");
        expect(orchestratorSource).toContain(symbol);
      }
    }
  });

  it("publishes attribution and no offers for unsupported actions", () => {
    const actions = readJson(sourceRoot, "actions.json");
    const unsupported = new Set(
      actions
        .filter((action) => action.support_status === "unsupported")
        .map((action) => action.id),
    );
    const contributions = readJson(compiledRoot, "contributions.json");
    const licenses = readJson(compiledRoot, "licenses.json");
    const compiledActions = readJson(compiledRoot, "rules.json")
      .find((bundle) => bundle.pack_id === "cosyworld.rules-profile-commons")
      ?.resources.actions ?? [];

    expect(unsupported.size).toBeGreaterThan(0);
    expect(compiledActions.map((action) => action.id)).toEqual(
      expect.arrayContaining([...unsupported]),
    );
    expect(
      contributions.flatMap((bundle) => bundle.offers ?? [])
        .some((offer) => unsupported.has(offer.action_id)),
    ).toBe(false);
    expect(licenses).toContainEqual(expect.objectContaining({
      pack_id: "cosyworld.rules-profile-commons",
      license_identifier: "CC-BY-4.0",
    }));
  });
});
