import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";

export async function reducers(artifact = process.env.COSYWORLD_RULES_WASM) {
  assert.ok(artifact, "Set COSYWORLD_RULES_WASM to a built rules candidate.");
  const { instance } = await WebAssembly.instantiate(await readFile(artifact));
  const guest = instance.exports;
  const reference = currentSharedEngine();
  return {
    pinned: (request) =>
      JSON.parse(reference.cardShared(JSON.stringify(request))),
    wasm(request) {
      const input = Buffer.from(JSON.stringify(request));
      const pointer = guest.reserve_input(input.length);
      assert.ok(pointer, "WASM rejected the request size");
      new Uint8Array(guest.memory.buffer, pointer, input.length).set(input);
      const length = guest.reduce();
      assert.ok(length, "WASM returned an empty response");
      const bytes = Buffer.from(
        guest.memory.buffer,
        guest.output_ptr(),
        length,
      );
      return JSON.parse(bytes.toString("utf8"));
    },
  };
}
