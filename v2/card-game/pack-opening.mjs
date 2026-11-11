// The pack opening: the cards a traveler has not yet turned sit together as
// one face-down stack in the hand. Tap it and they rise into the raised
// row, still face down; turn them one by one, or Reveal all and watch them
// turn commons first, the rarest last. Done settles them back into the
// hand. Every turn gets a sound, and each tier above common adds a longer
// held breath before it turns.
//
// This module is the pure part: which cards form a pack and in what order,
// the state machine (none, closed, open, running, turned, done), the
// tier-to-timing-and-sound table, and the settle order. It holds card ids
// only, never elements, so a redraw of the hand can never leave it holding a
// stale node. The page (app.mjs) supplies what is turned, each card's kind
// and tier, and how to turn one. Presentation only: turning a card is
// cosmetic and never touches the rules, the journal or sync.

import { tapPrompt } from "./presentation.mjs";

// Three or more unturned cards make a pack; one or two simply turn in place.
export const PACK_MIN = 3;

// The one button's words. A small fixed vocabulary, no counts.
export const PACK_REVEAL_ALL = "Reveal all";
export const PACK_DONE = "Done";
export const PACK_FINISH = tapPrompt(null, false).hint;

// The pack's order: the place's own card first, then residents, items, ways,
// locked boxes, and offered quests (closed boxes too).
export const PACK_KINDS = ["place", "avatar", "item", "way", "box", "offer"];
const kindRank = (kind) => {
  const rank = PACK_KINDS.indexOf(kind);
  return rank < 0 ? PACK_KINDS.length : rank;
};

// Tier ranks follow level-tiers.mjs; unknown tiers read as common.
export const PACK_TIERS = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
export const tierRank = (tier) => Math.max(0, PACK_TIERS.indexOf(tier));
// A face-down card shows a rim glow from this tier up.
export const TELL_FROM = "rare";

// What a turn costs at each tier. `hold` is the breath before the lid moves
// (the glow builds and the tone rises through it); `spacing` is how long a
// Reveal all waits from this card's start to the next card's start; `tone`
// is the rising tone (none for common, which has only the flip tick).
// Everything climbs with the tier, and the extra time is all anticipation.
const TURN = {
  common: { hold: 0, spacing: 300, tone: null, tick: 1500 },
  uncommon: {
    hold: 140,
    spacing: 520,
    tone: { hz: 392, glide: 1.12, level: 0.3, partials: 1 },
    tick: 1650,
  },
  rare: {
    hold: 380,
    spacing: 900,
    tone: { hz: 494, glide: 1.25, level: 0.4, partials: 2 },
    tick: 1800,
  },
  epic: {
    hold: 640,
    spacing: 1250,
    tone: { hz: 587, glide: 1.4, level: 0.5, partials: 3 },
    tick: 1950,
  },
  legendary: {
    hold: 900,
    spacing: 1600,
    tone: { hz: 698, glide: 1.5, level: 0.6, partials: 3 },
    tick: 2100,
  },
  mythic: {
    hold: 1100,
    spacing: 1850,
    tone: { hz: 784, glide: 1.6, level: 0.7, partials: 4 },
    tick: 2250,
  },
};
const TELL_GLOW = { rare: 20, epic: 28, legendary: 36, mythic: 44 };

// The timing and sound of one turn. Under reduced motion there is no hold
// and the beat is short: a card crossfades, so its tier is carried by colour
// and sound alone. The tone is as long as the hold plus a short tail.
export function turnPlan(tier, { reduced = false } = {}) {
  const base = TURN[PACK_TIERS.includes(tier) ? tier : "common"];
  const hold = reduced ? 0 : base.hold;
  return {
    tier: PACK_TIERS.includes(tier) ? tier : "common",
    hold,
    spacing: reduced ? 320 : base.spacing,
    tick: base.tick,
    tone: base.tone ? { ...base.tone, ms: hold + 200 } : null,
  };
}

