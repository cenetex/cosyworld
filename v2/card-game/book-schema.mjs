import {
  FACT_LINE_LIMIT,
  heardClaim,
  safeId,
  validFactText,
} from "./knowledge.mjs";
import { mediaPathOk } from "./pack-schema.mjs";

export const BOOK_KEYS = [
  "author",
  "claims",
  "lifecycle",
  "pages",
  "teachesQuest",
  "questReadText",
  "recordText",
];
export const BOOK_CLAIMS = 3;
export const LIFECYCLES = ["kept", "spent", "fixed"];
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const owns = (o, key) =>
  record(o) && typeof key === "string" && Object.hasOwn(o, key);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);

export function knowledgeAuthor(pack, id) {
  if (!safeId(id)) return null;
  const topic = (pack.topics || []).find((entry) => entry.id === id);
  if (topic) return topic.speaker;
  const [kind, packId, book, claim] = id.split(":");
  if (
    kind !== "claim" ||
    packId !== pack.id ||
    id !== `claim:${packId}:${book}:${claim}` ||
    !owns(pack.items, book)
  )
    return null;
  const item = pack.items[book];
  const records = Array.isArray(item.records) ? item.records : [];
  const claims = Array.isArray(item.claims) ? item.claims : [];
  return records.includes(claim) || claims.some((entry) => entry?.id === claim)
    ? item.author ?? null
    : null;
}

export function bookProblems(pack) {
  const problems = [];
  const cards = [pack.places, pack.avatars, pack.items];
  const card = (id) => cards.find((all) => owns(all, id))?.[id];
  for (const [id, item] of Object.entries(record(pack.items) ? pack.items : {})) {
    if (!record(item) || BOOK_KEYS.every((key) => item[key] === undefined))
      continue;
    const fail = (message) => problems.push(`${pack.id}: item ${id} ${message}`);
    const claims = Array.isArray(item.claims) ? item.claims : [];
    const records = [].concat(item.records ?? []);
    if (
      claims.length + records.length > BOOK_CLAIMS ||
      !(claims.length || (item.claims === undefined && records.length))
    )
      fail(`needs one to ${BOOK_CLAIMS} claims and recorded choices`);
    const author = card(item.author)?.name;
    if (typeof author !== "string")
      fail("author must be a named place, avatar or item of this pack");
    if (
      item.recordText !== undefined &&
      !(record(item.recordText) &&
        Object.keys(item.recordText).length > 0 &&
        Object.entries(item.recordText).every(
          ([choice, text]) =>
            records.includes(choice) &&
            validFactText(text) &&
            (typeof author !== "string" || heardClaim(author, text).length <= FACT_LINE_LIMIT),
        ))
    )
      fail("recordText needs one tellable sentence per named record");
    if (
      item.questReadText !== undefined &&
      !(item.teachesQuest && validFactText(item.questReadText))
    )
      fail("questReadText needs a taught quest and one sentence");
    if (item.teachesQuest !== undefined) {
      const avatar = owns(pack.avatars, item.author) && pack.avatars[item.author];
      const wants = Array.isArray(avatar?.wants)
        ? avatar.wants.map((entry) => entry?.want)
        : [avatar?.want];
      if (
        !card(item.teachesQuest) ||
        wants.filter((want) => want?.target === item.teachesQuest).length !== 1
      )
        fail("teachesQuest must name one authored request of its author");
    }
    if (item.lifecycle !== undefined && !LIFECYCLES.includes(item.lifecycle))
      fail(`lifecycle must be ${LIFECYCLES.join(" or ")}`);
    if (item.lifecycle === "fixed" && !owns(pack.places, item.holder))
      fail("a fixed book must start in a place of this pack");
    const pages = item.pages ?? [];
    if (
      !Array.isArray(pages) ||
      pages.length > BOOK_CLAIMS ||
      !pages.every((path) => mediaPathOk(pack.id, path))
    )
      fail(`pages must list up to ${BOOK_CLAIMS} pictures of this pack`);
    const seen = new Set();
    for (const [n, claim] of claims.entries()) {
      const ok =
        record(claim) &&
        Object.keys(claim).every((key) => ["id", "text", "about"].includes(key)) &&
        idOk(claim.id) &&
        !seen.has(claim.id) &&
        !records.includes(claim.id) &&
        safeId(`claim:${pack.id}:${id}:${claim.id}`) &&
        validFactText(claim.text) &&
        (claim.about === undefined || card(claim.about) !== undefined);
      seen.add(claim?.id);
      if (!ok)
        fail(
          `claims[${n}] needs a new id and one sentence, and may be about one of this pack's entities`,
        );
      else if (
        typeof author === "string" &&
        heardClaim(author, claim.text).length > FACT_LINE_LIMIT
      )
        fail(`claims[${n}] is too long to tell whole with its author's name`);
    }
  }
  return problems;
}
