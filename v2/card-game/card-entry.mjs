// Cards entering the player's view. A card that newly joins the hand (an
// avatar arriving, a thing picked up or put down, a place found, the hand
// dealt on arrival) rises into its slot; one already there never moves again
// on a redraw. A quest card is dealt face down and turns once, the first
// time it is seen; it stays face up until it leaves the hand. Presentation
// only: it reads what the renderer drew from the committed world and never
// touches rules, saves, the journal or sync, and an entering card takes taps
// at once, so nothing waits on it.

import { questTerms } from "./want.mjs";

// The rise of a newly met card: 460 ms, a short overshoot, as before.
export const ENTRY_MS = 460;
// Cards that enter together follow each other closely, a few letters apart
// at the dialogue's 28 ms a letter, and the last waits at most this long.
export const ENTRY_STAGGER_MS = 70;
export const ENTRY_STAGGER_MAX_MS = 350;
// A quest lies face down this long after it enters, then turns.
export const QUEST_DOWN_MS = 520;
const EASE = "cubic-bezier(.2,.7,.25,1)";
const RISE = [
  { opacity: 0, translate: "0 28px", scale: 0.96 },
  { opacity: 1, translate: "0 -3px", scale: 1, offset: 0.75 },
  { opacity: 1, translate: "0 0", scale: 1 },
];

// One card rising into place now, as a newly met card does (the dealt
// level quest after a dream). Under reduced motion it just appears.
export function riseIn(element, { reduced = false, delay = 0 } = {}) {
  if (reduced || !element?.animate) return null;
  const rise = element.animate(RISE, {
    duration: ENTRY_MS,
    delay,
    easing: EASE,
    fill: "backwards",
  });
  rise.finished.then(() => rise.cancel()).catch(() => {});
  return rise;
}

// The keys drawn now that were not drawn before, in drawing order.
export const enteringKeys = (before, now) =>
  now.filter((key, i) => !before.has(key) && now.indexOf(key) === i);

// Each entering card's start, after the one before it.
export const entryDelays = (count) =>
  Array.from({ length: count }, (_, i) =>
    Math.min(i * ENTRY_STAGGER_MS, ENTRY_STAGGER_MAX_MS),
  );

// Tracks what one view has drawn. `draw` takes [{ key, element, still }] for
// the cards in view now and starts each new card's rise, except a still one
// (a card seen moving from where it was); a card redrawn mid-rise (a fresh
// element for the same key) carries on where it was.
// Under reduced motion cards just appear. A scene change holds the new
// cards back `after` ms (or `after(count)` for that many), so they enter
// once the old ones are gone (card-swap.mjs). Reusable by any card row.
export function createCardEntries() {
  let drawn = new Set();
  const starts = new Map(),
    playing = new WeakMap();
  return {
    draw(cards, { now = performance.now(), reduced = false, after = 0 } = {}) {
      const fresh = new Set(
        enteringKeys(
          drawn,
          cards.map((c) => c.key),
        ),
      );
      drawn = new Set(cards.map((c) => c.key));
      for (const key of starts.keys()) if (!drawn.has(key)) starts.delete(key);
      const rising = cards.filter(
        (c) => !reduced && !c.still && (fresh.has(c.key) || starts.has(c.key)),
      );
      const lead =
        typeof after === "function"
          ? after(rising.filter((c) => fresh.has(c.key)).length)
          : after;
      entryDelays(rising.length).forEach((delay, i) => {
        if (fresh.has(rising[i].key))
          starts.set(rising[i].key, now + lead + delay);
      });
      for (const { key, element } of rising) {
        const at = starts.get(key);
        if (now - at >= ENTRY_MS) starts.delete(key);
        if (now - at >= ENTRY_MS || playing.get(element) === at) continue;
        playing.set(element, at);
        const rise = element.animate(RISE, {
          duration: ENTRY_MS,
          delay: at - now,
          easing: EASE,
          fill: "backwards",
        });
        rise.finished.then(() => rise.cancel()).catch(() => {});
      }
      for (const c of cards) if (reduced || c.still) starts.delete(c.key);
      return new Set(rising.map((c) => c.key).filter((key) => starts.has(key)));
    },
  };
}

// The quest card's identity in the hand: whose quest it is, what kind and
// what for. Its steps still to go and the turn it was given are progress on
// the same card, never a new one.
export const questEntryKey = (quest) =>
  `${quest.actor}:${quest.kind}:${quest.target ?? ""}:${quest.level ?? "ordinary"}:${questTerms(quest)}`;

// The one quest in the hand. `show(key, seen)` takes the held quest's key
// (or null) and whether it is in view, and returns whether it is due to turn:
// dealt face down and now seen. `down(key)` says whether it is still face
// down, `turned(key)` marks it face up for as long as it stays in the hand,
// and `unseen(key)` puts back a turn that found it folded again. The hand a
// page or a new game opens on (`opening`) is already dealt: what shows then
// is face up at once, and a quest folded away turns when first seen. A quest
// that leaves the hand and comes back is dealt again.
export function createQuestEntries() {
  let held = null,
    lying = false,
    due = false;
  return {
    show(key, seen = false, { opening = false } = {}) {
      if (key !== held) {
        const fresh = key !== null;
        held = key;
        due = false;
        lying = fresh && (!opening || !seen);
      }
      if (held === null || !lying || !seen || due) return false;
      due = true;
      return true;
    },
    down: (key) => key === held && lying,
    turned(key) {
      if (key !== held) return false;
      due = false;
      const was = lying;
      lying = false;
      return was;
    },
    unseen(key) {
      if (key === held) due = false;
    },
  };
}
