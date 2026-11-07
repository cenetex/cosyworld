// Read committed results for one exchange. Wording and later positions never
// replace the recorded recipient, damage or resolve of a blow.
const verbs = [
  "threaten",
  "guard",
  "intercept",
  "attack",
  "retreat",
  "sent-home",
];
export function battleEvents(world, played) {
  if (!played || ["claim", "focus"].includes(played.verb)) return [];
  return world.log
    .filter(
      (e) =>
        e.seq >= played.seq &&
        e.turn === played.turn &&
        !e.generated &&
        verbs.includes(e.verb) &&
        e.actorId &&
        (["guard", "retreat", "sent-home"].includes(e.verb) || e.targetId),
    )
    .map((e) => ({
      seq: e.seq,
      turn: e.turn,
      kind: e.verb,
      actor: e.actorId,
      target: e.targetId || null,
      intendedTarget: e.coveredId || e.targetId || null,
      protected: e.coveredId || null,
      location: e.fromLocationId || e.locationId,
      destination: ["retreat", "sent-home"].includes(e.verb)
        ? e.locationId
        : null,
      witnesses: [
        ...new Set(
          [
            e.actorId,
            e.targetId,
            e.coveredId,
            ...(e.witnesses || []),
            ...(e.cast || []),
          ].filter(Boolean),
        ),
      ],
      damage: e.damage ?? null,
      braced: e.guarded ?? null,
      before: e.resolveBefore ?? null,
      after: e.resolveAfter ?? null,
      outcome: e.outcome || null,
    }));
}

// Each person receives only their own participation and witnessed events.
export function battleFacts(world, actor, events, nameOf) {
  const witnessed = events.filter((e) => e.witnesses.includes(actor)).slice(-6);
  const facts = [];
  for (const e of witnessed) {
    const who = e.actor === actor ? "I" : nameOf(e.actor);
    const target = e.target === actor ? "me" : e.target && nameOf(e.target);
    if (e.kind === "threaten") facts.push(`${who} threatened ${target}.`);
    if (e.kind === "guard") facts.push(`${who} braced for a blow.`);
    if (e.kind === "intercept")
      facts.push(`${who} stepped forward to protect ${target}.`);
    if (e.kind === "attack") {
      const hit = e.target === actor ? "I" : nameOf(e.target);
      const ward =
        e.protected === actor ? "me" : e.protected && nameOf(e.protected);
      let result = e.protected
        ? `${hit} took ${e.actor === actor ? "my" : `${nameOf(e.actor)}'s`} blow for ${ward}.`
        : `${who} struck ${target}.`;
      if (e.braced)
        result += ` ${hit === "I" ? "I was" : `${hit} was`} braced.`;
      if ([e.before, e.after, e.damage].every(Number.isInteger))
        result += ` The blow dealt ${e.damage} damage; resolve fell from ${e.before} to ${e.after}.`;
      if (["yield", "sent-home"].includes(e.outcome))
        result += ` ${hit} ${e.outcome === "sent-home" ? "was sent home" : "yielded"}.`;
      facts.push(result);
    }
    if (e.destination)
      facts.push(
        `${who} ${e.kind === "sent-home" ? "was sent home" : "retreated"} to ${nameOf(e.destination)}.`,
      );
  }
  const battle = world.standoffs.find((c) => Object.hasOwn(c.resolve, actor));
  if (battle) {
    facts.push(
      `I have ${battle.resolve[actor]} resolve now. My stance is ${battle.guarding[actor] ? "braced" : "open"}.`,
    );
    if (battle.covering?.[actor])
      facts.push(`I am covering ${nameOf(battle.covering[actor])}.`);
    const protector = Object.entries(battle.covering || {}).find(
      ([, ward]) => ward === actor,
    )?.[0];
    if (protector) facts.push(`${nameOf(protector)} is covering me.`);
  }
  return facts;
}
