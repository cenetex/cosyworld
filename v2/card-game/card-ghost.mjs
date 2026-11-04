// A leaving card is a ghost: an inert copy that plays the way out while the
// real card changes at once. It never takes pointer hits or reaches screen
// readers, and it is released the moment its motion ends.

// The looks the table's styles give a card and its parts. A copy loses the
// card's ids, and with them the rules that hang on those ids, so it keeps
// these as they were. Copying every computed property instead cost tens of
// milliseconds per copy.
const LOOK = `display position box-sizing width height min-width min-height
  max-width max-height top right bottom left padding-top padding-right
  padding-bottom padding-left margin-top margin-right margin-bottom
  margin-left grid-template-columns grid-template-rows grid-template-areas
  grid-column-start grid-column-end grid-row-start grid-row-end
  flex-direction flex-wrap flex-grow flex-shrink flex-basis order
  align-content align-items align-self justify-content justify-items
  justify-self row-gap column-gap overflow-x overflow-y scrollbar-width
  aspect-ratio vertical-align color background-color background-image
  background-size background-position background-repeat background-clip
  border-top-width border-right-width border-bottom-width border-left-width
  border-top-style border-right-style border-bottom-style border-left-style
  border-top-color border-right-color border-bottom-color border-left-color
  border-top-left-radius border-top-right-radius border-bottom-left-radius
  border-bottom-right-radius outline-style outline-width outline-color
  outline-offset box-shadow opacity visibility z-index transform
  transform-origin translate scale rotate perspective perspective-origin
  filter backdrop-filter clip-path mask-image mix-blend-mode isolation
  object-fit object-position font-family font-size font-weight font-style
  font-variant-numeric line-height letter-spacing text-align text-indent
  text-overflow text-shadow text-transform text-decoration-line white-space
  text-wrap-mode overflow-wrap word-break -webkit-line-clamp
  -webkit-box-orient list-style-type`.split(/\s+/);

// An inert copy of the card, not yet placed.
export function ghostOf(card) {
  const ghost = card.cloneNode(true);
  for (const part of [ghost, ...ghost.querySelectorAll("[id], [aria-live]")]) {
    part.removeAttribute("id");
    part.removeAttribute("aria-live");
  }
  ghost.classList.add("beat-ghost");
  delete ghost.dataset.motion;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  for (const image of ghost.querySelectorAll("img")) image.decoding = "sync";
  return ghost;
}

// A copy pinned over the card's box, with the look the card had, placed
// after the card so lookups by class still find the real one first.
export function pinGhost(card, zIndex) {
  const ghost = lookAlike(card, zIndex);
  card.after(ghost);
  return ghost;
}

// The same copy, not yet placed, for a layer over the card's offset parent:
// copies read together and placed together cost one layout, not one each.
export function lookAlike(card, zIndex) {
  const ghost = ghostOf(card);
  const parts = [card, ...card.querySelectorAll("*")],
    copies = [ghost, ...ghost.querySelectorAll("*")];
  const looks = parts.map((part) => getComputedStyle(part));
  looks.forEach((look, index) => {
    for (const name of LOOK)
      copies[index].style.setProperty(name, look.getPropertyValue(name));
  });
  Object.assign(ghost.style, {
    position: "absolute",
    margin: "0",
    left: `${card.offsetLeft}px`,
    top: `${card.offsetTop}px`,
    width: `${card.offsetWidth}px`,
    height: `${card.offsetHeight}px`,
    zIndex,
  });
  return ghost;
}

// The same copy fixed where the element shows on screen, over the page, so
// it stays seen while the element and what holds it are hidden.
export function fixedGhost(el) {
  const box = el.getBoundingClientRect(),
    ghost = lookAlike(el, getComputedStyle(el).zIndex);
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    transform: "none",
    translate: "none",
  });
  document.body.append(ghost);
  return ghost;
}

// Drops the ghost and its pictures. Chromium keeps an image whose address
// is dropped after it left the page, with everything around it, so the
// address goes first.
export function releaseGhost(ghost) {
  if (!ghost) return;
  for (const image of ghost.querySelectorAll("img"))
    image.removeAttribute("src");
  ghost.remove();
}

// Every ghost under root, as when the world changes under them.
export function releaseGhosts(root = document) {
  for (const ghost of root.querySelectorAll(".beat-ghost")) releaseGhost(ghost);
}

// Plays the ghost out to the keyframe `to` and releases it when the motion
// ends or is cancelled. It rests invisible, so it never shows again; one
// that waits `delay` holds its look until it moves.
export function fadeGhost(ghost, to, duration, delay = 0) {
  if (!ghost) return null;
  const from = getComputedStyle(ghost).opacity;
  ghost.style.opacity = "0";
  const motion = ghost.animate([{ opacity: from }, { opacity: 0, ...to }], {
    duration,
    delay,
    fill: "backwards",
    easing: "cubic-bezier(.22,.61,.36,1)",
  });
  const done = () => releaseGhost(ghost);
  motion.finished.then(done, done);
  return motion;
}
