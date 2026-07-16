import { describe, expect, it } from "vitest";

import {
  FIRST_GENERATED_RUNTIME_HANDLE,
  buildContentReferenceMapping,
  canonicalContentReference,
  parseCanonicalContentReference,
} from "../../v2/scripts/content-references.mjs";

const candidate = (pack, local, legacy) => ({
  pack_id: pack,
  pack_version: "1.2.3",
  kind: "creature",
  local_id: local,
  ...(legacy === undefined ? {} : { legacy_runtime_id: legacy }),
});

describe("content references", () => {
  it("namespaces the same local slug by pack", () => {
    const mapping = buildContentReferenceMapping([
      candidate("five-e-commons", "goblin-warrior"),
      candidate("homebrew.example", "goblin-warrior"),
    ], 1);
    expect(mapping.entries.map((entry) => entry.canonical_ref)).toEqual([
      "pack://five-e-commons/creature/goblin-warrior",
      "pack://homebrew.example/creature/goblin-warrior",
    ]);
    expect(new Set(mapping.entries.map((entry) => entry.runtime_handle)).size).toBe(2);
  });

  it("is stable when mount order changes and preserves legacy ids", () => {
    const candidates = [candidate("z-pack", "owlbear"), candidate("a-pack", "goblin", 1001)];
    const first = buildContentReferenceMapping(candidates, 1);
    const second = buildContentReferenceMapping([...candidates].reverse(), 1);
    expect(second).toEqual(first);
    expect(first.entries.find((entry) => entry.legacy_runtime_id === 1001)?.runtime_handle).toBe(1001);
  });

  it("resolves generated collisions deterministically", () => {
    const generatedHandle = (_reference, attempt) => FIRST_GENERATED_RUNTIME_HANDLE + attempt;
    const first = buildContentReferenceMapping([
      candidate("b-pack", "same"),
      candidate("a-pack", "same"),
    ], 1, { generatedHandle });
    const second = buildContentReferenceMapping([
      candidate("a-pack", "same"),
      candidate("b-pack", "same"),
    ], 1, { generatedHandle });
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.runtime_handle)).toEqual([
      FIRST_GENERATED_RUNTIME_HANDLE,
      FIRST_GENERATED_RUNTIME_HANDLE + 1,
    ]);
  });

  it("round-trips encoded local ids and rejects non-canonical refs", () => {
    const reference = canonicalContentReference("five-e-commons", "creature", "Goblin Captain");
    expect(reference).toBe("pack://five-e-commons/creature/Goblin%20Captain");
    expect(parseCanonicalContentReference(reference)).toEqual({
      pack_id: "five-e-commons",
      kind: "creature",
      local_id: "Goblin Captain",
    });
    expect(() => parseCanonicalContentReference("pack://bad_pack/creature/goblin")).toThrow();
  });
});
