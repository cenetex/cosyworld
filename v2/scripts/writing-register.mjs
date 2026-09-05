const proseFields = new Set([
  "description", "look", "search", "persona", "blurb", "text", "premise",
  "completion_memory", "memory", "stakes", "consequence", "discovery_text",
  "reason", "stakes_questions", "impending_outcome", "doctrine",
]);
const tells = [["as if", /\bas if\b/i], ["seems to", /\bseems to\b/i], ["meant for", /\bmeant for\b/i]];
const scenery = new Set(("path paths road roads trail trails lane hill hills ridge bend mile rise wall walls door doors gate window floor ceiling bridge stone stones dust mud crumb crumbs kettle teapot lantern hearth garden inn bramble brambles moss weather rain wind fog mist sky cloud clouds sun moon shadow shadows light air biscuit biscuits boots kitchen cottage cave well fence roof step steps charm tonic potion shelf shelves room ledger").split(" "));
const intention = new Set(("remember remembers remembered remembering forget forgets forgot forgetting want wants wanted wanting decide decides decided deciding approve approves approving disapprove disapproves pleased delight delights delighted delighting welcome welcomes welcomed welcoming greet greets greeted greeting learn learns learned learning recruit recruits recruited recruiting audition auditions auditioning plot plots plotting conspire conspires conspiring insist insists insisting refuse refuses refused refusing judge judges judging resent resents resenting mock mocks mocking stage stages staged staging intend intends intending prefer prefers preferring hope hopes hoping believe believes believing").split(" "));
const bridges = new Set("is are was were has have had keeps keep kept still now already just even seems seem".split(" "));

export function sceneryActsWithIntent(value) {
  // Keep sentence boundaries: “I found the cottage. Remember the key.” has
  // a person remembering. A named character may remember an object too.
  for (const sentence of value.split(/[.!?;:]/)) {
    const words = sentence.toLowerCase().match(/[a-z0-9']+/g) || [];
    for (let index = 0; index < words.length; index += 1) {
      if (!scenery.has(words[index])) continue;
      for (let cursor = index + 1; cursor < Math.min(words.length, index + 3); cursor += 1) {
        if (intention.has(words[cursor])) return true;
        if (!bridges.has(words[cursor])) break;
      }
    }
  }
  return false;
}

function visit(value, callback, trail = []) {
  if (typeof value === "string") return callback(value, trail);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) visit(child, callback, [...trail, key]);
}

export function writingRegisterErrors(collections) {
  const errors = [];
  for (const [collection, rows] of Object.entries(collections)) {
    rows.forEach((row, index) => visit(row, (value, trail) => {
      const field = trail.findLast((part) => !/^\d+$/.test(part));
      if (!proseFields.has(field)) return;
      const label = `${collection}.json row ${row.id ?? row.card_id ?? row.location_id ?? index} ${trail.join(".")}`;
      const lyric = collection === "sentences";
      for (const [tell, pattern] of tells) {
        if (lyric && tell === "meant for") continue;
        if (pattern.test(value)) errors.push(`${label} uses banned tell "${tell}"`);
      }
      if (lyric) return;
      if (sceneryActsWithIntent(value)) errors.push(`${label} assigns intent or memory to scenery`);
      // Persona fields direct a character. Authored item-use receipts also
      // retain their existing direct address. Other world prose stays third person.
      const directAddress = collection === "actors" || collection === "cards"
        || field === "persona" || (field === "text" && trail.at(-3) === "uses");
      if (!directAddress && /\b(?:you|your|yours|yourself)\b/i.test(value)) {
        errors.push(`${label} uses second person outside the sentences register`);
      }
    }));
  }
  return errors;
}
