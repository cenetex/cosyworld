import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(scriptDir, "../content/hoppycat-archive");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(packRoot, fileName), "utf8"));
}

test("Hoppycat residents are a mobile illustrated cast led by Hoppy Cat", () => {
  const actors = readJson("actors.json");
  const cards = readJson("cards.json");
  const manifest = readJson("pack.json");

  assert.equal(actors.length, 9);
  assert.ok(actors.every((actor) => actor.ambient_autonomy === true));
  assert.ok(actors.every((actor) => actor.roaming === true));

  const hoppy = actors.find((actor) => actor.id === 771008);
  assert.equal(hoppy?.name, "Hoppy Cat");
  assert.equal(hoppy?.title, "Broadcaster Between Worlds");
  assert.match(hoppy?.identity?.appearance ?? "", /green hair/i);
  assert.match(hoppy?.identity?.appearance ?? "", /blue hoodie/i);
  assert.match(hoppy?.identity?.appearance ?? "", /microphone/i);

  const illustratedCards = cards.filter((card) =>
    card.subject_kind === "actor" || card.subject_kind === "location");
  assert.equal(illustratedCards.length, 19);
  assert.ok(illustratedCards.every((card) => card.asset_status === "generated_art"));

  const mount = manifest.assets.find((asset) => asset.mount === "cards");
  assert.equal(mount?.public_prefix, "/assets/hoppycat/cards");
  for (const card of illustratedCards) {
    assert.ok(card.image_url.startsWith(`${mount.public_prefix}/`));
    const fileName = card.image_url.slice(mount.public_prefix.length + 1);
    const assetPath = path.join(packRoot, mount.directory, fileName);
    assert.ok(fs.statSync(assetPath).size > 10_000, `${card.card_id} has usable art`);
  }

  const itemCards = cards.filter((card) => card.subject_kind === "item");
  assert.equal(itemCards.length, 10);
  assert.ok(itemCards.every((card) => card.asset_status === "pending_art"));
});

test("every Hoppycat location is reachable by roaming residents", () => {
  const locationIds = readJson("locations.json").map((location) => location.id);
  const exits = readJson("exits.json");
  const reachable = new Set([locationIds[0]]);
  const pending = [locationIds[0]];

  while (pending.length) {
    const current = pending.shift();
    for (const exit of exits.filter((candidate) =>
      candidate.from_location_id === current && candidate.distance === 1)) {
      if (!reachable.has(exit.to_location_id)) {
        reachable.add(exit.to_location_id);
        pending.push(exit.to_location_id);
      }
    }
  }

  assert.deepEqual([...reachable].sort(), [...locationIds].sort());
  assert.ok(locationIds.every((id) =>
    exits.some((exit) => exit.from_location_id === id && exit.distance === 1)));
});
