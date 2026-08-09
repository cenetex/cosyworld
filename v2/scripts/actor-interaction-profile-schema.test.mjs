import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ARCHIVED_MODEL_IDS,
  TTS_DEFAULT_VOICES,
  actorInteractionProfileValidationErrors,
  exactInteractionProfileForActor,
  indexActorInteractionProfiles,
} from "./actor-interaction-profile-schema.mjs";
import {
  ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH,
  ELYSIUM_ACTOR_MODEL_BINDINGS_PATH,
  expectedPinnedElysiumInteractionProfiles,
  loadPinnedElysiumInteractionProfiles,
} from "./generate-elysium-interaction-profiles.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const bindings = readJson(ELYSIUM_ACTOR_MODEL_BINDINGS_PATH);
const document = readJson(ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH);

test("pins one interaction-profile binding for every Elysium actor without reordering", () => {
  assert.equal(document.bindings.length, 485);
  assert.deepEqual(
    document.bindings.map((row) => [row.actor_id, row.requested_model_id]),
    bindings.map((binding) => [binding.actor_id, binding.requested_model_id]),
  );
  assert(
    document.bindings.every(
      (row) => row.route_model_id === row.requested_model_id,
    ),
  );
  assert.deepEqual(document, expectedPinnedElysiumInteractionProfiles());
  assert.deepEqual(
    actorInteractionProfileValidationErrors(document, bindings),
    [],
  );
});

test("classifies the pinned catalog into exact native interactions", () => {
  const profileCounts = new Map();
  const providerAvailableCounts = new Map();
  const availabilityCounts = new Map();
  for (const row of document.bindings) {
    availabilityCounts.set(
      row.availability,
      (availabilityCounts.get(row.availability) ?? 0) + 1,
    );
    for (const profile of row.profiles) {
      profileCounts.set(
        profile.kind,
        (profileCounts.get(profile.kind) ?? 0) + 1,
      );
      if (profile.provider_available) {
        providerAvailableCounts.set(
          profile.kind,
          (providerAvailableCounts.get(profile.kind) ?? 0) + 1,
        );
      }
    }
  }
  assert.deepEqual(Object.fromEntries(profileCounts), {
    talk: 360,
    illustrate: 40,
    speak: 19,
    transcribe: 13,
    find_resonance: 34,
    rank_echoes: 6,
    create_video: 20,
    voice_chat: 2,
    compose_audio: 2,
  });
  assert.deepEqual(Object.fromEntries(providerAvailableCounts), {
    talk: 356,
    illustrate: 38,
    speak: 13,
    transcribe: 13,
    find_resonance: 31,
    rank_echoes: 6,
    create_video: 20,
    voice_chat: 2,
    compose_audio: 2,
  });
  assert.deepEqual(Object.fromEntries(availabilityCounts), {
    active: 472,
    unsupported: 9,
    archived: 4,
  });
});

test("withholds Talk when the exact chat-completion endpoint is absent", () => {
  const olmo = document.bindings.find(
    (row) => row.requested_model_id === "allenai/olmo-3-32b-think",
  );
  assert.equal(olmo.availability, "unsupported");
  assert.equal(olmo.profiles[0].kind, "talk");
  assert.equal(olmo.profiles[0].provider_available, false);
  assert.equal(
    olmo.profiles[0].disabled_reason,
    "exact_model_id_has_no_chat_completion_endpoint_2026-08-08",
  );
});

test("keeps retired exact model ids as disabled tombstones", () => {
  const archived = document.bindings.filter(
    (row) => row.availability === "archived",
  );
  assert.deepEqual(
    archived.map((row) => row.requested_model_id).sort(),
    [...ARCHIVED_MODEL_IDS].sort(),
  );
  assert(
    archived.every(
      (row) =>
        row.route_model_id === row.requested_model_id &&
        row.profiles.every((profile) => !profile.provider_available),
    ),
  );
});

test("requires an authoritative TTS voice and pins MP3 output", () => {
  const speak = document.bindings.flatMap((row) =>
    row.profiles
      .filter((profile) => profile.kind === "speak")
      .map((profile) => ({ model: row.requested_model_id, profile })),
  );
  const missingVoice = speak
    .filter(({ profile }) => !profile.provider_available)
    .map(({ model }) => model)
    .sort();
  assert.deepEqual(
    missingVoice,
    [
      "fish-audio/s1",
      "fish-audio/s2-pro",
      "fish-audio/s2.1-pro",
      "fish-audio/s2.1-pro-free:free",
      "minimax/speech-2.8-hd",
      "minimax/speech-2.8-turbo",
    ].sort(),
  );
  assert(
    speak
      .filter(({ profile }) => !profile.provider_available)
      .every(
        ({ profile }) =>
          !profile.runtime_adapter_supported &&
          profile.disabled_reason ===
            "no_authoritative_supported_voice_in_profile_snapshot_2026-08-08" &&
          profile.runtime_adapter_unsupported_reason ===
            profile.disabled_reason &&
          !("voice" in profile.defaults) &&
          profile.defaults.response_format === "mp3",
      ),
  );
  assert.deepEqual(
    Object.fromEntries(
      speak
        .filter(({ profile }) => profile.provider_available)
        .map(({ model, profile }) => [model, profile.defaults.voice]),
    ),
    TTS_DEFAULT_VOICES,
  );
  assert(
    speak
      .filter(({ profile }) => profile.provider_available)
      .every(
        ({ profile }) =>
          typeof profile.defaults.voice === "string" &&
          profile.defaults.voice.length > 0 &&
          profile.defaults.response_format === "mp3" &&
          profile.runtime_adapter_supported &&
          profile.runtime_adapter_unsupported_reason === null,
      ),
  );
});

