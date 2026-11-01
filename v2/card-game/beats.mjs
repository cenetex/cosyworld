// Dialogue beats: what is happening now at the player's place.
//
// A beat is one character's spoken line for a turn (or "…" when their voice
// did not come) together with that character's own committed actions that
// turn, shown as short captions. An action with no speech is a beat of its
// own. Beats are read from committed events and published speech only, so
// local and shared play group the same events the same way, and nothing here
// is ever saved. See v2/docs/card-table/dialogue-beats.md.
import { currentActor, nameOf as fullName } from "./world.mjs";
import { isSceneText } from "./scene.mjs";
import { inSentence, theName } from "./combat-beats.mjs";

const QUIET_VERBS = new Set(["talk", "wait"]);
const DAMAGE = /loses (\d+) resolve/u;
const YIELDED = /after yielding to/u;
const STANDOFF_ENDS = /standoff ends/u;

// A name inside a sentence: "the keeper", not "The keeper", and one article:
// "took the Burial Decree". The sentence itself is capitalised by sentence().
const nameOf = inSentence;
const the = (id) => (id ? theName(id) : "something");

// How a blow landed, in words: the number stays in the resolve pips. The
// word is picked from the event's seq, so replay always shows the same one.
const HIT_WORDS = [
  ["stumbled", "staggered back"],
  ["fell", "took a hard knock"],
  ["took a big hit", "went down hard"],
];

// "Pip struck Vale. Vale stumbled."
function attackResult(entry) {
  const damage = Number.isFinite(entry.damage)
    ? entry.damage
    : Number(DAMAGE.exec(entry.text || "")?.[1] || 0);
  const outcome =
    entry.outcome ||
    (entry.resolveAfter === 0
      ? "yield"
      : /guard softens/u.test(entry.text || "")
        ? "guarded"
        : "hit");
  const t = nameOf(entry.targetId);
  if (outcome === "sent-home" || outcome === "yield") return `${t} gave way.`;
  if (outcome === "guarded")
    return `${t} braced and took only a glancing blow.`;
  if (damage <= 0) return `${t} held firm.`;
  const words = HIT_WORDS[Math.min(damage, HIT_WORDS.length) - 1];
  return `${t} ${words[Math.abs(Number(entry.seq) || 0) % words.length]}.`;
}

// Every caption reads as one sentence: capital first, closing punctuation.
function sentence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?…”"]$/u.test(capital) ? capital : `${capital}.`;
}

