// Plays a wake on the table (sleep-presentation.mjs). The stage's black is
// a veil under the cast, so only the dreamer stays lit; the hand dims; the
// DREAM card is a beat the dialogue stack draws (dream-card.mjs). Every
// change is a CSS state on the body and stage, so this adds no layout reads.
// Presentation only: it reads the committed world and never touches the
// rules, saves, the journal or sync.
import { riseIn } from "./card-entry.mjs";
import { dreamBeat } from "./dream-card.mjs";
import { glimpseCompanion } from "./glimpse-card.mjs";
import {
  CROSSFADE_MS,
  DARK_BEATS,
  ENTER_MS,
  beatMs,
  createSleepSequence,
  dreamText,
  sleepPlan,
  sleepWake,
} from "./sleep-presentation.mjs";

export function createSleepView({
  stage,
  speechRow,
  root = document.body,
  reducedMotion = { matches: false },
  // Draws the table again (app.mjs render).
  render = () => {},
  // Finishes writing the line in front.
  finishReveal = () => {},
  showWake = () => {},
}) {
  let seen = null,
    shownTurn = null,
    wake = null,
    // The last dreamed wake: its dreamer's spoken line stays unshown.
    dreamt = null,
    sequence = null,
    shown = null,
    // The scene's words: asked, then whether a reflection was asked after.
    words = { asked: false, reflecting: false };
  const veil = document.createElement("div");
  veil.className = "sleep-veil";
  veil.setAttribute("aria-hidden", "true");
  const catcher = document.createElement("div");
  catcher.className = "sleep-catcher";
  catcher.hidden = true;
  catcher.setAttribute("aria-hidden", "true");
  catcher.addEventListener("click", (event) => {
    event.stopPropagation();
    tap();
  });
  const cast = stage.querySelector("#cast");
  stage.insertBefore(veil, cast);
  root.append(catcher);
  const onKey = (event) => {
    if (!sequence) return;
    if (event.key === "Escape") return sequence.disarm();
    if (event.key !== " " && event.key !== "Enter") return;
    if (event.target.closest?.("dialog, input, textarea, select")) return;
    event.preventDefault();
    tap();
  };
  document.addEventListener("keydown", onKey, true);

  function tap() {
    sequence?.tap();
  }
  function paint(state) {
    shown = state;
    const beat = state.beat;
    const active = beat !== "done";
    for (const el of [root, stage]) {
      if (active) el.dataset.sleep = beat;
      else delete el.dataset.sleep;
    }
    root.dataset.sleepDream = String(Boolean(active && wake?.dream));
    const reduced = reducedMotion.matches;
    stage.style.setProperty(
      "--sleep-ms",
      `${active ? beatMsOf(beat, reduced) : 0}ms`,
    );
    root.style.setProperty(
      "--sleep-ms",
      stage.style.getPropertyValue("--sleep-ms"),
    );
    catcher.hidden = !active;
    markDreamer(active ? wake?.id : null);
    if (beat === "enter") riseIn(speechRow, { reduced });
    if (!active) {
      sequence = null;
      wake = null;
    }
    // Drawn after the change, never inside the draw that began the wake.
    queueMicrotask(render);
  }
  // The length of the CSS fade for this beat.
  const beatMsOf = (beat, reduced) =>
    beatMs(beat, reduced) ?? (reduced ? CROSSFADE_MS : ENTER_MS);
  function markDreamer(id) {
    for (const figure of cast?.children || [])
      figure.toggleAttribute(
        "data-dreamer",
        Boolean(id) && figure.dataset.avatar === id,
      );
  }
  function begin(next) {
    sequence?.stop();
    wake = next;
    words = { asked: false, reflecting: false };
    if (next.dream) dreamt = next;
    sequence = createSleepSequence({
      plan: sleepPlan(next),
      reduced: reducedMotion.matches,
      changed: paint,
      finishReveal,
    });
    const text = next.dream
      ? dreamText(currentWorld, next.id, next.turn)
      : null;
    if (text) sequence.dreamed(text);
    sequence.start();
  }
  let currentWorld = null;
  return {
    // Called as each world is drawn. The table a page opens on is already
    // awake: only a wake seen arriving plays.
    observe(world, viewer) {
      currentWorld = world;
      const from = shownTurn;
      shownTurn = world.turn;
      const next = sleepWake(world, viewer, from);
      const key = next?.key ?? null;
      if (seen === null) {
        seen = { key };
        return;
      }
      if (key && key !== seen.key) {
        seen = { key };
        showWake(next);
        begin({ ...next, fromTurn: from });
        return;
      }
      if (wake?.dream && sequence) {
        const text = dreamText(world, wake.id, wake.turn);
        if (text) sequence.dreamed(text);
      }
    },
    get active() {
      return Boolean(sequence);
    },
    // The catcher and the dialogue button take the same next tap.
    get dreamTap() {
      if (!wake?.dream) return null;
      if (shown.beat === "dreaming")
        return shown.armed ? "Confirm" : "Stop waiting";
      if (shown.beat === "dream") return shown.revealed ? "Continue" : "Finish";
      return shown.beat === "enter" ? "Continue" : "";
    },
    tap,
    // The turn the stage light shows, and whether it cuts: under the fade
    // the old light holds; under the black it cuts to the new one.
    light(turn) {
      if (!sequence || !wake || wake.fromTurn === null)
        return { turn, cut: false };
      if (sequence.beat === "fade")
        return { turn: wake.fromTurn, cut: true, hold: true };
      return {
        turn,
        cut: DARK_BEATS.has(sequence.beat) || sequence.beat === "light",
      };
    },
    // The dreamer's own spoken line on waking is not shown: the dream is.
    hidesLine(entry) {
      return Boolean(
        dreamt &&
          entry.generated &&
          entry.turn === dreamt.turn &&
          (entry.entityId || entry.actorId) === dreamt.id,
      );
    },
    // The DREAM card for the stack, and whether it stands in front.
    dream() {
      if (!dreamt) return null;
      const state =
        sequence && wake === dreamt ? sequence.state() : (dreamt.last ?? null);
      if (!state) return null;
      if (sequence && wake === dreamt) dreamt.last = state;
      const beat = state.beat;
      if (beat === "fade" || beat === "held") return null;
      return {
        beat: dreamBeat({
          key: `dream:${dreamt.seq}`,
          dreamerId: dreamt.id,
          turn: dreamt.turn,
          anchor: dreamt.seq + 0.5,
          text:
            beat === "enter" || beat === "dreaming"
              ? null
              : (state.text ?? "…"),
          armed: state.armed,
          // The halfway glimpse shows its aspect beside the card.
          companion: glimpseCompanion(dreamt.glimpse),
        }),
        front: Boolean(sequence) && DARK_BEATS.has(beat),
      };
    },
    // The dialogue finished writing a line.
    revealed(key) {
      if (sequence && key && String(key).includes(`"dream:${wake?.seq}"`))
        sequence.revealed();
    },
    // The narrator's scene words: asked, settled, or failed. Words that fail
    // bring no dream; words that come without a reflection asked after them
    // bring none either.
    words(status) {
      if (!sequence || !wake?.dream) return;
      const mine = sequence,
        sceneWords = words;
      if (status === "pending") words.asked = true;
      if (status === "failed") sequence.failed();
      if (status === "ready" && words.asked)
        setTimeout(() => {
          if (mine === sequence && !sceneWords.reflecting) mine.failed();
        });
    },
    // Wraps the reflection request: one that settles with no dream saved
    // leaves the dream "…".
    reflect(request) {
      return (context, signal) => {
        const mine = sequence;
        if (mine && wake?.dream) words.reflecting = true;
        const settled = () =>
          setTimeout(() => {
            if (mine !== sequence || !wake?.dream) return;
            const text = dreamText(currentWorld, wake.id, wake.turn);
            if (text) mine.dreamed(text);
            else mine.failed();
          });
        const result = request(context, signal);
        Promise.resolve(result).then(settled, settled);
        return result;
      };
    },
    // A replacement world is already awake, just like the first table.
    // Unlike stop(), discard the old dream, line filter and wake identity.
    reset(world, viewer) {
      sequence?.stop();
      if (sequence) paint({ beat: "done" });
      wake = dreamt = shown = null;
      words = { asked: false, reflecting: false };
      currentWorld = world;
      shownTurn = world.turn;
      seen = { key: sleepWake(world, viewer)?.key ?? null };
    },
    stop() {
      sequence?.stop();
      if (sequence) paint({ beat: "done" });
    },
  };
}
