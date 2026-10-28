import { packDefinitions, entityActive } from "./pack-registry.mjs";
import { currentReadingCatalog, readingCatalogs } from "./poem-catalogs.mjs";
import { readingPage } from "./poem-readings.mjs";

const maskFor = (reading, audience) => {
  const bits = audience.map((id) => reading.audience.indexOf(id));
  return bits.some((bit) => bit < 0)
    ? null
    : bits.reduce((mask, bit) => mask | (1 << bit), 0);
};
const source = (world, ref) => {
  const state = world.packs?.[ref?.[0]]?.poemReadings;
  const reading = state?.readings[ref?.[1]];
  const page = reading?.pages[ref?.[2]];
  return page ? { state, reading, page } : null;
};

export function validRecallRef(world, ref, audience) {
  if (ref === undefined) return true;
  if (!Array.isArray(ref) || ref.length !== 3 || !audience?.length)
    return false;
  const saved = source(world, ref);
  if (!saved) return false;
  const mask = maskFor(saved.reading, audience);
  return mask !== null && (saved.page[2] & mask) === mask;
}

// A new audience shares only pages already heard by everyone in that audience.
export function readingSpeechScope(world, played, audience) {
  audience = audience.filter((id) => entityActive(world, id));
  if (played?.privateTo)
    return {
      privateTo: [...played.privateTo],
      ...(played.hearing ? { hearing: [...played.hearing] } : {}),
    };
  if (!audience.length) return {};
  let latest = null;
  for (const pack of packDefinitions) {
    const state = world.packs[pack.id]?.poemReadings;
    if (!state) continue;
    for (const [id, reading] of Object.entries(state.readings)) {
      const mask = maskFor(reading, audience);
      if (mask === null) continue;
      for (const [index, page] of reading.pages.entries())
        if ((page[2] & mask) === mask && (!latest || page[0] > latest.turn))
          latest = { turn: page[0], ref: [pack.id, id, index] };
    }
  }
  return latest ? { privateTo: [...audience], recall: latest.ref } : {};
}

export function readingPoem(world, scope, recipient) {
  const ref = scope.hearing?.slice(0, 3) || scope.recall;
  if (!ref || !scope.privateTo?.includes(recipient)) return null;
  const saved = source(world, ref);
  if (!saved || !validRecallRef(world, ref, scope.privateTo)) return null;
  const { state, reading, page } = saved;
  const catalog = readingCatalogs[ref[0]][reading.catalog];
  const tuples = reading.selection
    .slice(ref[2] * 4, (ref[2] + 1) * 4)
    .map((index) => [...state.stanzas[index]]);
  const stanzas = readingPage(state, reading, catalog, ref[2]);
  return {
    title: catalog.title,
    stanzas,
    newLines: stanzas.flatMap((stanza) => stanza.lines),
    heard: {
      pack: ref[0],
      catalog: catalog.id,
      catalogDigest: catalog.digest,
      readingId: ref[1],
      reader: reading.reader,
      readingTurn: reading.turn,
      through: reading.through,
      page: ref[2],
      pageCount: Math.max(1, Math.ceil(reading.selection.length / 4)),
      stanzaCount: reading.selection.length,
      publishedTurn: page[0],
      poemDigest: reading.poemDigest,
      audience: [...scope.privateTo],
      tuples,
      afterTurns: tuples.map(([row]) => {
        const prior =
          world.packs[ref[0]].receipts[catalog.rows[row].after?.choice];
        return Number.isSafeInteger(prior) && prior <= reading.through
          ? prior
          : null;
      }),
    },
  };
}

export const privateSpeechFields = (context) =>
  context.privateTo
    ? {
        privateTo: [...context.privateTo],
        ...(context.hearing ? { hearing: [...context.hearing] } : {}),
        ...(context.recall ? { recall: [...context.recall] } : {}),
      }
    : {};

const words = (text) =>
  text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") || "";
const runs = (text) => {
  const all = words(text).split(" ");
  if (all.length < 4) return [];
  const size = Math.min(6, all.length);
  return Array.from({ length: all.length - size + 1 }, (_, i) =>
    all.slice(i, i + size).join(" "),
  );
};
let canonical = null;
function canonicalRuns() {
  if (!canonical)
    canonical = [
      ...new Set(
        packDefinitions.flatMap((pack) => {
          const catalog = currentReadingCatalog(pack.id);
          return (catalog?.rows || []).flatMap((row) =>
            [...row.lines, ...(row.after?.lines || [])].flatMap(runs),
          );
        }),
      ),
    ];
  return canonical;
}

// Check the same filtered evidence used for this speaker's prompt.
export function readingQuoteAllowed(world, context, id, text) {
  if (!packDefinitions.some((pack) => world.packs[pack.id]?.poemReadings))
    return true;
  const entity = context.entities.find((entry) => entry.id === id);
  const allowed = words(
    [
      ...(entity?.poem?.stanzas || []).flatMap((stanza) => stanza.lines),
      ...(entity?.memories || []).map((memory) => memory.text),
      entity?.previous || "",
      ...(context.events || []),
      ...(context.conversation || []).map((line) => line.text),
    ].join(" "),
  );
  const spoken = ` ${words(text)} `;
  const evidence = ` ${allowed} `;
  return canonicalRuns().every(
    (run) => !spoken.includes(` ${run} `) || evidence.includes(` ${run} `),
  );
}
