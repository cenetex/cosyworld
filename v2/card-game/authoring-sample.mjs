import sample from "./assets/authoring-lantern-shore.json" with { type: "json" };
import { assetMetadata, importPack } from "./authoring-draft.mjs";

export function sampleSource() {
  return structuredClone({ pack: sample.pack, bridge: sample.bridge });
}
export const sampleExample = () => structuredClone(sample.example);

// The editable sample owns copies of the same paintings used by the game.
// Its logical paths follow the pack schema and travel with a saved draft.
export async function createSampleWorld({ fetch: fetcher = fetch } = {}) {
  const assets = new Map();
  const metadata = await Promise.all(
    Object.entries(sample.images).map(async ([name, original]) => {
      const mime = original.mime || "image/webp";
      const response = await fetcher(
        original.source || `assets/optimized/stage/png/${original}.webp`,
      );
      if (!response.ok)
        throw new Error("Try loading the sample artwork again.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const path = `assets/lantern-shore/${name}.${mime === "image/png" ? "png" : "webp"}`;
      const meta = await assetMetadata(path, mime, bytes);
      assets.set(path, bytes);
      return meta;
    }),
  );
  return {
    draft: importPack({ ...sampleSource(), assets: metadata }),
    launch: { schemaVersion: 1, place: sample.pack.entry },
    assets,
  };
}