// The rim of a face-down card's tell: null below Rare.
export function tellGlow(tier) {
  return TELL_GLOW[tier] ?? null;
}

// The cards that form a pack: the unturned among `cards` in the pack's
// order (ties keep the hand's order), or none below the threshold.
// `kindOf(id)` names a card's kind (PACK_KINDS).
export function packMembers(cards, { unturned, kindOf, minimum = PACK_MIN }) {
  const found = [...new Set(cards)].filter(unturned);
  if (found.length < minimum) return [];
  return found
    .map((id, index) => ({ id, index, rank: kindRank(kindOf(id)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ id }) => id);
}

// A Reveal all turns commons first and the rarest last; ties keep the
// pack's order.
export function runOrder(ids, tierOf) {
  return ids
    .map((id, index) => ({ id, index, rank: tierRank(tierOf(id)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ id }) => id);
}

// The cards settle back into the hand a beat apart, the rarest last. Under
// reduced motion they all go at once.
export const SETTLE_STEP_MS = 60;
export const SETTLE_MAX_MS = 420;
export function settleDelays(ids, tierOf, { reduced = false } = {}) {
  const delays = new Map();
  runOrder(ids, tierOf).forEach((id, i) =>
    delays.set(id, reduced ? 0 : Math.min(i * SETTLE_STEP_MS, SETTLE_MAX_MS)),
  );
  return delays;
}

// A batched announcement for a Reveal all: how many turned and the rarest.
export function revealAnnouncement(count, topTier, label = (tier) => tier) {
  return `${count} cards turned. Rarest: ${label(topTier)}.`;
}

// The pack's state machine. `timers` is { set, clear }; tests pass a fake.
//   none      no pack (fewer than three unturned cards, or not allowed)
//   closed    one stack of face-down cards in the hand
//   open      the raised row shows them, still face down; taps turn them
//   running   Reveal all is turning them one after another
//   turned    every card is turned; the button reads Done
//   done      settled back; the next sync forms the next pack, if any
export function createPackOpening({
  timers = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h) },
  reduced = () => false,
} = {}) {
  let state = "none",
    ids = [],
    handle = null,
    run = null,
    settle = new Map();

  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    run = null;
  };
  const left = (unturned) => ids.filter(unturned);

  const pack = {
    get state() {
      return state;
    },
    get ids() {
      return [...ids];
    },
    // Redraw key: changes whenever what the hand shows of the pack changes.
    key: () => `${state}:${ids.join(",")}`,
    has: (id) => ids.includes(id),
    // Re-reads the table. `cards` are the cards in the hand now, `unturned`
    // says whether a card is still face down, `allowed` is false while
    // something else owns the table (the opening, a fight, a save lock).
    // Returns whether the pack's shape changed.
    sync(cards, { unturned, kindOf, allowed = true }) {
      const before = pack.key();
      if (!allowed) {
        stop();
        state = "none";
        ids = [];
        return before !== pack.key();
      }
      if (state === "done") state = "none";
      if (state === "none" || state === "closed") {
        // A closed pack takes late arrivals and loses cards turned from
        // outside (a speaker's own line); fewer than three dissolves it.
        ids = packMembers(cards, { unturned, kindOf });
        state = ids.length ? "closed" : "none";
      } else {
        // An open pack is fixed: a late arrival forms the next pack. Cards
        // that left the hand drop out; with none left the pack is over.
        const here = new Set(cards);
        ids = ids.filter((id) => here.has(id));
        if (!ids.length) {
          stop();
          state = "none";
        } else if (state === "open" && !left(unturned).length) {
          // Turned by taps (or from outside). A running pack ends itself,
          // on its own beat, so its last card finishes turning first.
          state = "turned";
        }
      }
      return before !== pack.key();
    },
    // Tap the stack: it opens into the row.
    open() {
      if (state !== "closed") return false;
      state = "open";
      return true;
    },
    // Tap a card in an open pack: it turns at once. A turn from outside the
    // run is welcome: an already turned card is simply skipped.
    turnOne(id, { unturned, turn }) {
      if (state !== "open" || !ids.includes(id) || !unturned(id)) return false;
      turn(id);
      return true;
    },
    // Reveal all: one card after another, commons first, each on its own
    // beat. `tierOf` names a card's tier, `turn(id)` turns it, `done()` is
    // called once every card is turned.
    revealAll({ unturned, tierOf, turn, done = () => {} }) {
      if (state !== "open" || !left(unturned).length) return false;
      state = "running";
      const order = runOrder(ids, tierOf);
      run = { order, next: 0, unturned, tierOf, turn, done };
      const step = () => {
        handle = null;
        if (state !== "running" || !run) return;
        const { order, unturned, tierOf, turn } = run;
        while (run.next < order.length && !unturned(order[run.next]))
          run.next += 1;
        if (run.next >= order.length) return end();
        const id = order[run.next++];
        const plan = turnPlan(tierOf(id), { reduced: reduced() });
        turn(id);
        // The last card waits for its own turn to finish, then Done.
        const last = !order.slice(run.next).some(unturned);
        handle = timers.set(
          last ? end : step,
          last ? plan.hold + (reduced() ? 320 : 900) : plan.spacing,
        );
      };
      const end = () => {
        handle = null;
        if (state !== "running") return;
        const finishing = run?.done;
        run = null;
        state = "turned";
        finishing?.();
      };
      step();
      return true;
    },
    // A tap while the run plays: every card still face down turns now, none
    // half turned, and the run ends. `turnNow(id)` turns one without a
    // flourish (and the page finishes any turn in flight).
    skip({ unturned, turnNow }) {
      if (state !== "running") return false;
      const finishing = run?.done;
      stop();
      for (const id of ids) if (unturned(id)) turnNow(id);
      state = "turned";
      finishing?.();
      return true;
    },
    // Done: the cards go back to their places in the hand, the rarest last.
    finish({ tierOf = () => "common" } = {}) {
      if (state !== "turned") return false;
      settle = settleDelays(ids, tierOf, { reduced: reduced() });
      ids = [];
      state = "done";
      return true;
    },
    // Tapping away or Escape: a run is finished at once, then the cards go
    // back. Cards still face down stay face down and form a pack again.
    dismiss({ unturned, turnNow, tierOf = () => "common" }) {
      if (state === "running") pack.skip({ unturned, turnNow });
      if (state === "turned") return pack.finish({ tierOf });
      if (state === "open") {
        settle = settleDelays(ids, tierOf, { reduced: reduced() });
        ids = [];
        state = "done";
        return true;
      }
      return false;
    },
    // The settle delays of the cards that just went back, once.
    takeSettle() {
      const taken = settle;
      settle = new Map();
      return taken;
    },
    // How a card's frame shows: shown or tucked, and the stack's top with
    // the count hidden under it. Null for a card outside the pack.
    frameFor(id) {
      if (!ids.includes(id)) return null;
      if (state === "closed") {
        const top = id === ids[0];
        return { shown: top, top, under: top ? ids.length - 1 : 0 };
      }
      return { shown: true, top: false, under: 0 };
    },
    // The one button the pack asks for while nothing is chosen, or null.
    prompt(unturned) {
      if (state === "running") return { kind: "finish", label: PACK_FINISH };
      if (state === "turned") return { kind: "done", label: PACK_DONE };
      if (state === "open" && left(unturned).length)
        return { kind: "reveal", label: PACK_REVEAL_ALL };
      return null;
    },
    // The tier a face-down card shows as a rim glow in an open pack, or
    // null: only Rare and above, only while it is face down in the row.
    tellFor(id, tier, isUnturned) {
      if (state !== "open" && state !== "running") return null;
      if (!ids.includes(id) || !isUnturned) return null;
      return tierRank(tier) >= tierRank(TELL_FROM) ? tier : null;
    },
    // Whether a run is playing.
    get running() {
      return state === "running";
    },
  };
  return pack;
}
