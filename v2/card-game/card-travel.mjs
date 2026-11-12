export const TRAVEL_MS = 420;
export const TRAVEL_EASE = "cubic-bezier(.45,0,.2,1)";
export const TRAVEL_LAYER = 9;
export const TAP_GUARD_MS = 250;
export const DISSOLVE_MS = 440;
export const DISSOLVE_STAGGER_MS = 40;
export const DISSOLVE_EASE = "cubic-bezier(.4,0,.6,1)";
export const DISSOLVE = [
  { translate: "0 -6px", scale: "1.02", offset: 0.25 },
  { translate: "0 22px", scale: "0.86" },
];
export const CLOSE_AFTER_MS = 220;
export const CLOSE_MS = 300;
export const ENTER_AFTER_MS = 340;

export function heldFrom(entry, cards, chosen = [], actor = null) {
  const offer = cards.find((card) => card.entry === entry);
  if (offer)
    return { id: offer.id, offer: true, handed: chosen.includes(offer.id) };
  const id = chosen.findLast(
    (id) => id !== actor && cards.some((card) => card.id === id),
  );
  return id ? { id, offer: false, handed: false } : null;
}

export function travelFrames(from, to) {
  const dx = from.left - to.left,
    dy = from.top - to.top,
    lift = Math.min(18, Math.hypot(dx, dy) * 0.08);
  return [
    { translate: `${dx}px ${dy}px`, scale: "1", zIndex: TRAVEL_LAYER },
    {
      translate: `${dx / 2}px ${dy / 2 - lift}px`,
      scale: "1.04",
      zIndex: TRAVEL_LAYER,
    },
    { translate: "0 0", scale: "1", zIndex: TRAVEL_LAYER },
  ];
}

export function tuckFrames(from, to, base) {
  const at = (box) => `${box.left - base.left}px ${box.top - base.top}px`;
  return { start: at(from), end: { translate: at(to), scale: "0.9" } };
}

export const closeTiming = (leaving, swapping = false) =>
  leaving && !swapping
    ? { delay: CLOSE_AFTER_MS, duration: CLOSE_MS, enter: ENTER_AFTER_MS }
    : { delay: 0, duration: undefined, enter: 0 };