// The caption for one committed event, from the place `here` and the
// `viewer`'s point of view, or null when it is not shown as an action.
export function actionCaption(entry, { viewer, here, arrival = null }) {
  if (!entry || entry.generated || !entry.actorId) return null;
  const verb =
    entry.verb ||
    (entry.fromLocationId &&
    entry.fromLocationId !== entry.locationId &&
    YIELDED.test(entry.text || "")
      ? "retreat"
      : null);
  const a = nameOf(entry.actorId),
    t = nameOf(entry.targetId);
  const leaving =
    entry.fromLocationId === here &&
    entry.locationId &&
    entry.locationId !== here;
  const arriving =
    entry.locationId === here &&
    entry.fromLocationId &&
    entry.fromLocationId !== here;
  const caption = (icon, text, kind = verb) => ({
    seq: entry.seq,
    icon,
    text: sentence(text),
    kind,
    actorId: entry.actorId,
  });
  if (!verb) {
    if (entry.kind === "narration" && STANDOFF_ENDS.test(entry.text || ""))
      return caption("⚔", entry.text, "standoff");
    return null;
  }
  if (QUIET_VERBS.has(verb)) return null;
  switch (verb) {
    case "move":
    case "course":
      if (leaving)
        return caption("➜", `${a} left for ${nameOf(entry.locationId)}.`);
      if (arriving) {
        if (entry.actorId === viewer) return null;
        // Someone who came the same way on the viewer's arrival followed.
        const followed =
          arrival?.turn === entry.turn &&
          arrival.fromLocationId === entry.fromLocationId;
        return caption(
          "➜",
          `${a} ${followed ? "followed" : "arrived"} from ${nameOf(entry.fromLocationId)}.`,
        );
      }
      return entry.kind === "narration" ? caption("➜", entry.text) : null;
    case "accompany":
      if (entry.accepted === false)
        return caption("⇄", `${t} wouldn't go with ${a}.`);
      if (leaving)
        return caption(
          "➜",
          `${a} left with ${t} for ${nameOf(entry.locationId)}.`,
        );
      if (arriving)
        return caption(
          "➜",
          entry.actorId === viewer
            ? `${t} travelled with ${a}.`
            : `${a} arrived with ${t}.`,
        );
      return null;
    case "retreat":
    case "sent-home":
      if (leaving)
        return caption(
          "↳",
          verb === "sent-home"
            ? `${a} was beaten and sent home.`
            : `${a} was beaten and fell back to ${nameOf(entry.locationId)}.`,
        );
      if (arriving)
        return caption(
          "↳",
          entry.actorId === viewer
            ? `You came to at ${nameOf(here)}.`
            : `${a} staggered in from ${nameOf(entry.fromLocationId)}.`,
        );
      return null;
    case "threaten":
      return caption(
        "⚔",
        entry.itemId
          ? `${a} squared up to ${t} over ${the(entry.itemId)}.`
          : `${a} squared up to ${t}.`,
      );
    case "guard":
      return caption("⚔", `${a} braced against ${t}.`);
    case "attack":
      return caption("⚔", `${a} struck ${t}. ${attackResult(entry)}`);
    case "give":
      return entry.accepted === false
        ? caption(
            "⇄",
            `${a} offered ${the(entry.itemId)} to ${t}, but ${t} refused.`,
          )
        : caption("⇄", `${a} gave ${the(entry.itemId)} to ${t}.`);
    case "trade":
      return entry.accepted === false
        ? caption(
            "⇄",
            entry.itemId && entry.receiveId
              ? `${a} offered ${the(entry.itemId)} for ${the(entry.receiveId)}, but ${t} refused.`
              : `${a} offered ${t} a trade, but ${t} refused.`,
          )
        : caption(
            "⇄",
            `${a} traded ${the(entry.itemId)} for ${the(entry.receiveId)}.`,
          );
    case "ask":
      return entry.accepted === false
        ? caption(
            "⇄",
            `${a} asked ${t} for ${the(entry.itemId)}, but was refused.`,
          )
        : caption("⇄", `${a} got ${the(entry.itemId)} from ${t}.`);
    case "take":
      return caption("✋", `${a} took ${the(entry.itemId)}.`);
    case "drop":
      return caption("✋", `${a} put down ${the(entry.itemId)}.`);
    case "light":
      return caption("✦", `${a} lit ${the(entry.itemId)}.`);
    case "snuff":
      return caption("◌", `${a} snuffed ${the(entry.itemId)}.`);
    case "ring":
      return caption("♪", `${a} rang ${the(entry.itemId)}.`);
    case "refuel":
      return caption(
        "⛽",
        `${a} filled ${the(entry.targetId && entry.targetId !== entry.actorId ? entry.targetId : entry.itemId)}.`,
      );
    case "cover":
      return entry.targetId && entry.itemId
        ? caption("✋", `${a} covered ${the(entry.targetId)}.`)
        : caption("✋", entry.text);
    case "want_met":
    case "choose":
    case "use":
      return entry.text ? caption("✦", entry.text) : null;
    default:
      return entry.text ? caption("✦", entry.text) : null;
  }
}

// What the viewer could witness of an event at `here`.
function witnessedHere(entry, { viewer, here }) {
  const at = entry.locationId === here || entry.fromLocationId === here;
  if (!at) return false;
  if (
    entry.actorId === viewer ||
    entry.targetId === viewer ||
    !Array.isArray(entry.witnesses)
  )
    return true;
  // An arrival is seen at its destination; its witnesses stood at the start.
  if (entry.locationId === here && entry.fromLocationId !== here) return true;
  return entry.witnesses.includes(viewer);
}

const speakerOf = (line) => line.entityId || line.actorId || line.locationId;

function isSpeech(entry, { here, shared }) {
  return (
    entry.generated === true &&
    isSceneText(entry, shared) &&
    (!entry.locationId || entry.locationId === here)
  );
}