test("declares video as async and never ZDR", () => {
  const videoProfiles = document.bindings.flatMap((row) =>
    row.profiles.filter((profile) => profile.kind === "create_video"),
  );
  assert.equal(videoProfiles.length, 20);
  assert(
    videoProfiles.every(
      (profile) =>
        profile.provider_available &&
        profile.asynchronous &&
        profile.endpoint_zdr === false &&
        profile.endpoint === "/api/v1/videos",
    ),
  );
});

test("keeps provider availability separate from local adapter support", () => {
  assert.match(
    document.provider_availability_semantics,
    /Action offers must require/,
  );
  const profiles = document.bindings.flatMap((row) =>
    row.profiles.map((profile) => ({ row, profile })),
  );
  assert.equal(
    profiles.filter(({ profile }) => profile.runtime_adapter_supported).length,
    449,
  );
  assert.equal(
    profiles.filter(
      ({ profile }) =>
        profile.provider_available && profile.runtime_adapter_supported,
    ).length,
    440,
  );
  const vectorProfiles = profiles.filter(
    ({ row, profile }) =>
      profile.kind === "illustrate" &&
      row.requested_model_id.startsWith("recraft/recraft-v4") &&
      row.requested_model_id.endsWith("vector"),
  );
  assert.equal(vectorProfiles.length, 4);
  assert(
    vectorProfiles.every(
      ({ profile }) =>
        profile.provider_available &&
        !profile.runtime_adapter_supported &&
        profile.runtime_adapter_unsupported_reason ===
          "safe_svg_rasterizer_not_implemented",
    ),
  );
});

test("indexes and returns only the actor's exact requested model", () => {
  const loaded = loadPinnedElysiumInteractionProfiles();
  assert.equal(loaded.byActorId.size, 485);
  assert.equal(loaded.byRequestedModelId.size, 485);
  const trinity = bindings.find(
    (binding) =>
      binding.requested_model_id === "arcee-ai/trinity-large-thinking",
  );
  const route = exactInteractionProfileForActor(
    loaded.document,
    trinity.actor_id,
    "talk",
  );
  assert.equal(route.requested_model_id, trinity.requested_model_id);
  assert.equal(route.route_model_id, trinity.requested_model_id);
  assert.equal(route.profile.endpoint, "/api/v1/chat/completions");
  assert.equal(
    exactInteractionProfileForActor(
      loaded.document,
      trinity.actor_id,
      "illustrate",
    ),
    null,
  );
  assert.equal(
    exactInteractionProfileForActor(loaded.document, 0, "talk"),
    null,
  );
  assert.equal(
    indexActorInteractionProfiles(loaded.document).byActorId.size,
    485,
  );
});

test("validation rejects substitution and false video retention claims", () => {
  const substituted = structuredClone(document);
  substituted.bindings[0].route_model_id = "openrouter/auto";
  assert(
    actorInteractionProfileValidationErrors(substituted, bindings).some(
      (error) => error.includes("substitutes its exact model id"),
    ),
  );

  const videoZdr = structuredClone(document);
  const video = videoZdr.bindings
    .flatMap((row) => row.profiles)
    .find((profile) => profile.kind === "create_video");
  video.endpoint_zdr = true;
  assert(
    actorInteractionProfileValidationErrors(videoZdr, bindings).some((error) =>
      error.includes("must declare endpoint_zdr false"),
    ),
  );
});

test("validation rejects unpinned Speak voices and unsafe adapter claims", () => {
  const changedVoice = structuredClone(document);
  const availableSpeak = changedVoice.bindings
    .flatMap((row) => row.profiles.map((profile) => ({ row, profile })))
    .find(
      ({ profile }) => profile.kind === "speak" && profile.provider_available,
    );
  availableSpeak.profile.defaults.voice = "provider-default";
  assert(
    actorInteractionProfileValidationErrors(changedVoice, bindings).some(
      (error) => error.includes("authoritative voice or MP3 format"),
    ),
  );

  const unsupportedSpeak = structuredClone(document);
  const noVoice = unsupportedSpeak.bindings
    .flatMap((row) => row.profiles.map((profile) => ({ row, profile })))
    .find(
      ({ profile }) => profile.kind === "speak" && !profile.provider_available,
    );
  noVoice.profile.runtime_adapter_supported = true;
  noVoice.profile.runtime_adapter_unsupported_reason = null;
  assert(
    actorInteractionProfileValidationErrors(unsupportedSpeak, bindings).some(
      (error) => error.includes("unsafe runtime adapter gate"),
    ),
  );

  const falselyAvailableSpeak = structuredClone(document);
  const unavailable = falselyAvailableSpeak.bindings
    .flatMap((row) => row.profiles)
    .find(
      (profile) => profile.kind === "speak" && !profile.provider_available,
    );
  unavailable.provider_available = true;
  unavailable.disabled_reason = null;
  assert(
    actorInteractionProfileValidationErrors(
      falselyAvailableSpeak,
      bindings,
    ).some((error) => error.includes("must remain disabled")),
  );
});
