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

  const rawPack = exports.get("supports_raw_pack") === "function";
  return (request, packContentJson) => {
    let input = encoder.encode(JSON.stringify(request));
    if (!input.length || input.length > MAX_JSON_BYTES)
      throw new Error("Invalid rules WASM request size");
    if (packContentJson !== undefined) {
      const pack =
        typeof packContentJson === "string"
          ? encoder.encode(packContentJson)
          : null;
      if (
        !pack ||
        pack.length > MAX_JSON_BYTES ||
        request === null ||
        typeof request !== "object" ||
        Array.isArray(request)
      )
        throw new Error("Invalid rules WASM pack content or request");
      const key =
        typeof request.action === "string"
          ? request.action
          : request.action?.key;
      const atticPlay =
        request.op === "play" &&
        (key === "wait:vale::" ||
          key === "drop:vale:lamp:attic" ||
          key === "take:vale:lamp:");
      const pondPlay =
        request.op === "play" &&
        (key === "move:vale::pond" || key === "move:vale:lamp:pond");
      const pondSpeech =
        request.op === "speech" &&
        request.world?.actors?.vale?.place === "pond";
      const ordered =
        [
          "opening_wait_roster",
          "opening_mirror_move",
          "opening_station_move",
          "opening_pond_ask",
          "opening_pond_place_returns",
          "opening_pond_resident_sleep",
          "opening_visitor_play",
          "opening_second_resident_round",
          "opening_full_move",
        ].includes(request.op) ||
        atticPlay ||
        pondPlay ||
        pondSpeech;
      const actors = ordered ? request.world?.actors : null;
      const actorOrder =
        actors && typeof actors === "object" && !Array.isArray(actors)
          ? Object.keys(actors)
          : undefined;
      const cards =
        [
          "opening_place_return",
          "opening_pond_place_returns",
          "opening_pond_ask",
          "opening_full_move",
        ].includes(request.op) ||
        ((atticPlay || pondPlay) && request.world?.began === 480)
          ? request.world?.placeCard
          : null;
      const placeCardOrder =
        cards && typeof cards === "object" && !Array.isArray(cards)
          ? Object.keys(cards)
          : undefined;
      const prepared = {
        ...request,
        packContentJson: undefined,
        actorOrder,
        placeCardOrder,
      };
      input =
        rawPack && !/[\uD800-\uDFFF]/u.test(packContentJson)
          ? packRequest(encoder.encode(JSON.stringify(prepared)), pack)
          : null;
      input ??= encoder.encode(
        JSON.stringify({ ...prepared, packContentJson }),
      );
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

function packRequest(request, pack) {
  if (!request.length || request.length > MAX_JSON_BYTES) return null;
  const input = new Uint8Array(5 + request.length + pack.length);
  new DataView(input.buffer).setUint32(1, request.length, true);
  input.set(request, 5);
  input.set(pack, 5 + request.length);
  return input;
}

function buffer(memory, offset, length) {
  if (!offset || length > memory.buffer.byteLength - offset)
    throw new Error("Rules WASM buffer is outside guest memory");
  return new Uint8Array(memory.buffer, offset, length);
}
