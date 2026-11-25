import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const number = (name) => /engine-v(\d+)\.js$/u.exec(name)?.[1];
const read = async (bundle) =>
  JSON.parse(await readFile(new URL("rules.json", bundle), "utf8"));

export async function pinned(bundle, text) {
  return (await read(bundle))[number(bundle.pathname)] === sha(text);
}

export async function pin(bundle, text) {
  const pins = await read(bundle);
  pins[number(bundle.pathname)] = sha(text);
  for (const name of await readdir(new URL("./", bundle)))
    if (number(name) && !pins[number(name)])
      pins[number(name)] = sha(await readFile(new URL(name, bundle)));
  await writeFile(
    new URL("rules.json", bundle),
    `${JSON.stringify(pins, null, 2)}\n`,
  );
}
