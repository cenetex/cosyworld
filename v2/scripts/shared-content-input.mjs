// esbuild plugin for the shared rules bundle: when content input is on, every
// JSON module the rules import is read from globalThis.cardContent, which the
// Rust host fills from a stored content revision, instead of being baked in.
// See docs/design/pack-content-outside-the-engine.md.
import { relative, resolve } from "node:path";

// On from the v58 rules.
export const CONTENT_INPUT = true;

export function sharedContentInput(root) {
  return {
    name: "shared-content-input",
    setup(build) {
      if (!CONTENT_INPUT) return;
      build.onResolve({ filter: /\.json$/ }, (args) => ({
        path: relative(root, resolve(args.resolveDir, args.path)),
        namespace: "card-content",
      }));
      build.onLoad({ filter: /.*/, namespace: "card-content" }, (args) => ({
        contents: `export default globalThis.cardContent.files[${JSON.stringify(args.path)}];`,
        loader: "js",
      }));
    },
  };
}
