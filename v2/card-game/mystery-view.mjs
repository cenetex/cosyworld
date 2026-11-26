// A discoverable secret waits in the location's ordinary item stack. This
// is presentation custody only: a boxed resident is not an inventory item,
// and a boxed destination is not a traversable exit. Only already-authored
// locks count; absence, disabled packs and personal avatar discovery do not.
import { isLockedBox } from "./locked-box.mjs";
import { cardType } from "./cards.mjs";
import { currentActor, rootHolder, things } from "./world.mjs";

export function tableHolder(world, id) {
  if (isLockedBox(world, id)) return world.actors[currentActor(world)].place;
  return things[id] ? rootHolder(world, id) : null;
}

// All mysteries have the same silhouette until the committed rules reveal
// their contents. On opening, their original type and holder take over.
export function tableType(world, id) {
  return isLockedBox(world, id) ? "item" : cardType(id);
}

export function lockedStack(cards, id, open, holderExpanded) {
  const index = cards.indexOf(id);
  if (index < 0) return null;
  open = open && cards.length > 1;
  const top = index === 0;
  return {
    kind: "locks",
    open,
    top,
    under: top && !open ? cards.length - 1 : 0,
    shown: open || (top && (cards.length > 1 || holderExpanded)),
  };
}

export function syncStackFrame(frame, part) {
  frame.hidden = !part.shown;
  frame.querySelectorAll(":scope > .place-edge").forEach((edge) => edge.remove());
  const button = frame.querySelector(".card");
  if (part.kind !== "quest" && part.top && (part.open || part.under)) {
    frame.dataset.expanded = String(part.open);
    button.setAttribute("aria-expanded", String(part.open));
  } else {
    delete frame.dataset.expanded;
    button.removeAttribute("aria-expanded");
  }
  if (part.kind === "locks")
    button.setAttribute(
      "aria-label",
      part.under ? `${part.under + 1} locked boxes. Select to fan out.` : "Locked box",
    );
}
