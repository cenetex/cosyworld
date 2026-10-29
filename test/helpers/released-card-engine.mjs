import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";

export function currentCardEngine() {
  const owner = readFileSync(
    new URL(
      "../../v2/orchestrator-rust/src/card_shared/engine.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const version = owner.match(
    /const SOURCE: &str = include_str!\("engine-v(\d+)\.js"\)/,
  )?.[1];
  if (!version)
    throw new Error("The current shared engine needs its source bundle.");
  return releasedCardEngine(Number(version));
}

// Inspect the frozen interpreter in a test realm. The checked-in bytes stay exact.
export function releasedCardEngine(version = 20) {
  const source = readFileSync(
    new URL(
      `../../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  const marker = "  globalThis.cardShared = (json) => {";
  if (!source.includes(marker))
    throw Error("Choose a released card interpreter.");
  const realm = createContext({ structuredClone });
  new Script(
    source.replace(
      marker,
      "  globalThis.released = {packs: packDefinitions, authoredStoryDefinitions, recitalPoem};\n" +
        marker,
    ),
  ).runInContext(realm, { timeout: 2000 });
  const call = (expression, input) => {
    realm.input = structuredClone(input);
    return JSON.parse(
      new Script(`JSON.stringify(${expression})`).runInContext(realm, {
        timeout: 2000,
      }),
    );
  };
  return {
    packs: call("released.packs"),
    definitions: (world, packs, options) =>
      call(
        "released.authoredStoryDefinitions(input.world, input.packs, input.options)",
        { world, packs, options },
      ),
    poem: (world, pack) =>
      call("released.recitalPoem(input.world, input.pack)", { world, pack }),
    dispatch: (request) =>
      call("JSON.parse(cardShared(JSON.stringify(input)))", request),
  };
}
