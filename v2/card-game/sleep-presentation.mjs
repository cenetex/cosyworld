// Waking, as the stage shows it (sleep spec §2 and §3). A sleep that ends
// across dusk or dawn fades the stage to black, holds it, and opens on the
// new light. A long rest that brings a level quest first shows the dream:
// the dark keeps only the dreamer, a DREAM card enters, "Dreaming…" stands
// while its words come, they reveal, the quest is dealt face down, and then
// the light returns. An ordinary rest shows no dream card, and a sleep that
// crosses no light only dims and lifts.
//
// Presentation only: this reads the committed world and never touches the
// rules, saves, the journal or sync. The timing is the theatre vocabulary's
// three tiers (turn gap 200–350 ms, pause 700–1000 ms, silence 1500–2200 ms)
// with its fades, held black and entrance.
import { isNight } from "./daylight.mjs";
import { ENTRY_MS, QUEST_DOWN_MS, questEntryKey } from "./card-entry.mjs";
import { questCards } from "./quest-card.mjs";
import { questsOf } from "./want.mjs";

// The stage fades to black, a pause.
export const FADE_MS = 900;
// The held black (ma) before anything new.
export const HELD_MS = 700;
// The DREAM card's entrance, as a card rises into the hand.
export const ENTER_MS = ENTRY_MS;
// A read dream stays a silence before the quest comes.
export const READ_MS = 2200;
// The quest rises, lies face down and turns over (card-entry.mjs).
export const QUEST_MS = ENTRY_MS + QUEST_DOWN_MS + 700;
// The stage opens onto the new light, the longest fade.
export const OPEN_MS = 2500;
// A sleep that crosses no light dims and lifts, a pause each way.
export const DIM_MS = 900;
// Reduced motion crossfades each light change in a turn gap.
export const CROSSFADE_MS = 300;
// Words that never come show "…" after the scene's and the dream's bounds.
export const DREAM_WAIT_MS = 90_000;
// The second tap that cancels "Dreaming…" must follow the first this soon,
// as with the Thinking card.
export const CONFIRM_MS = 3000;

// The viewer's wake committed this turn, or null. A wake that moved them or
// began a fight is the travel veil's or the standoff's to show. `fromTurn`
// is the turn on screen before it, so a crossed light is the one seen.
export function sleepWake(world, viewer, fromTurn = null) {
  const entry = world?.log?.findLast(
    (e) => e.actorId === viewer && e.verb === "wait" && e.woke !== undefined,
  );
  if (!entry || entry.turn !== world.turn) return null;
  if (entry.woke === "moved" || entry.woke === "threat") return null;
  const long = entry.rest === "long";
  const crossed =
    fromTurn !== null && fromTurn !== undefined && fromTurn < entry.turn
      ? isNight({ turn: fromTurn }) !== isNight(world)
      : entry.woke === "dawn" || entry.woke === "dusk";
  // Only a level quest dealt by this long rest brings a dream (owner,
  // 2026-11-04); an ordinary rest's reflection is not shown as one.
  const cards = questCards(world, viewer);
  const quests = long
    ? questsOf(world, viewer)
        .map((want, i) => (want.quest && want.since === entry.turn ? i : -1))
        .filter((i) => i >= 0 && cards[i])
        .map((i) => questEntryKey(cards[i]))
    : [];
  return {
    key: `wake:${entry.seq}`,
    seq: entry.seq,
    id: viewer,
    turn: entry.turn,
    place: entry.locationId,
    woke: entry.woke,
    long,
    crossed,
    night: isNight(world),
    quests,
    dream: quests.length > 0,
  };
}

// The dream this long rest brought, once its words are saved, or null.
export const dreamText = (world, id, turn) =>
  world?.memories?.[id]?.innerLife?.dreams?.find((d) => d.turn === turn)
    ?.text ?? null;

// The beats a wake plays, in order.
export function sleepPlan(wake) {
  if (!wake) return [];
  if (!wake.dream && !wake.crossed) return ["dim", "lift", "done"];
  return [
    "fade",
    "held",
    ...(wake.dream ? ["enter", "dreaming", "dream", "quest"] : []),
    "light",
    "done",
  ];
}

