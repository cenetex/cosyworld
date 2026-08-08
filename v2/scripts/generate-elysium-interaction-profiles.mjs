import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  actorInteractionProfileValidationErrors,
  buildActorInteractionProfileDocument,
  indexActorInteractionProfiles,
} from "./actor-interaction-profile-schema.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const v2Root = path.resolve(scriptDir, "..");

export const ELYSIUM_ACTOR_MODEL_BINDINGS_PATH = path.join(
  v2Root,
  "content",
  "elysium",
  "actor_model_bindings.json",
);
export const ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH = path.join(
  v2Root,
  "content",
  "elysium",
  "actor_interaction_profiles.json",
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function loadPinnedElysiumInteractionProfiles() {
  const bindings = readJson(ELYSIUM_ACTOR_MODEL_BINDINGS_PATH);
  const document = readJson(ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH);
  const errors = actorInteractionProfileValidationErrors(document, bindings);
  if (errors.length > 0) {
    throw new Error(
      `invalid Elysium interaction profiles: ${errors.join("; ")}`,
    );
  }
  return {
    document,
    ...indexActorInteractionProfiles(document),
  };
}

export function expectedPinnedElysiumInteractionProfiles() {
  return buildActorInteractionProfileDocument(
    readJson(ELYSIUM_ACTOR_MODEL_BINDINGS_PATH),
  );
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--write") && args.has("--check")) {
    throw new Error("choose either --write or --check");
  }
  const expected = expectedPinnedElysiumInteractionProfiles();
  if (args.has("--write")) {
    fs.writeFileSync(ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH, json(expected));
    console.log(
      `wrote ${expected.bindings.length} pinned Elysium actor interaction profiles`,
    );
    return;
  }
  const actual = readJson(ELYSIUM_ACTOR_INTERACTION_PROFILES_PATH);
  const bindings = readJson(ELYSIUM_ACTOR_MODEL_BINDINGS_PATH);
  const errors = actorInteractionProfileValidationErrors(actual, bindings);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  if (json(actual) !== json(expected)) {
    throw new Error(
      "Elysium actor interaction profiles are stale; run this script with --write",
    );
  }
  console.log(
    `checked ${actual.bindings.length} pinned Elysium actor interaction profiles`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
