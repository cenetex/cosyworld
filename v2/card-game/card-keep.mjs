// A card in the hand before and after a redraw keeps its node, so it stays
// put instead of being cut out and drawn again: as it was when it is drawn
// the same way, or brought to its new look in place when only its words or
// pictures changed. What lies around its button (a folded quest, a stack's
// edges) is redrawn when that changed. A quest card, whose taps carry the
// quest it was drawn for, is always drawn anew. Presentation only.
import { cardOf } from "./card-exit.mjs";

const keyOf = (frame) => `${cardOf(frame)}@${frame.dataset.holder ?? ""}`;
// A card's own button, the part of its frame that is kept.
const cardIn = (frame) => frame.querySelector(":scope > .card[data-card]");

// Whether two frames show the same card the same way. Whether a card takes
// taps and the row's fan are set on the drawn row, so they never count.
export function sameFace(a, b) {
  const [x, y] = [a, b].map((frame) => {
    const copy = frame.cloneNode(true);
    copy.removeAttribute("style");
    for (const part of [copy, ...copy.querySelectorAll("*")])
      for (const name of ["disabled", "draggable"]) part.removeAttribute(name);
    return copy;
  });
  return x.isEqualNode(y);
}

// Whether one node tree can be brought to look like another in place.
const sameShape = (a, b) =>
  a.nodeName === b.nodeName &&
  a.childNodes.length === b.childNodes.length &&
  [...a.childNodes].every((child, i) => sameShape(child, b.childNodes[i]));

function syncAttributes(node, like) {
  for (const { name } of [...node.attributes])
    if (!like.hasAttribute(name)) node.removeAttribute(name);
  for (const { name, value } of like.attributes)
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

// Brings `node` to look like `like`, which has its shape, keeping its nodes.
function morph(node, like) {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    if (node.data !== like.data) node.data = like.data;
    return node;
  }
  syncAttributes(node, like);
  node.childNodes.forEach((child, i) => morph(child, like.childNodes[i]));
  return node;
}

// Brings a kept frame to its new look, keeping its card button's node.
export function morphFrame(was, frame) {
  if (sameShape(was, frame)) return morph(was, frame);
  syncAttributes(was, frame);
  const card = cardIn(frame),
    kept = morph(cardIn(was), card);
  was.replaceChildren(
    ...[...frame.childNodes].map((part) => (part === card ? kept : part)),
  );
  return was;
}

// The new row with each card's old frame kept where it can be. `changed`
// pairs a kept frame with its new look, for morphFrame once anything that
// copies the old face has read it; `faces` are the old shown frames whose
// look changed. A frame marked gone has already left.
export function keepFrames(row, frames) {
  const old = new Map(
    row.filter((f) => !f.dataset.gone && cardIn(f)).map((f) => [keyOf(f), f]),
  );
  const changed = [],
    faces = [];
  const kept = frames.map((frame) => {
    const was = cardIn(frame) && old.get(keyOf(frame));
    if (!was) return frame;
    old.delete(keyOf(frame));
    if (sameFace(was, frame)) return was;
    if (!was.hidden && !frame.hidden) faces.push(was);
    if (!sameShape(cardIn(was), cardIn(frame))) return frame;
    changed.push([was, frame]);
    return was;
  });
  return { frames: kept, changed, faces };
}