// How long a beat holds before the next, or null when it waits on words
// ("dreaming") or on their reveal ("dream" until revealed).
export function beatMs(beat, reduced = false) {
  const motion = {
    fade: FADE_MS,
    held: HELD_MS,
    enter: ENTER_MS,
    quest: QUEST_MS,
    light: OPEN_MS,
    dim: DIM_MS,
    lift: DIM_MS,
  };
  if (!(beat in motion)) return null;
  if (!reduced || beat === "held" || beat === "quest") return motion[beat];
  return CROSSFADE_MS;
}

// Beats under the black: the stage shows only the dreamer.
export const DARK_BEATS = new Set([
  "fade",
  "held",
  "enter",
  "dreaming",
  "dream",
  "quest",
]);

// One wake's sequence. Timers come from `schedule`/`cancel`, so tests can
// drive it by hand. `changed(state)` runs at every beat and change;
// `finishReveal()` asks the dialogue to finish writing the dream.
//
// A tap finishes the current beat. It never skips the quest's arrival:
// a tap while the quest is dealt does nothing. On "Dreaming…" the first tap
// asks and the second cancels; the dream then reads "…", as failed words do.
export function createSleepSequence({
  plan,
  reduced = false,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  changed = () => {},
  finishReveal = () => {},
} = {}) {
  let index = -1,
    timer = null,
    armTimer = null,
    waitTimer = null,
    armed = false,
    revealed = false,
    dream = { status: "pending", text: null };
  const beat = () => plan[index] ?? "done";
  const state = () => ({
    beat: beat(),
    armed,
    revealed,
    dream: { ...dream },
    // What the DREAM card reads: its words, or "…" when none came.
    text:
      dream.status === "ready"
        ? dream.text
        : dream.status === "pending"
          ? null
          : "…",
  });
  const clear = () => {
    cancel(timer);
    cancel(armTimer);
    timer = armTimer = null;
  };
  function go(next) {
    clear();
    index = next;
    armed = false;
    revealed = false;
    const now = beat();
    // Words that came during the dark need no "Dreaming…".
    if (now === "dreaming" && dream.status !== "pending") return go(index + 1);
    if (now === "dreaming" && waitTimer === null)
      waitTimer = schedule(() => settle("failed"), DREAM_WAIT_MS);
    const ms = beatMs(now, reduced);
    if (ms !== null) timer = schedule(advance, ms);
    if (now === "done") {
      cancel(waitTimer);
      waitTimer = null;
    }
    changed(state());
  }
  function advance() {
    if (beat() !== "done") go(index + 1);
  }
  function settle(status, text = null) {
    if (dream.status !== "pending") return;
    cancel(waitTimer);
    waitTimer = null;
    dream = { status, text: status === "ready" ? text : null };
    if (beat() === "dreaming") advance();
    else changed(state());
  }
  return {
    start() {
      if (index < 0) go(0);
      return state();
    },
    get beat() {
      return beat();
    },
    state,
    tap() {
      switch (beat()) {
        case "quest":
        case "done":
          return "held";
        case "dreaming":
          if (!armed) {
            armed = true;
            armTimer = schedule(() => {
              armed = false;
              changed(state());
            }, CONFIRM_MS);
            changed(state());
            return "armed";
          }
          settle("cancelled");
          return "cancelled";
        case "dream":
          if (!revealed) {
            finishReveal();
            return "finished";
          }
          advance();
          return "next";
        default:
          advance();
          return "next";
      }
    },
    // Escape or a pause puts an asked cancel back.
    disarm() {
      if (!armed) return;
      cancel(armTimer);
      armed = false;
      changed(state());
    },
    dreamed: (text) =>
      text ? settle("ready", String(text)) : settle("failed"),
    failed: () => settle("failed"),
    // The dialogue finished writing the dream: a silence, then the quest.
    revealed() {
      if (beat() !== "dream" || revealed) return;
      revealed = true;
      cancel(timer);
      timer = schedule(advance, READ_MS);
      changed(state());
    },
    stop() {
      clear();
      cancel(waitTimer);
      waitTimer = null;
      index = plan.length;
    },
  };
}
