import assert from "node:assert/strict";
import test from "node:test";

import {
  actorModelBindingValidationErrors,
  voicePoolValidationErrors,
  freeContextValidationErrors,
  decisionsValidationErrors,
} from "./actor-model-binding-schema.mjs";

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

test("rejects duplicate binding identities and actor bindings", () => {
  const errors = actorModelBindingValidationErrors(manifest, [actor], [binding, binding]);
  assert(errors.some((error) => error.includes("repeats binding")));
  assert(errors.some((error) => error.includes("repeats actor")));
});

test("rejects a cast with an unbound actor", () => {
  const extra = { ...actor, id: 652002 };
  const errors = actorModelBindingValidationErrors(manifest, [actor, extra], [binding]);
  assert(errors.some((error) => error.includes("binds 1 of 2 actors")));
});

test("accepts an explicit partial cast and shared requested model routes", () => {
  const explicitManifest = structuredClone(manifest);
  delete explicitManifest.extensions["x-cosyworld-ai-cast"].complete_actor_binding;
  explicitManifest.extensions["x-cosyworld-ai-cast"].binding_policy = "explicit";
  const second = { ...actor, id: 652002 };
  const secondBinding = {
    ...binding,
    id: "cosyworld.test/second-example-binding",
    actor_id: second.id,
    actor_ref: `pack://${manifest.id}/actor/${second.id}`,
  };

  assert.deepEqual(
    actorModelBindingValidationErrors(explicitManifest, [actor, second], [binding]),
    [],
  );
  assert.deepEqual(
    actorModelBindingValidationErrors(
      explicitManifest,
      [actor, second],
      [binding, secondBinding],
    ),
    [],
  );
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

test("voice pool extension is optional and validates its shape", () => {
  const pack = (config) => ({ id: "p", extensions: { "x-cosyworld-voice-pool": config } });
  assert.deepEqual(voicePoolValidationErrors({ id: "p" }), []);
  assert.deepEqual(
    voicePoolValidationErrors(
      pack({
        schema_version: 1,
        strategy: "keyed",
        salt: "s1",
        tier_weights: { common: 4, rare: 1 },
        temperature: 1,
      }),
    ),
    [],
  );
  const errors = voicePoolValidationErrors(
    pack({ schema_version: 2, strategy: "random", model: "x/y", tier_weights: { mythic: -1 }, temperature: 3 }),
  );
  assert.ok(errors.length >= 6, errors.join("\n"));
});

test("free-context declarations accept only the documented shape", () => {
  const pack = (config) => ({ id: "p", extensions: { "x-cosyworld-free-context": config } });
  assert.deepEqual(freeContextValidationErrors({ id: "p" }), []);
  assert.deepEqual(
    freeContextValidationErrors(pack({ schema_version: 1, mode: "free_context" })),
    [],
  );
  assert.deepEqual(
    freeContextValidationErrors(
      pack({ schema_version: 1, mode: "free_context", traveler_personas: ["i am a traveler."] }),
    ),
    [],
  );
  assert.ok(
    freeContextValidationErrors(
      pack({ schema_version: 1, mode: "free_context", traveler_personas: [""] }),
    ).length > 0,
  );
  assert.ok(freeContextValidationErrors(pack({ schema_version: 1, mode: "task" })).length > 0);
  assert.ok(
    freeContextValidationErrors(pack({ schema_version: 1, mode: "free_context", budget: 9 }))
      .length > 0,
  );
});

test("decisions declarations accept only the documented shape", () => {
  const pack = (config) => ({ id: "p", extensions: { "x-cosyworld-decisions": config } });
  assert.deepEqual(decisionsValidationErrors({ id: "p" }), []);
  assert.deepEqual(
    decisionsValidationErrors(
      pack({ schema_version: 1, chat_floor: true, repeat_judge: true, repeat_threshold: 0.8 }),
    ),
    [],
  );
  for (const bad of [
    { schema_version: 2 },
    { schema_version: 1, chat_floor: "yes" },
    { schema_version: 1, repeat_threshold: 0.1 },
    { schema_version: 1, model: "x/y" },
  ]) {
    assert.ok(decisionsValidationErrors(pack(bad)).length > 0, JSON.stringify(bad));
  }
});
