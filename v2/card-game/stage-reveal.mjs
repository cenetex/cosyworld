// The stage shows only what its player has revealed (#2186 follow-up). A
// person, a thing or a place new to the view arrives as a face-down card in
// the hand; nothing of it appears in the scene until a tap turns that card.
// Then its figure or item fades in, and a covered place's painting comes up
// out of the black. Presentation only: the rules' world and their knowledge
// are unchanged, and each browser keeps its own player's reveals.

// The entrance tier of the theatre timing: slow enough to be seen arriving.
export const STAGE_REVEAL_MS = 900;

// What the stage may show of a scene: its cast and the things lying there,
// each only once revealed.
export const revealedStage = ({ cast = [], floorItems = [] }, covered) => ({
  cast: cast.filter((id) => !covered(id)),
  floorItems: floorItems.filter(({ id }) => !covered(id)),
});

// Fades in a figure or item a tap just revealed; under reduced motion it is
// simply there.
export function fadeInRevealed(element, { reduced = false } = {}) {
  if (reduced || !element?.animate) return null;
  return element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: STAGE_REVEAL_MS,
    easing: "ease-in-out",
    fill: "backwards",
  });
}
