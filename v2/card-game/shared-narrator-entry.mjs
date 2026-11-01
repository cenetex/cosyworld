// Dialogue context for committed shared plays. Rust sends its output to the
// story service; it is never a journal input, so this bundle is rebuilt from
// current sources and never versioned. See
// docs/design/pack-content-outside-the-engine.md.
import { sharedScene } from "./shared-narrator.mjs";
if (typeof globalThis.structuredClone !== "function")
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
if (typeof Array.prototype.findLast !== "function")
  Object.defineProperty(Array.prototype, "findLast", {
    value(predicate) {
      for (let i = this.length - 1; i >= 0; i--)
        if (predicate(this[i], i, this)) return this[i];
    },
  });
globalThis.cardNarrator = (json) => {
  try {
    return JSON.stringify({ ok: true, ...sharedScene(JSON.parse(json)) });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error.message || "The scene could not be described.",
    });
  }
};
