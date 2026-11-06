// Who a committed play's words may come from. speech.json names the voices
// of each occasion; the narrator asks them, and from rules 93 the shared
// speech op refuses any other speaker.
import {
  currentActor,
  standoffFor,
  fightersOf,
  REFUSED_VERBS,
} from "./world.mjs";
import { hasTemperament, signalEcho } from "./pack-rules.mjs";
import { visitSpeech } from "./visit-speech.mjs";
import { profiles } from "./memory.mjs";
import speech from "./speech.json" with { type: "json" };

// The player's play this turn. A topic's story choice commits at the Talk
// that reserves it and logs just after it (#1581); the Talk is still the
// play, so the fact it reserved leads the scene's disclosures.
export function playedEntry(world) {
  const own = world.log.filter(
    (entry) =>
      entry.turn === world.turn &&
      !entry.generated &&
      entry.kind === "action" &&
      entry.actorId === currentActor(world),
  );
  return own.findLast(
    (entry) =>
      !(
        entry.verb === "choose" &&
        own.some(
          (talk) =>
            talk.seq < entry.seq &&
            talk.verb === "talk" &&
            talk.targetId === entry.targetId,
        )
      ),
  );
}

// The occasions on which a play speaks, in the order they are checked.
// speech.json names who speaks on each; every other play is silent and its
// action caption carries the beat.
export const SPEECH_OCCASIONS = [
  "opening",
  "defeat",
  "talk",
  "refused",
  "threatened",
  "battle_wait",
  "companion",
  "first_meeting",
  "want_met",
  "long_rest",
  "first_wait",
  "signal_echo",
  "new_place",
  "action",
];

// The actor's first arrival at this place, read from committed travel.
function firstArrival(world, location) {
  const actor = currentActor(world);
  const arrived = (entry) =>
    !entry.generated &&
    entry.locationId === location &&
    entry.fromLocationId &&
    entry.fromLocationId !== location &&
    (entry.actorId === actor ||
      (entry.verb === "accompany" &&
        entry.accepted &&
        entry.targetId === actor));
  return (
    world.log.some((entry) => entry.turn === world.turn && arrived(entry)) &&
    !world.log.some((entry) => entry.turn < world.turn && arrived(entry)) &&
    (world.actors[actor].visited?.at(-1) ?? location) === location
  );
}

// Which occasions this committed play meets, and who speaks for them.
export function speechOccasions(world, cast) {
  const actor = currentActor(world);
  const played = playedEntry(world);
  const verb = played?.verb;
  const awake = (id) => !hasTemperament(id) || world.actors[id]?.awake;
  const near = (id) =>
    Boolean(id) && id !== actor && cast.audience.includes(id) && awake(id);
  const thisTurn = world.log.filter(
    (entry) => entry.turn === world.turn && !entry.generated,
  );
  const talked = verb === "talk" || verb === "ask";
  // The first resident who sought the player out with Talk is answered too.
  const hailed = talked
    ? null
    : thisTurn.find(
        (e) => e.verb === "talk" && e.targetId === actor && near(e.actorId),
      )?.actorId;
  const target = near(played?.targetId) ? played.targetId : hailed || null;
  const waited = cast.resting === actor;
  // A battle open now, or one this play closed: closing sets three turns
  // of peace for each fighter.
  const conflict = standoffFor(world, actor);
  const closedNow = (id) => world.peaceUntil?.[id] === world.turn + 3;
  const fighters = conflict
    ? fightersOf(conflict)
    : closedNow(actor)
      ? Object.keys(world.actors).filter(closedNow)
      : [];
  const roles = {
    actor: [actor],
    target: [target],
    host: cast.defeat ? [cast.speakers[0]] : [],
    opponent: fighters.filter(near),
    newcomer: cast.present.filter(
      (id) => near(id) && world.opening?.met[id] === world.turn,
    ),
    met: [actor, target].filter((id) =>
      thisTurn.some((e) => e.verb === "want_met" && e.actorId === id),
    ),
    place: [],
  };
  const echo =
    played &&
    signalEcho(world, cast.location, {
      kind: verb,
      item: played.itemId,
      target: played.targetId,
    });
  const meets = {
    opening: world.turn === 0,
    defeat: Boolean(cast.defeat),
    talk: talked || Boolean(hailed),
    refused: REFUSED_VERBS.includes(verb) && played.accepted === false,
    threatened: verb === "threaten" && Boolean(target),
    battle_wait: waited && fighters.length > 0,
    companion: verb === "accompany" && played.accepted === true,
    first_meeting: roles.newcomer.length > 0,
    want_met: roles.met.length > 0,
    long_rest: waited && cast.rest === "long",
    first_wait:
      verb === "wait" &&
      !played.sleep &&
      !played.guards &&
      visitSpeech(world, actor).turn === world.turn,
    signal_echo: Boolean(echo),
    new_place: firstArrival(world, cast.location),
    action:
      !echo &&
      played?.accepted !== false &&
      [
        "light",
        "snuff",
        "take",
        "drop",
        "eat",
        "use",
        "cover",
        "ring",
        "give",
        "trade",
        "choose",
        "course",
        "move",
      ].includes(verb),
  };
  // A defeat has exactly one voice.
  const occasions = meets.defeat
    ? ["defeat"]
    : SPEECH_OCCASIONS.filter((name) => meets[name]);
  const named = occasions.flatMap((name) => speech[name] || []);
  const voices = [
    ...new Set(named.flatMap((role) => roles[role] || [])),
  ].filter(
    (id) => id && cast.ids.includes(id) && profiles[id]?.kind === "avatar",
  );
  return {
    occasion: occasions[0] || null,
    // The player's avatar speaks first, so a waiting avatar can reflect.
    speakers: [
      ...voices.filter((id) => id === actor),
      ...voices.filter((id) => id !== actor),
    ].slice(0, 3),
    scenery: named.includes("place"),
  };
}
