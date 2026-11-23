import {
  FACT_LINE_LIMIT,
  heardClaim,
  safeId,
  validFactText,
} from "./knowledge.mjs";

export const BOOK_KEYS = ["author", "claims", "lifecycle"];
export const BOOK_CLAIMS = 3;
export const LIFECYCLES = ["kept", "spent"];
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const owns = (o, key) =>
  record(o) && typeof key === "string" && Object.hasOwn(o, key);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);

export function bookProblems(pack) {
  const problems = [];
  const cards = [pack.places, pack.avatars, pack.items];
  const card = (id) => cards.find((all) => owns(all, id))?.[id];
  for (const [id, item] of Object.entries(record(pack.items) ? pack.items : {})) {
    if (!record(item) || BOOK_KEYS.every((key) => item[key] === undefined))
      continue;
    const fail = (message) => problems.push(`${pack.id}: item ${id} ${message}`);
    const claims = Array.isArray(item.claims) ? item.claims : [];
    if (!claims.length || claims.length > BOOK_CLAIMS || item.lore !== undefined)
      fail(`needs one to ${BOOK_CLAIMS} claims and no lore pages`);
    const author = card(item.author)?.name;
    if (typeof author !== "string")
      fail("author must be a named place, avatar or item of this pack");
    if (item.lifecycle !== undefined && !LIFECYCLES.includes(item.lifecycle))
      fail(`lifecycle must be ${LIFECYCLES.join(" or ")}`);
    const seen = new Set();
    for (const [n, claim] of claims.entries()) {
      const ok =
        record(claim) &&
        Object.keys(claim).every((key) => ["id", "text", "about"].includes(key)) &&
        idOk(claim.id) &&
        !seen.has(claim.id) &&
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
