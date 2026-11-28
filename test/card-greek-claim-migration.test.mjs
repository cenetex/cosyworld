import { expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const migrations = [
  [41, "greek-troezen", "hippolytus", "greek-troezen-witness-tablet", "first"],
  [42, "greek-ion-court", "ion", "greek-delphi-witness-tablet", "first"],
  [
    42,
    "greek-heracles-altar",
    "heracles",
    "greek-theban-messenger-pledge",
    "second",
  ],
].flatMap(([revision, place, work, formerBook, answer]) =>
  [false, true].map((alsoReadRecord) => ({
    revision,
    place,
    work,
    formerBook,
    answer,
    alsoReadRecord,
  })),
);

it.each(migrations)(
  "carries the $work portable claim onto its posted record, with an existing reader: $alsoReadRecord",
  ({ revision, place, work, formerBook, answer, alsoReadRecord }) => {
    const episode = `greek-story-euripides-${work}`;
    const record = `${episode}-record`;
    const response = `${episode}-${answer}-answer`;
    const from = `claim:${PACK}:${formerBook}:account`;
    const to = `claim:${PACK}:${record}:${response}`;
    const t = traveler(greekStart());
    t.s.actors.vale.place = place;
    t.s.actors.vale.visited.push(place);
    t.talk(`${episode}-first`)
      .take(`${episode}-object`)
      .give(`${episode}-object`, `${episode}-${answer}`)
      .act("read", { item: record });

    const old = structuredClone(t.s);
    old.packs[PACK].revision = revision;
    old.items[formerBook] = { holder: "vale", history: [] };
    const canonical = old.knowledge.facts[to];
    const read = old.knowledge.known.vale[to];
    old.knowledge.facts[from] = {
      id: from,
      text: canonical.text,
      source: {
        ...canonical.source,
        book: formerBook,
        claim: "account",
        author: `${episode}-${answer}`,
      },
    };
    old.knowledge.known.vale[from] = { ...read, book: formerBook };
    if (!alsoReadRecord) {
      delete old.knowledge.facts[to];
      delete old.knowledge.known.vale[to];
    }

    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.items[formerBook]).toBeUndefined();
    expect(loaded.knowledge.facts[from]).toBeUndefined();
    expect(loaded.packs[PACK].receipts[response]).toBe(
      old.packs[PACK].receipts[response],
    );
    expect(loaded.knowledge.facts[to]).toEqual(canonical);
    expect(loaded.knowledge.known.vale[to]).toEqual(read);
    expect(knowsFact(decodeSave(encodeSave(loaded)), "vale", to)).toBe(true);
  },
);
