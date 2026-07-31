import assert from "node:assert/strict";
import test from "node:test";

import { actorModelBindingValidationErrors } from "./actor-model-binding-schema.mjs";

const manifest = {
  id: "cosyworld.elysium",
  extensions: {
    "x-cosyworld-ai-cast": {
      schema_version: 1,
      provider: "openrouter",
      catalog_snapshot_version: "openrouter-2026-07-31.1",
      speech_mode: "raw",
      complete_actor_binding: true,
      runtime_refresh: false,
    },
  },
};
const actor = {
  pack_id: manifest.id,
  id: 652001,
  speech_mode: "raw",
};
const binding = {
  pack_id: manifest.id,
  id: "openai/example",
  actor_id: actor.id,
  actor_ref: `pack://${manifest.id}/actor/${actor.id}`,
  provider: "openrouter",
  requested_model_id: "openai/example",
  canonical_slug: "openai/example-20260731",
  display_name: "OpenAI: Example",
  catalog_snapshot_version: "openrouter-2026-07-31.1",
  created: 1785456000,
  input_modalities: ["text"],
  output_modalities: ["text"],
  context_length: 128000,
  max_completion_tokens: 16384,
  supported_parameters: ["max_tokens", "temperature"],
  input_cost_per_million: 1,
  output_cost_per_million: 5,
  zero_data_retention: true,
  speech_mode: "raw",
};

test("accepts a complete exact OpenRouter actor binding", () => {
  assert.deepEqual(actorModelBindingValidationErrors(manifest, [actor], [binding]), []);
});

test("rejects duplicate models and actor bindings", () => {
  const errors = actorModelBindingValidationErrors(manifest, [actor], [binding, binding]);
  assert(errors.some((error) => error.includes("repeats model")));
  assert(errors.some((error) => error.includes("repeats actor")));
});

test("rejects a cast with an unbound actor", () => {
  const extra = { ...actor, id: 652002 };
  const errors = actorModelBindingValidationErrors(manifest, [actor, extra], [binding]);
  assert(errors.some((error) => error.includes("binds 1 of 2 actors")));
});

test("requires non-text models to be explicitly unavailable", () => {
  const unavailableActor = { ...actor, speech_mode: "unavailable" };
  const unavailable = {
    ...binding,
    output_modalities: ["image"],
    speech_mode: "raw",
  };
  const errors = actorModelBindingValidationErrors(
    manifest,
    [unavailableActor],
    [unavailable],
  );
  assert(errors.some((error) => error.includes("speech_mode does not match its modalities")));
});
