// A play that cancels a travel or a scene change mid-motion settles the cast
// instead of cutting it: a figure still entering, or one whose farewell was
// under way, goes from how it looks now to where it rests over SETTLE_MS,
// and one leaving the stage fades out there before it is dropped. Reduced
// motion only fades. Presentation only.
export const SETTLE_MS = 200;

// Settles `part` from its look now. `hidden` starts it unseen (a figure
// still waiting to enter); `leaving` fades it out where it stands.
export function settle(part, { hidden = false, leaving = false, reduced }) {
  const look = getComputedStyle(part),
    from = { opacity: hidden ? "0" : look.opacity, offset: 0 };
  if (!reduced) from.translate = look.translate;
  for (const motion of part.getAnimations()) motion.cancel();
  // With only a first keyframe the motion ends at the part's resting look.
  const to = { ...from, opacity: 0, offset: 1 };
  return part.animate(leaving ? [from, to] : [from], {
    duration: SETTLE_MS,
    easing: "ease-out",
    fill: leaving ? "forwards" : "none",
  });
}
