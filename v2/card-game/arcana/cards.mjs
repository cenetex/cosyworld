const event = (match, more = {}) => ({ kind: "event", match, ...more });
const any = (...conditions) => ({ kind: "any", conditions });
const all = (...conditions) => ({ kind: "all", conditions });
const wants = (actor, target) => ({ kind: "wants", actor, target, want: "item" });
const holding = (actor, item) => ({ kind: "holding", actor, item });
const give = (item, to) => ({ kind: "item", target: item, step: { verb: "give", to } });
const freely = { without: ["handover"] };
const handed = (match, more = freely) =>
  event({ itemId: "$item", accepted: true, ...match }, more);

const chose = (chosen, other) =>
  all(
    event(
      { verb: "want_met", actorId: chosen, itemId: "$item" },
      { after: handed({ verb: "give", actorId: "$traveler", targetId: chosen }) },
    ),
    holding(chosen, "$item"),
    wants(other, "$item"),
  );
export const LOVER = {
  id: "lover",
  numeral: "VI",
  roles: [
    { name: "first", kind: "resident", where: [wants("$first")] },
    { name: "item", kind: "item", where: [wants("$first", "$item")] },
    { name: "second", kind: "resident", where: [wants("$second", "$item")] },
  ],
  proof: [
    {
      name: "one promise kept while the other still stands",
      when: any(chose("$first", "$second"), chose("$second", "$first")),
    },
  ],
  desire: [give("$item", "$first"), give("$item", "$second")],
};

const asked = handed({ verb: "ask", actorId: "$traveler", targetId: "$keeper" });
const brokered = { ...freely, after: asked };
export const JUSTICE = {
  id: "justice",
  numeral: "VIII",
  roles: [
    { name: "item", kind: "item" },
    { name: "keeper", kind: "resident", where: [holding("$keeper", "$item")] },
    { name: "claimant", kind: "resident", where: [wants("$claimant", "$item")] },
  ],
  proof: [
    {
      name: "the handover was agreed",
      when: any(
        handed({ verb: "ask", actorId: "$claimant", targetId: "$keeper" }),
        handed({ verb: "give", actorId: "$keeper", targetId: "$claimant" }),
        handed({ verb: "give", actorId: "$traveler", targetId: "$claimant" }, brokered),
      ),
    },
    { name: "custody matches the agreement", when: holding("$claimant", "$item") },
  ],
  desire: [give("$item", "$claimant")],
};

const left = { verb: "drop", actorId: "$traveler", itemId: "$source", locationId: "$basin" };
const used = { verb: "take", actorId: "$user", itemId: "$source", locationId: "$basin" };
const rests = { kind: "item_present", item: "$source", place: "$basin" };
export const STAR = {
  id: "star",
  numeral: "XVII",
  roles: [
    { name: "user", kind: "resident", where: [wants("$user")] },
    { name: "source", kind: "item", where: [wants("$user", "$source")] },
    { name: "basin", kind: "place", where: [{ kind: "not", condition: rests }] },
  ],
  proof: [
    {
      name: "someone used it after you left",
      when: event(used, { absent: ["$traveler"], after: event(left) }),
    },
  ],
  desire: [{ kind: "item", target: "$source", step: { verb: "bring", at: "$basin" } }],
};

export const ARCANA = [LOVER, JUSTICE, STAR];
