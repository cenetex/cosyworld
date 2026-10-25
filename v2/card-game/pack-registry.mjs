// The compiled world packs mounted on the card table, indexed for the engine.
// Packs supply data only; pack-rules.mjs applies the general rules they name.
import compiled from "./packs.json" with { type: "json" };
import { packProblems } from "./pack-schema.mjs";

const problems =
  compiled?.schemaVersion === 1 && Array.isArray(compiled.packs)
    ? compiled.packs.flatMap((pack) => packProblems(pack, compiled.hub))
    : ["packs.json needs schemaVersion 1 and a pack list"];
if (problems.length)
  throw new Error(`Invalid card world packs: ${problems.join("; ")}`);

export const hub = compiled.hub;
export const packDefinitions = compiled.packs;
export const packDefinition = (id) =>
  packDefinitions.find((p) => p.id === id) || null;

const merge = (field) =>
  Object.fromEntries(
    packDefinitions.flatMap((pack) =>
      Object.entries(pack[field] || {}).map(([id, entity]) => [
        id,
        { ...entity, packId: pack.id },
      ]),
    ),
  );
export const packPlaces = merge("places");
export const packPeople = merge("avatars");
export const packFixtures = merge("fixtures");
export const packActorIds = Object.keys(packPeople);
export const crossings = packDefinitions.flatMap((pack) =>
  pack.crossings.map((c) => ({ ...c, packId: pack.id })),
);

export const isPackActor = (id) => Object.hasOwn(packPeople, id);
export const isPackPlace = (id) => Object.hasOwn(packPlaces, id);
export const packOf = (id) =>
  packDefinition(
    (packPlaces[id] || packPeople[id] || packFixtures[id])?.packId,
  );
export const resident = (id) => packPeople[id] || null;
export const staysPut = (id) => packPeople[id]?.travels === false;
export const avoidsStandoffs = (id) => packPeople[id]?.standoffs === false;
export const fixturesAt = (place) =>
  Object.entries(packFixtures)
    .filter(([, f]) => f.at === place)
    .map(([id, f]) => ({ id, ...f }));

// Profiles for memories and the text route, in the same shape as
// entity-profiles.json. Rust reads the same compiled file.
export const packProfiles = Object.fromEntries([
  ...Object.entries(packPlaces).map(([id, p]) => [
    id,
    { kind: "location", name: p.name, idiolect: p.idiolect, lines: p.lines },
  ]),
  ...Object.entries(packPeople).map(([id, a]) => [
    id,
    { kind: "avatar", name: a.name, idiolect: a.idiolect, lines: a.lines },
  ]),
]);

// Interests use the same shape as motives.mjs tastes. How a pack resident
// values the hub's objects is composition data from its bridge. Residents
// keep to their own interests and take no personal quests.
export const packTastes = Object.fromEntries(
  Object.entries(packPeople).map(([id, a]) => [
    id,
    {
      likes: a.tastes.likes,
      sore: a.tastes.sore,
      home: a.place,
      quests: false,
      values: Object.fromEntries(
        hub.items.map((item) => [
          item,
          packDefinition(a.packId).values?.[id]?.[item] ?? 1,
        ]),
      ),
    },
  ]),
);
export const packNames = Object.fromEntries(
  [...Object.entries(packPlaces), ...Object.entries(packPeople)].map(
    ([id, e]) => [id, e.name],
  ),
);

// Every image a mounted pack shows, as paths relative to the card table.
export const packMediaFiles = [
  ...new Set(
    packDefinitions.flatMap((pack) => [
      ...Object.values(pack.places).map((p) => p.backdrop),
      ...Object.values(pack.avatars).flatMap((a) => [
        a.portrait,
        ...Object.values(a.variants || {}).map((v) => v.portrait),
      ]),
    ]),
  ),
].filter(Boolean);
