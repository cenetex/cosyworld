import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { browserRules } from "../browser.mjs";

export async function reducers(artifact = process.env.COSYWORLD_RULES_WASM) {
  assert.ok(artifact, "Set COSYWORLD_RULES_WASM to a built rules candidate.");
  const [bytes, pack] = await Promise.all([
    readFile(artifact),
    readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const guest = browserRules(bytes);
  const reference = currentSharedEngine();
  return {
    pinned: (request) =>
      JSON.parse(reference.cardShared(JSON.stringify(request))),
    wasm: (request, packContentJson = pack) => guest(request, packContentJson),
  };
}
