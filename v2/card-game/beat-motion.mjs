// How the dialogue's beats move (app.mjs decides which): cards step in depth by
// CSS motion names; a leaving card is an inert copy that fades out faster.
import { fadeGhost, ghostOf, pinGhost, releaseGhost } from "./card-ghost.mjs";

export const STACK_MS = 300,
  STACK_LEAVE_MS = 200,
  STACK_FADE_MS = 160,
  STACK_CLEAR_MS = 200,
  STACK_NEARER = "translateY(8px) scale(1.015)";

export function createBeatMotion({
  front,
  behind,
  panel,
  dialogue,
  reduced,
  setStyle,
}) {
  function stackGhost(card) {
    const ghost = ghostOf(card);
    card.after(ghost);
    return ghost;
  }
  // The old front card keeps its exact box, so its words do not reflow. Going
  // forward it settles behind the new card; going back, or crossfading for
  // reduced motion, it leaves over it.
  function frontGhost(direction) {
    const under = direction === "forward" && !reduced();
    return pinGhost(front, under ? "1" : "3");
  }
  // Cards move in depth with transform and opacity; reduced motion crossfades.
  // The front and behind cards are hit-tested buttons, so their motion is a CSS
  // animation named by data-motion rather than element.animate(): after a modal
  // dialog closes, Chromium can resolve a Web Animation's target from a style
  // cached while the page was inert, and the card stops taking clicks.
  function playMotion(card, motion) {
    delete card.dataset.motion;
    if (!motion) return;
    // Restyling the card ends the old motion; no layout is needed for that.
    void getComputedStyle(card).animationName;
    card.dataset.motion = motion;
  }
  for (const card of [front, behind, panel]) {
    const settle = (event) => {
      if (event.target === card) delete card.dataset.motion;
    };
    card.addEventListener("animationend", settle);
    card.addEventListener("animationcancel", settle);
  }
  // A tall action can reach above the stack's fixed box. Keep the previous
  // card one peek above the action's actual top so it can still take taps.
  function placePreviousBeat() {
    front.style.removeProperty("--beat-slot");
    if (panel.hidden || front.hidden) return;
    const overlap = front.offsetTop - panel.offsetTop;
    if (overlap > 0)
      front.style.setProperty(
        "--beat-slot",
        `translateY(calc(-1 * var(--beat-peek) - ${overlap}px)) scale(var(--beat-behind-scale))`,
      );
  }
  new ResizeObserver(placePreviousBeat).observe(panel);
  let resizeFrame = 0,
    dialogueSize = 0;
  new ResizeObserver(([entry]) => {
    dialogueSize = entry.contentRect.height;
    if (resizeFrame) return;
    // Let this measurement finish before it changes the hand and dock sizes.
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      setStyle(
        document.body.style,
        "--dialogue-size",
        `${panel.hidden ? 0 : dialogueSize}px`,
      );
    });
  }).observe(dialogue);
  function foldGhost(ghost) {
    if (front.hidden)
      return fadeGhost(ghost, { transform: STACK_NEARER }, STACK_LEAVE_MS);
    const from = ghost.getBoundingClientRect(),
      to = front.getBoundingClientRect();
    ghost.style.transformOrigin = "0 0";
    fadeGhost(
      ghost,
      {
        transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
      },
      STACK_MS,
    );
  }
  function animate(direction, ghost) {
    if (!direction || front.hidden) {
      releaseGhost(ghost.front);
      releaseGhost(ghost.behind);
      return;
    }
    const showBehind = !behind.hidden;
    // Reduced motion turns off CSS animation, so the old cards' copies fade
    // out over the new ones instead. Behind the action beat the one dimmed
    // line crossfades as it steps.
    const behindAction = front.parentElement.dataset.action === "true";
    if (behindAction && !reduced()) playMotion(front, "fade");
    if (reduced() || behindAction) {
      fadeGhost(ghost.front, {}, STACK_FADE_MS);
      fadeGhost(ghost.behind, {}, STACK_FADE_MS);
      return;
    }
    if (direction === "arrive" || direction === "settle") {
      if (direction === "arrive") {
        playMotion(front, "fade");
        if (showBehind) playMotion(behind, "fade");
      }
      return;
    }
    // The behind slot is the front card raised by the peek and scaled down;
    // the card before it waits one step deeper, the next one just in front.
    const stack = getComputedStyle(front.closest(".beat-stack"));
    const peek = parseFloat(stack.getPropertyValue("--beat-peek")) || 30;
    const scale =
      parseFloat(stack.getPropertyValue("--beat-behind-scale")) || 0.94;
    const slot = `translateY(-${peek}px) scale(${scale})`;
    const deeper = `translateY(-${peek * 2}px) scale(${scale * scale})`;
    if (direction === "forward") {
      // The new beat fades in front; the old front settles into the slot.
      playMotion(front, "arrive");
      if (showBehind) playMotion(behind, "recede");
      fadeGhost(ghost.front, { transform: slot }, STACK_LEAVE_MS);
      fadeGhost(ghost.behind, { transform: deeper }, STACK_MS);
      return;
    }
    // Back in time: the card behind comes forward; an older one appears behind.
    playMotion(front, "return");
    if (showBehind) playMotion(behind, "emerge");
    fadeGhost(ghost.front, { transform: STACK_NEARER }, STACK_LEAVE_MS);
  }
  return {
    animate,
    foldGhost,
    frontGhost,
    placePreviousBeat,
    playMotion,
    stackGhost,
  };
}
