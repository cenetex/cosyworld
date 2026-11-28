const MAX_MODULE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_WIRE_BYTES = 3 * MAX_JSON_BYTES + 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function browserRules(bytes) {
  if (bytes.byteLength > MAX_MODULE_BYTES)
    throw new Error("Rules WASM artifact is too large");
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length)
    throw new Error("Rules WASM must have zero host imports");
  const exports = new Map(
    WebAssembly.Module.exports(module).map(({ name, kind }) => [name, kind]),
  );
  if (
    exports.get("memory") !== "memory" ||
    ["reserve_input", "reduce", "output_ptr"].some(
      (name) => exports.get(name) !== "function",
    )
  )
    throw new Error("Rules WASM is missing required ABI exports");

  return (request, packContentJson) => {
    let input = encoder.encode(JSON.stringify(request));
    if (!input.length || input.length > MAX_JSON_BYTES)
      throw new Error("Invalid rules WASM request size");
    if (packContentJson !== undefined) {
      if (
        typeof packContentJson !== "string" ||
        encoder.encode(packContentJson).length > MAX_JSON_BYTES ||
        request === null ||
        typeof request !== "object" ||
        Array.isArray(request)
      )
        throw new Error("Invalid rules WASM pack content or request");
      input = encoder.encode(JSON.stringify({ ...request, packContentJson }));
      if (input.length > MAX_WIRE_BYTES)
        throw new Error("Rules WASM input is too large");
    }
    const {
      exports: { memory, reserve_input, reduce, output_ptr },
    } = new WebAssembly.Instance(module);
    const inputOffset = reserve_input(input.length) >>> 0;
    buffer(memory, inputOffset, input.length).set(input);
    const outputLength = reduce() >>> 0;
    if (!outputLength || outputLength > MAX_JSON_BYTES)
      throw new Error("Invalid rules WASM response size");
    const output = buffer(memory, output_ptr() >>> 0, outputLength);
    const result = JSON.parse(decoder.decode(output));
    if (result !== null && typeof result?.ok !== "boolean")
      throw new Error("Rules WASM response must include an outcome");
    return result;
  };
}

function buffer(memory, offset, length) {
  if (!offset || length > memory.buffer.byteLength - offset)
    throw new Error("Rules WASM buffer is outside guest memory");
  return new Uint8Array(memory.buffer, offset, length);
}
