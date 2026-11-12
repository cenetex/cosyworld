const REASONS = {
  transition: "That play could not be made. The world is as it was.",
  incompatible: "This save cannot be opened by this version of the game.",
  invariant: "This turn could not be saved. Your last save is kept.",
  storage: "The saved game could not be reached.",
};

export class SaveFault extends Error {
  constructor(kind, phase, cause) {
    super(REASONS[kind], { cause });
    this.name = "SaveFault";
    this.kind = kind;
    this.phase = phase;
    this.code = `save.${kind}.${phase}`;
  }
}

const SAFE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const whole = (n) => (Number.isSafeInteger(n) ? n : null);

export function saveDiagnostic(fault, { world, action, build } = {}) {
  const ids = Object.values(action || {}).filter(
    (value) => typeof value === "string" && SAFE_ID.test(value),
  );
  return {
    code: fault.code,
    schema: whole(world?.schema),
    turn: whole(world?.turn),
    revision: whole(world?.revision),
    ids: ids.slice(0, 8),
    build: typeof build === "string" ? build.slice(0, 80) : null,
  };
}

export function sealSave(world, { encode, read }) {
  let text;
  try {
    text = encode(world);
  } catch (cause) {
    throw new SaveFault("invariant", "encode", cause);
  }
  try {
    read(text);
  } catch (cause) {
    throw new SaveFault("invariant", "readback", cause);
  }
  return text;
}

export function writeSave(storage, key, world, codec) {
  const text = sealSave(world, codec);
  try {
    storage.setItem(key, text);
  } catch (cause) {
    throw new SaveFault("storage", "write", cause);
  }
  return text;
}

export function openSave(text, { read, schema }) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new SaveFault("incompatible", "parse", cause);
  }
  if (parsed?.schema !== schema)
    throw new SaveFault("incompatible", "schema", null);
  try {
    return read(text);
  } catch (cause) {
    throw new SaveFault("incompatible", "rules", cause);
  }
}

export const faultOf = (error, kind, phase) =>
  error instanceof SaveFault ? error : new SaveFault(kind, phase, error);

export const loadFault = (error, text) =>
  faultOf(error, text ? "incompatible" : "storage", "load");

export function attemptPlay(step, codec) {
  let result;
  try {
    result = step();
  } catch (cause) {
    result = { fault: new SaveFault("transition", "play", cause) };
  }
  if (result.ok)
    try {
      sealSave(result.state, codec);
    } catch (cause) {
      result = { fault: new SaveFault("transition", "successor", cause) };
    }
  return result.fault
    ? { ok: false, error: result.fault.message, fault: result.fault }
    : result;
}
