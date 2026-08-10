import assert from "node:assert/strict";
import test from "node:test";

import { avatarLevelSchemaValidationErrors } from "./avatar-level-schema.mjs";

const actor = {
  pack_id: "cosyworld.test",
  id: 42,
  speech_mode: "raw",
};
const binding = {
  actor_id: actor.id,
};
const track = {
  pack_id: "cosyworld.test",
  id: "test.embodiment",
  actor_pack_id: "cosyworld.test",
  speech_modes: ["raw"],
  identity: {
    mode: "self_authored",
    canonical_description: "An exact-bound test avatar.",
    mutable_traits: ["persona", "appearance"],
  },
  max_level: 3,
  levels: [
    { level: 1, label: "Awake" },
    {
      level: 2,
      label: "Embodied",
      requirements: [{ event_type: "actor.moved", count: 2, distinct_locations: 2 }],
      chance: { ability: "wisdom", dc: 12, retry: "new_evidence" },
      effects: [{ kind: "hp_base_delta", amount: 2 }],
    },
    {
      level: 3,
      label: "World-Known",
      requirements: [{ event_type: "item.picked_up", count: 1 }],
    },
  ],
};

function errors(overrides = {}) {
  return avatarLevelSchemaValidationErrors({
    actors: [actor],
    tracks: [track],
    actorModelBindings: [binding],
    ...overrides,
  });
}

test("accepts structured self-authorship and levels beyond two", () => {
  assert.deepEqual(errors(), []);
});

test("rejects prose, model, and Orb events as advancement authority", () => {
  for (const event_type of ["message.created", "model.completed", "orb.earned"]) {
    const invalid = structuredClone(track);
    invalid.levels[1].requirements[0].event_type = event_type;
    assert(errors({ tracks: [invalid] }).some((error) => error.includes("invalid requirement")));
  }
});

test("requires exact text-model ownership for self-authored avatars", () => {
  assert(errors({ actorModelBindings: [] }).some((error) => error.includes("exact text model")));
});

test("requires contiguous levels and new-evidence retries", () => {
  const invalid = structuredClone(track);
  invalid.levels[1].level = 3;
  invalid.levels[1].chance.retry = "always";
  const found = errors({ tracks: [invalid] }).join("\n");
  assert.match(found, /invalid number or label/);
  assert.match(found, /invalid chance gate/);
});
