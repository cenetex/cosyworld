import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { browserRules } from "../browser.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function reduceInput(module, input) {
  const { memory, reserve_input, reduce, output_ptr } =
    new WebAssembly.Instance(module).exports;
  const ptr = reserve_input(input.length);
  assert.ok(ptr);
  new Uint8Array(memory.buffer, ptr, input.length).set(input);
  const size = reduce();
  if (!size) return undefined;
  return JSON.parse(
    decoder.decode(new Uint8Array(memory.buffer, output_ptr(), size)),
  );
}

test("the raw-pack guest still accepts the old JSON wire format", async () => {
  const [bytes, packContentJson] = await Promise.all([
    readFile(process.env.COSYWORLD_RULES_WASM),
    readFile(
      new URL(
        "../../orchestrator-rust/src/card_shared/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const module = new WebAssembly.Module(bytes);
  assert.ok(
    WebAssembly.Module.exports(module).some(
      ({ name, kind }) => name === "supports_raw_pack" && kind === "function",
    ),
  );
  const request = { op: "create", seed: 17 };
  const legacy = reduceInput(
    module,
    encoder.encode(JSON.stringify({ ...request, packContentJson })),
  );
  assert.equal(legacy.ok, true);
  assert.deepEqual(browserRules(bytes)(request, packContentJson), legacy);
  assert.equal(reduceInput(module, Uint8Array.of(0, 16, 0, 0, 0)), undefined);
  assert.equal(
    reduceInput(module, Uint8Array.of(0, 2, 0, 0, 0, 123, 125, 255)),
    undefined,
  );
});
