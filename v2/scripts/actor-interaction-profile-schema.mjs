export const ACTOR_INTERACTION_PROFILE_SCHEMA_VERSION = 1;
export const ACTOR_INTERACTION_PROFILE_SNAPSHOT =
  "openrouter-interactions-2026-08-09.5";
export const PROVIDER_AVAILABILITY_SEMANTICS =
  "provider_available only records that the pinned exact model and provider endpoint were advertised in the profile snapshot; it does not mean CosyWorld has a runtime adapter. Action offers must require provider_available, runtime_adapter_supported, and the applicable runtime policy gates.";

export const ACTOR_INTERACTION_KINDS = Object.freeze([
  "talk",
  "illustrate",
  "speak",
  "transcribe",
  "find_resonance",
  "rank_echoes",
  "create_video",
  "voice_chat",
  "compose_audio",
  "unsupported",
]);

export const ARCHIVED_MODEL_IDS = Object.freeze([
  "inclusionai/ling-3.0-flash:free",
  "mistralai/devstral-2512",
  "openai/gpt-5.1-chat",
  "openai/text-embedding-3-small:batch",
]);

const archivedModelIds = new Set(ARCHIVED_MODEL_IDS);
const imageRouteUnavailableModelIds = new Set([
  "openrouter/auto",
  "openrouter/auto-beta",
]);
const chatRouteUnavailableModelIds = new Set([
  "allenai/olmo-3-32b-think",
]);
const immediateEmbeddingRouteUnavailableModelIds = new Set([
  "openai/text-embedding-3-large:batch",
  "openai/text-embedding-3-small:batch",
  "openai/text-embedding-ada-002:batch",
]);
const voiceChatModelIds = new Set([
  "openai/gpt-audio",
  "openai/gpt-audio-mini",
]);
const composeAudioModelIds = new Set([
  "google/lyria-3-clip-preview",
  "google/lyria-3-pro-preview",
]);
const svgRasterizerRequiredModelIds = new Set([
  "recraft/recraft-v4-pro-vector",
  "recraft/recraft-v4-vector",
  "recraft/recraft-v4.1-pro-vector",
  "recraft/recraft-v4.1-vector",
]);
const runtimeAdapterSupportedKinds = new Set([
  "talk",
  "illustrate",
  "find_resonance",
  "rank_echoes",
  "voice_chat",
]);

// Pinned from the provider's public model inventory on 2026-08-08. Models
// absent from this map did not publish an authoritative supported voice, so
// their Speak profile stays disabled instead of guessing a provider default.
export const TTS_DEFAULT_VOICES = Object.freeze({
  "canopylabs/orpheus-3b-0.1-ft": "tara",
  "deepgram/aura-2": "aura-2-thalia-en",
  "google/gemini-3.1-flash-tts-preview": "Zephyr",
  "hexgrad/kokoro-82m": "af_alloy",
  "microsoft/mai-voice-2": "en-US-Harper:MAI-Voice-2",
  "microsoft/mai-voice-2-flash": "en-US-Harper:MAI-Voice-2",
  "mistralai/voxtral-mini-tts-2603": "en_paul_sad",
  "qwen/qwen-audio-3.0-tts-flash": "loongjohn",
  "qwen/qwen-audio-3.0-tts-plus": "longanlingxin",
  "sesame/csm-1b": "conversational_a",
  "x-ai/grok-voice-tts-1.0": "eve",
  "zyphra/zonos-v0.1-hybrid": "american_female",
  "zyphra/zonos-v0.1-transformer": "american_female",
});

const profileEndpoints = Object.freeze({
  talk: "/api/v1/chat/completions",
  illustrate: "/api/v1/images",
  speak: "/api/v1/audio/speech",
  transcribe: "/api/v1/audio/transcriptions",
  find_resonance: "/api/v1/embeddings",
  rank_echoes: "/api/v1/rerank",
  create_video: "/api/v1/videos",
  voice_chat: "/api/v1/chat/completions",
  compose_audio: "/api/v1/chat/completions",
  unsupported: null,
});

const profileLabels = Object.freeze({
  talk: "Talk",
  illustrate: "Illustrate",
  speak: "Speak",
  transcribe: "Transcribe",
  find_resonance: "Find resonance",
  rank_echoes: "Rank echoes",
  create_video: "Create video",
  voice_chat: "Voice chat",
  compose_audio: "Compose music",
  unsupported: "Unavailable",
});