// Group a run of log entries at one place into beats, in time order.
export function groupBeats(
  entries,
  {
    viewer,
    here,
    shared = false,
    held = new Set(),
    hiddenSpeech = () => false,
    hiddenAction = () => false,
  } = {},
) {
  const beats = [];
  const firstBeat = new Map();
  const arrival = entries.find(
    (entry) => arrivalOf(entry, viewer) && entry.locationId === here,
  );
  for (const entry of entries) {
    if (!isSpeech(entry, { here, shared }) || hiddenSpeech(entry)) continue;
    const speakerId = speakerOf(entry);
    const beat = {
      key: `s:${entry.seq}`,
      turn: entry.turn,
      speakerId,
      line: entry,
      silent: Boolean(entry.silent),
      actions: [],
      anchor: entry.seq,
    };
    const owner = `${entry.turn}|${speakerId}`;
    if (!firstBeat.has(owner)) firstBeat.set(owner, beat);
    beats.push(beat);
  }
  for (const entry of entries) {
    if (
      held.has(entry.seq) ||
      hiddenAction(entry) ||
      !witnessedHere(entry, { viewer, here })
    )
      continue;
    const caption = actionCaption(entry, { viewer, here, arrival });
    if (!caption) continue;
    // A defeat lands after the blow that caused it, on the loser's own beat.
    const defeat = caption.kind === "retreat" || caption.kind === "sent-home";
    const owner = defeat ? `d:${entry.seq}` : `${entry.turn}|${entry.actorId}`;
    let beat = firstBeat.get(owner);
    if (!beat) {
      beat = {
        key: defeat ? `d:${entry.seq}` : `a:${entry.turn}:${entry.actorId}`,
        turn: entry.turn,
        speakerId: entry.actorId,
        line: null,
        silent: false,
        actions: [],
        anchor: entry.seq,
      };
      firstBeat.set(owner, beat);
      beats.push(beat);
    }
    beat.actions.push(caption);
  }
  for (const beat of beats) beat.actions.sort((a, b) => a.seq - b.seq);
  return beats.sort((a, b) => a.anchor - b.anchor);
}

const arrivalOf = (entry, viewer) =>
  !entry.generated &&
  entry.actorId === viewer &&
  entry.fromLocationId &&
  entry.locationId &&
  entry.fromLocationId !== entry.locationId;

// The index where the viewer's current visit to `here` began.
export function visitStartIndex(log, viewer, here) {
  return Math.max(
    0,
    log.findLastIndex(
      (entry) => arrivalOf(entry, viewer) && entry.locationId === here,
    ),
  );
}

// The beats of the viewer's current visit, oldest first.
export function sceneBeats(world, options = {}) {
  const viewer = options.viewer ?? currentActor(world);
  const here = world.actors[viewer].place;
  const start = visitStartIndex(world.log, viewer, here);
  return groupBeats(world.log.slice(start), { ...options, viewer, here });
}

// While a reply is being written, the waiting speaker's front card carries
// their committed actions from this turn; their action-only beat folds in.
export function withPending(beats, { speakerId, turn }) {
  if (!speakerId) return { beats, pending: null };
  const folded = beats.find(
    (beat) => !beat.line && beat.turn === turn && beat.speakerId === speakerId,
  );
  return {
    beats: folded ? beats.filter((beat) => beat !== folded) : beats,
    pending: {
      key: `p:${turn}:${speakerId}`,
      turn,
      speakerId,
      line: null,
      silent: false,
      pending: true,
      actions: folded?.actions || [],
    },
  };
}

// One line for a beat seen behind the front card: speech, then first action.
export function beatSummary(beat) {
  const speech = beat.line ? (beat.silent ? "…" : beat.line.text) : "";
  const first = beat.actions[0];
  return {
    speaker: beat.line?.speaker || fullName(beat.speakerId),
    speech,
    caption: first ? `${first.icon} ${first.text}` : "",
    text: [speech && `“${speech}”`, first && `${first.icon} ${first.text}`]
      .filter(Boolean)
      .join(" "),
  };
}

// Every remembered visit, newest first, each with its place and beats.
export function memoryVisits(world, options = {}) {
  const viewer = options.viewer ?? currentActor(world);
  const log = world.log;
  const starts = [];
  log.forEach((entry, index) => {
    if (arrivalOf(entry, viewer)) starts.push(index);
  });
  const firstPlace =
    (starts.length ? log[starts[0]].fromLocationId : null) ||
    world.actors[viewer].place;
  const visits = [];
  const bounds = [0, ...starts.filter((index) => index > 0)];
  bounds.forEach((start, i) => {
    const end = bounds[i + 1] ?? log.length;
    const here =
      start === 0 && !arrivalOf(log[0] || {}, viewer)
        ? firstPlace
        : log[start].locationId;
    // A visit closes with how the viewer left it.
    const beats = groupBeats(log.slice(start, end + 1), {
      ...options,
      viewer,
      here,
    });
    if (beats.length)
      visits.push({ key: `v:${log[start]?.seq ?? 0}`, placeId: here, beats });
  });
  return visits.reverse();
}
