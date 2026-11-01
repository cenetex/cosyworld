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
    // The host logs where the rules refused: function names and bundle
    // lines only, never the world's contents.
    return JSON.stringify({
      ok: false,
      error: error.message || "The world could not resolve this request.",
      reason: String(error.stack || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("at "))
        .slice(0, 6)
        .join(" < ")
        .slice(0, 400),
    });
  }
};