const archivedReason = "model_id_absent_from_openrouter_inventory_2026-08-08";
const imageRouteReason =
  "exact_model_id_absent_from_openrouter_image_models_2026-08-08";
const chatRouteReason =
  "exact_model_id_has_no_chat_completion_endpoint_2026-08-08";
const batchChatRouteReason =
  "exact_batch_model_id_requires_async_batch_route_2026-08-09";
const embeddingRouteReason =
  "exact_batch_model_id_has_no_immediate_embeddings_route_2026-08-08";
const ttsVoiceReason =
  "no_authoritative_supported_voice_in_profile_snapshot_2026-08-08";
const runtimeAdapterReasons = Object.freeze({
  speak: "speech_adapter_not_implemented",
  transcribe: "transcription_adapter_not_implemented",
  create_video: "video_async_persistence_adapter_not_implemented",
  voice_chat: "mixed_audio_stream_adapter_not_implemented",
  compose_audio: "mixed_audio_stream_adapter_not_implemented",
  unsupported: "unsupported_native_output_adapter",
});

function normalizedModalities(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function modalityKey(values) {
  return normalizedModalities(values).join("+");
}

function interactionProfile(binding, kind, options = {}) {
  const routeDisabledReason = options.disabled_reason ?? null;
  const disabledReason = archivedModelIds.has(binding.requested_model_id)
    ? archivedReason
    : routeDisabledReason;
  const providerAvailable = disabledReason === null;
  const requiresSvgRasterizer =
    kind === "illustrate" &&
    svgRasterizerRequiredModelIds.has(binding.requested_model_id);
  const authoritativeSpeakVoice =
    kind === "speak"
      ? (TTS_DEFAULT_VOICES[binding.requested_model_id] ?? null)
      : null;
  const exactSpeakAdapterSupported =
    kind === "speak" &&
    providerAvailable &&
    authoritativeSpeakVoice !== null &&
    options.defaults?.voice === authoritativeSpeakVoice &&
    options.defaults?.response_format === "mp3";
  const runtimeAdapterSupported =
    !requiresSvgRasterizer &&
    (runtimeAdapterSupportedKinds.has(kind) || exactSpeakAdapterSupported);
  return {
    kind,
    label: profileLabels[kind],
    provider_available: providerAvailable,
    disabled_reason: disabledReason,
    runtime_adapter_supported: runtimeAdapterSupported,
    runtime_adapter_unsupported_reason: runtimeAdapterSupported
      ? null
      : requiresSvgRasterizer
        ? "safe_svg_rasterizer_not_implemented"
        : kind === "speak" && disabledReason !== null
          ? disabledReason
        : (runtimeAdapterReasons[kind] ??
          "native_interaction_adapter_not_implemented"),
    endpoint: profileEndpoints[kind],
    accepted_inputs: normalizedModalities(
      options.accepted_inputs ?? binding.input_modalities,
    ),
    outputs: normalizedModalities(options.outputs ?? binding.output_modalities),
    endpoint_zdr:
      kind === "unsupported"
        ? null
        : kind === "create_video"
          ? false
          : binding.zero_data_retention,
    asynchronous: kind === "create_video",
    streaming: options.streaming ?? false,
    required_parameters: [...(options.required_parameters ?? ["model"])],
    defaults: structuredClone(options.defaults ?? {}),
  };
}

function talkProfile(binding) {
  return interactionProfile(binding, "talk", {
    outputs: ["text"],
    required_parameters: ["model", "messages"],
    disabled_reason: binding.requested_model_id.endsWith(":batch")
      ? batchChatRouteReason
      : chatRouteUnavailableModelIds.has(binding.requested_model_id)
        ? chatRouteReason
        : null,
  });
}

function imageProfile(binding) {
  const acceptedInputs = binding.input_modalities.filter((value) =>
    ["image", "text"].includes(value),
  );
  return interactionProfile(binding, "illustrate", {
    accepted_inputs: acceptedInputs,
    outputs: ["image"],
    required_parameters: ["model", "prompt"],
    defaults: { n: 1 },
    disabled_reason: imageRouteUnavailableModelIds.has(
      binding.requested_model_id,
    )
      ? imageRouteReason
      : null,
  });
}

function speakProfile(binding) {
  const voice = TTS_DEFAULT_VOICES[binding.requested_model_id] ?? null;
  const defaults = { response_format: "mp3" };
  if (voice !== null) defaults.voice = voice;
  return interactionProfile(binding, "speak", {
    accepted_inputs: ["text"],
    outputs: ["speech"],
    required_parameters: ["model", "input", "voice"],
    defaults,
    disabled_reason: voice === null ? ttsVoiceReason : null,
  });
}

function transcriptionProfile(binding) {
  return interactionProfile(binding, "transcribe", {
    accepted_inputs: ["audio"],
    outputs: ["transcription"],
    required_parameters: ["model", "input_audio.data", "input_audio.format"],
  });
}

function embeddingProfile(binding) {
  return interactionProfile(binding, "find_resonance", {
    outputs: ["embeddings"],
    required_parameters: ["model", "input"],
    defaults: { encoding_format: "float" },
    disabled_reason: immediateEmbeddingRouteUnavailableModelIds.has(
      binding.requested_model_id,
    )
      ? embeddingRouteReason
      : null,
  });
}

function rerankProfile(binding) {
  return interactionProfile(binding, "rank_echoes", {
    outputs: ["rerank"],
    required_parameters: ["model", "query", "documents"],
  });
}

function videoProfile(binding) {
  return interactionProfile(binding, "create_video", {
    outputs: ["video"],
    required_parameters: ["model", "prompt"],
  });
}

function voiceChatProfile(binding) {
  return interactionProfile(binding, "voice_chat", {
    outputs: ["audio", "text"],
    streaming: true,
    required_parameters: [
      "model",
      "messages",
      "modalities",
      "audio.voice",
      "audio.format",
      "stream",
    ],
    defaults: {
      modalities: ["text", "audio"],
      audio: { voice: "alloy", format: "mp3" },
      stream: true,
    },
  });
}

function composeAudioProfile(binding) {
  return interactionProfile(binding, "compose_audio", {
    outputs: ["audio", "text"],
    streaming: true,
    required_parameters: ["model", "messages", "modalities", "stream"],
    defaults: {
      modalities: ["text", "audio"],
      audio: { format: "wav" },
      stream: true,
    },
  });
}

function unsupportedProfile(binding) {
  return interactionProfile(binding, "unsupported", {
    disabled_reason: `unsupported_exact_output_modalities:${modalityKey(
      binding.output_modalities,
    )}`,
    required_parameters: [],
  });
}

function profilesForBinding(binding) {
  switch (modalityKey(binding.output_modalities)) {
    case "text":
      return [talkProfile(binding)];
    case "image+text":
      return [talkProfile(binding), imageProfile(binding)];
    case "audio+text":
      if (voiceChatModelIds.has(binding.requested_model_id)) {
        return [voiceChatProfile(binding)];
      }
      if (composeAudioModelIds.has(binding.requested_model_id)) {
        return [composeAudioProfile(binding)];
      }
      return [unsupportedProfile(binding)];
    case "image":
      return [imageProfile(binding)];
    case "speech":
      return [speakProfile(binding)];
    case "transcription":
      return [transcriptionProfile(binding)];
    case "embeddings":
      return [embeddingProfile(binding)];
    case "rerank":
      return [rerankProfile(binding)];
    case "video":
      return [videoProfile(binding)];
    default:
      return [unsupportedProfile(binding)];
  }
}

function availabilityFor(binding, profiles) {
  if (archivedModelIds.has(binding.requested_model_id)) {
    return { availability: "archived", availability_reason: archivedReason };
  }
  const providerAvailable = profiles.some(
    (profile) => profile.provider_available,
  );
  return {
    availability: providerAvailable ? "active" : "unsupported",
    availability_reason: providerAvailable
      ? null
      : (profiles.map((profile) => profile.disabled_reason).find(Boolean) ??
        "no_exact_native_interaction_profile"),
  };
}

export function buildActorInteractionProfileDocument(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error(
      "actor interaction profiles require non-empty model bindings",
    );
  }
  const catalogSnapshots = new Set(
    bindings.map((binding) => binding.catalog_snapshot_version),
  );
  if (catalogSnapshots.size !== 1) {
    throw new Error("actor interaction profiles require one catalog snapshot");
  }
  const rows = bindings.map((binding) => {
    const profiles = profilesForBinding(binding);
    const availability = availabilityFor(binding, profiles);
    return {
      actor_id: binding.actor_id,
      requested_model_id: binding.requested_model_id,
      route_model_id: binding.requested_model_id,
      canonical_slug: binding.canonical_slug,
      ...availability,
      profiles,
    };
  });
  return {
    schema_version: ACTOR_INTERACTION_PROFILE_SCHEMA_VERSION,
    profile_snapshot_version: ACTOR_INTERACTION_PROFILE_SNAPSHOT,
    catalog_snapshot_version: [...catalogSnapshots][0],
    source_binding_count: bindings.length,
    runtime_refresh: false,
    provider_availability_semantics: PROVIDER_AVAILABILITY_SEMANTICS,
    bindings: rows,
  };
}

