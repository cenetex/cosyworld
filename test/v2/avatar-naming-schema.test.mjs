import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertAvatarNamingConfig,
  avatarNamingValidationErrors,
} from "../../v2/scripts/avatar-naming-schema.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
const authored = read("v2/worlds/shared/cozy-fantasy-avatar-naming.json");

describe("avatar naming schema", () => {
  it("validates the authored culture grammar with the shared compiler/checker contract", () => {
    expect(avatarNamingValidationErrors(authored)).toEqual([]);
    expect(assertAvatarNamingConfig(authored)).toBe(authored);
  });

  it.each([
    [
      "unknown fields",
      (config) => {
        config.surprise = true;
      },
      /unknown field surprise/,
    ],
    [
      "missing cultures",
      (config) => {
        config.cultures = [];
      },
      /between 1 and 32 cultures/,
    ],
    [
      "unknown pools",
      (config) => {
        config.cultures[0].forms[0].pattern = "{missing}";
      },
      /unknown pool/,
    ],
    [
      "oversized generated names",
      (config) => {
        config.cultures[0].pools.given[0] = "Overlongcomponent";
      },
      /invalid entries/,
    ],
  ])("rejects %s", (_label, mutate, expected) => {
    const config = structuredClone(authored);
    mutate(config);
    expect(() => assertAvatarNamingConfig(config)).toThrow(expected);
  });

  it("embeds the same authored grammar in every world-bearing composition", () => {
    for (const composition of ["official", "core-only", "ruby-high-only"]) {
      expect(
        read(`v2/content/${composition}/worldpack.json`).avatar_naming,
      ).toEqual(authored);
    }
    expect(
      read("v2/content/services-only/worldpack.json").avatar_naming,
    ).toBeUndefined();
  });
});
