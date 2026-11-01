import { dispatchShared } from "./shared-world.mjs";
if (typeof globalThis.structuredClone !== "function")
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
if (typeof Array.prototype.findLast !== "function")
  Object.defineProperty(Array.prototype, "findLast", {
    value(predicate) {
      for (let i = this.length - 1; i >= 0; i--)
        if (predicate(this[i], i, this)) return this[i];
    },
  });
globalThis.cardShared = (json) => {
  try {
    return JSON.stringify(dispatchShared(JSON.parse(json)));
  } catch (error) {
    // A refused save names where the rules refused it, for the host log:
    // function names and bundle lines only, never the world's contents.
    const where = String(error.stack || "")
      .split("\n")
      .map((line) => /^\s*at (\S+) \(.*?:(\d+)(?::\d+)?\)$/u.exec(line))
      .filter((frame) => frame && frame[1] !== "fail")
      .slice(0, 4)
      .map(([, name, line]) => `${name}:${line}`)
      .join(" < ");
    const message =
      error.message || "The world could not resolve this request.";
    return JSON.stringify({
      ok: false,
      error:
        where && /fresh start/u.test(message)
          ? `${message} (${where})`
          : message,
    });
  }
};