const documentFields = new Set([
  "schema_version",
  "profile_snapshot_version",
  "catalog_snapshot_version",
  "source_binding_count",
  "runtime_refresh",
  "provider_availability_semantics",
  "bindings",
]);
const bindingFields = new Set([
  "actor_id",
  "requested_model_id",
  "route_model_id",
  "canonical_slug",
  "availability",
  "availability_reason",
  "profiles",
]);
const profileFields = new Set([
  "kind",
  "label",
  "provider_available",
  "disabled_reason",
  "runtime_adapter_supported",
  "runtime_adapter_unsupported_reason",
  "endpoint",
  "accepted_inputs",
  "outputs",
  "endpoint_zdr",
  "asynchronous",
  "streaming",
  "required_parameters",
  "defaults",
]);

function unknownFields(value, allowed) {
  return Object.keys(value).filter((field) => !allowed.has(field));
}

export function actorInteractionProfileValidationErrors(document, bindings) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return ["actor interaction profile document must be an object"];
  }
  const errors = [];
  for (const field of unknownFields(document, documentFields)) {
    errors.push(
      `actor interaction profile document has unknown field ${field}`,
    );
  }
  let expected;
  try {
    expected = buildActorInteractionProfileDocument(bindings);
  } catch (error) {
    return [`could not derive actor interaction profiles: ${error.message}`];
  }
  for (const field of [
    "schema_version",
    "profile_snapshot_version",
    "catalog_snapshot_version",
    "source_binding_count",
    "runtime_refresh",
    "provider_availability_semantics",
  ]) {
    if (document[field] !== expected[field]) {
      errors.push(`actor interaction profile document has invalid ${field}`);
    }
  }
  if (!Array.isArray(document.bindings)) {
    errors.push("actor interaction profile bindings must be an array");
    return errors;
  }
  if (document.bindings.length !== bindings.length) {
    errors.push(
      `actor interaction profiles bind ${document.bindings.length} of ${bindings.length} actors`,
    );
  }
  const actorIds = new Set();
  const modelIds = new Set();
  for (const [index, row] of document.bindings.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`actor interaction profile row ${index} must be an object`);
      continue;
    }
    for (const field of unknownFields(row, bindingFields)) {
      errors.push(
        `actor interaction profile ${row.requested_model_id ?? index} has unknown field ${field}`,
      );
    }
    const binding = bindings[index];
    if (
      !binding ||
      row.actor_id !== binding.actor_id ||
      row.requested_model_id !== binding.requested_model_id ||
      row.canonical_slug !== binding.canonical_slug
    ) {
      errors.push(
        `actor interaction profile row ${index} changed actor binding order`,
      );
    }
    if (row.route_model_id !== row.requested_model_id) {
      errors.push(
        `actor interaction profile ${row.requested_model_id} substitutes its exact model id`,
      );
    }
    if (actorIds.has(row.actor_id)) {
      errors.push(`actor interaction profiles repeat actor ${row.actor_id}`);
    }
    if (modelIds.has(row.requested_model_id)) {
      errors.push(
        `actor interaction profiles repeat model ${row.requested_model_id}`,
      );
    }
    actorIds.add(row.actor_id);
    modelIds.add(row.requested_model_id);
    if (!Array.isArray(row.profiles) || row.profiles.length === 0) {
      errors.push(
        `actor interaction profile ${row.requested_model_id} has no native profiles`,
      );
      continue;
    }
    const kinds = new Set();
    for (const profile of row.profiles) {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        errors.push(
          `actor interaction profile ${row.requested_model_id} contains a non-object profile`,
        );
        continue;
      }
      for (const field of unknownFields(profile, profileFields)) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/${profile.kind ?? "unknown"} has unknown field ${field}`,
        );
      }
      if (!ACTOR_INTERACTION_KINDS.includes(profile.kind)) {
        errors.push(
          `actor interaction profile ${row.requested_model_id} has unknown kind ${profile.kind}`,
        );
      } else if (kinds.has(profile.kind)) {
        errors.push(
          `actor interaction profile ${row.requested_model_id} repeats kind ${profile.kind}`,
        );
      }
      kinds.add(profile.kind);
      if (profile.endpoint !== profileEndpoints[profile.kind]) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/${profile.kind} has the wrong endpoint`,
        );
      }
      if (profile.provider_available !== (profile.disabled_reason === null)) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/${profile.kind} contradicts its disabled reason`,
        );
      }
      if (
        profile.runtime_adapter_supported !==
        (profile.runtime_adapter_unsupported_reason === null)
      ) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/${profile.kind} contradicts its runtime adapter reason`,
        );
      }
      if (
        !Array.isArray(profile.accepted_inputs) ||
        !Array.isArray(profile.outputs) ||
        !Array.isArray(profile.required_parameters) ||
        !profile.defaults ||
        typeof profile.defaults !== "object" ||
        Array.isArray(profile.defaults)
      ) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/${profile.kind} has invalid parameters`,
        );
      }
      if (profile.kind === "create_video" && profile.endpoint_zdr !== false) {
        errors.push(
          `actor interaction profile ${row.requested_model_id}/create_video must declare endpoint_zdr false`,
        );
      }
      if (profile.kind === "speak") {
        const authoritativeVoice =
          TTS_DEFAULT_VOICES[row.requested_model_id] ?? null;
        const hasUnexpectedVoice =
          authoritativeVoice === null
            ? Object.hasOwn(profile.defaults, "voice")
            : profile.defaults.voice !== authoritativeVoice;
        if (
          hasUnexpectedVoice ||
          profile.defaults.response_format !== "mp3"
        ) {
          errors.push(
            `actor interaction profile ${row.requested_model_id}/speak differs from its authoritative voice or MP3 format`,
          );
        }
        if (
          profile.runtime_adapter_supported !==
          (profile.provider_available && authoritativeVoice !== null)
        ) {
          errors.push(
            `actor interaction profile ${row.requested_model_id}/speak has an unsafe runtime adapter gate`,
          );
        }
        if (
          authoritativeVoice === null &&
          (profile.provider_available ||
            profile.disabled_reason !== ttsVoiceReason ||
            profile.runtime_adapter_unsupported_reason !== ttsVoiceReason)
        ) {
          errors.push(
            `actor interaction profile ${row.requested_model_id}/speak without an authoritative voice must remain disabled`,
          );
        }
      }
    }
    if (archivedModelIds.has(row.requested_model_id)) {
      if (
        row.availability !== "archived" ||
        row.profiles.some((profile) => profile.provider_available)
      ) {
        errors.push(
          `archived actor interaction profile ${row.requested_model_id} must stay disabled`,
        );
      }
    }
    if (
      binding &&
      JSON.stringify(row) !== JSON.stringify(expected.bindings[index])
    ) {
      errors.push(
        `actor interaction profile ${row.requested_model_id ?? index} differs from its deterministic profile`,
      );
    }
  }
  return errors;
}

export function indexActorInteractionProfiles(document) {
  const byActorId = new Map();
  const byRequestedModelId = new Map();
  for (const row of document.bindings ?? []) {
    if (
      byActorId.has(row.actor_id) ||
      byRequestedModelId.has(row.requested_model_id)
    ) {
      throw new Error(
        "actor interaction profile index contains a duplicate binding",
      );
    }
    byActorId.set(row.actor_id, row);
    byRequestedModelId.set(row.requested_model_id, row);
  }
  return { byActorId, byRequestedModelId };
}

export function exactInteractionProfileForActor(document, actorId, kind) {
  const { byActorId } = indexActorInteractionProfiles(document);
  const binding = byActorId.get(actorId);
  if (!binding) return null;
  const profile = binding.profiles.find((candidate) => candidate.kind === kind);
  if (!profile) return null;
  return {
    requested_model_id: binding.requested_model_id,
    route_model_id: binding.route_model_id,
    canonical_slug: binding.canonical_slug,
    availability: binding.availability,
    profile,
  };
}
