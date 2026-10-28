const header = "x-cosyworld-sync";
const cursor = (head) => `${head.stream}:${head.sequence}:${head.hash}`;
const digest = async (text) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

function apply(state, patches) {
  for (const patch of patches) {
    if (
      !Array.isArray(patch.path) ||
      patch.path.length === 0 ||
      patch.path.some(
        (key) =>
          typeof key !== "string" ||
          ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      throw new Error("The sync path needs a fresh view.");
    const key = patch.path.at(-1);
    const parent = patch.path.slice(0, -1).reduce((value, key) => {
      if (!Object.hasOwn(value, key))
        throw new Error("The sync path needs a fresh view.");
      return value[key];
    }, state);
    if (patch.op === "set") parent[key] = patch.value;
    else if (patch.op === "remove") {
      if (!Object.hasOwn(parent, key))
        throw new Error("The sync path needs a fresh view.");
      delete parent[key];
    } else if (patch.op === "splice") {
      const target = parent[key];
      if (
        !Array.isArray(target) ||
        !Number.isSafeInteger(patch.start) ||
        patch.start < 0 ||
        patch.start > target.length ||
        !Number.isSafeInteger(patch.delete) ||
        patch.delete < 0 ||
        patch.delete > target.length - patch.start ||
        !Array.isArray(patch.items)
      )
        throw new Error("The sync list needs a fresh view.");
      target.splice(patch.start, patch.delete, ...patch.items);
    } else throw new Error("The sync change needs a fresh view.");
  }
  return state;
}

// Serialize response adoption while reads and commands can travel together.
// Recovery always reads the view, so a submitted play keeps its original key.
export function createSharedSync(request) {
  let state,
    head,
    pending = Promise.resolve();
  const isOlder = (next) =>
    state &&
    (next.now < state.now || next.world?.revision < state.world?.revision);
  async function receive(value) {
    if (!value.sync) {
      if (isOlder(value)) return state;
      state = value;
      head = undefined;
      return state;
    }
    const next = value.sync.head;
    if (
      !next ||
      typeof next.stream !== "string" ||
      !Number.isSafeInteger(next.sequence) ||
      next.sequence < 0 ||
      !/^[a-f0-9]{64}$/.test(next.hash)
    )
      throw new Error("The sync cursor needs a fresh view.");
    if (value.sync.kind === "snapshot") {
      if (
        isOlder(value.state) ||
        (head?.stream === next.stream && next.sequence < head.sequence)
      )
        return state;
      state = value.state;
      head = next;
      return state;
    }
    if (
      value.sync.kind !== "events" ||
      !Array.isArray(value.events) ||
      !state ||
      !head ||
      head.stream !== next.stream
    )
      throw new Error("The sync chain needs a fresh view.");
    if (next.sequence < head.sequence) return state;
    let position = head;
    const changed = structuredClone(state);
    for (const event of value.events) {
      if (event.sequence <= position.sequence) continue;
      if (
        event.sequence !== position.sequence + 1 ||
        event.previous !== position.hash ||
        typeof event.payload !== "string" ||
        (await digest(
          `${next.stream}\n${event.sequence}\n${event.previous}\n${event.payload}`,
        )) !== event.hash
      )
        throw new Error("The sync chain needs a fresh view.");
      apply(changed, JSON.parse(event.payload));
      position = {
        stream: next.stream,
        sequence: event.sequence,
        hash: event.hash,
      };
    }
    if (position.sequence !== next.sequence || position.hash !== next.hash)
      throw new Error("The sync chain needs a fresh view.");
    changed.now = value.now;
    if (isOlder(changed)) return state;
    state = changed;
    head = next;
    return state;
  }
  return async (body) => {
    const value = await request(body, {
      [header]: head ? cursor(head) : "snapshot",
    });
    const result = pending.then(async () => {
      try {
        return await receive(value);
      } catch {
        try {
          return await receive(
            await request(undefined, {
              [header]: head ? cursor(head) : "snapshot",
            }),
          );
        } catch {
          return receive(await request(undefined, { [header]: "snapshot" }));
        }
      }
    });
    pending = result.catch(() => {});
    return result;
  };
}
