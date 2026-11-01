// The quest card's screen: a small 4:3 picture of the player doing the
// quest's verb with its target, drawn from the images the stage already
// uses. Presentation only; the rules own the want (want.mjs).
import { combatPortrait } from "./combat-portraits.mjs";
import { flipStagePortrait } from "./portrait-facing.mjs";

const BACK = "./assets/card-back.webp";
// Poses for verbs that have them; others use the speaking portraits.
const POSES = { Attack: ["attack", "guard"], Threaten: ["attack", null] };

const picture = (src, className, url) => {
  const img = document.createElement("img");
  img.className = className;
  img.src = url(src);
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  return img;
};

// view: { verb, actor, kind, target, covered, here }. art: { url, portrait,
// thing, place } turn ids into image paths.
export function questScreen(view, art) {
  const screen = document.createElement("span");
  screen.className = "quest-screen";
  const { verb, actor, kind, target, covered } = view;
  screen.dataset.kind = kind;
  // An unknown place is the carved back, whole.
  if (kind === "place" && covered) {
    screen.append(picture(BACK, "quest-back", art.url));
    screen.dataset.back = "true";
    return screen;
  }
  // The place where the step happens shows when it is the place itself or
  // the place the player stands in; elsewhere stays a dark ground.
  const ground = kind === "place" ? target : view.here;
  if (ground) screen.append(picture(art.place(ground), "quest-ground", art.url));
  const [ownPose, theirPose] = POSES[verb] || [];
  const figure = (id, pose, facing, slot) => {
    const base = art.portrait(id),
      src = (pose && combatPortrait(id, pose, base, facing)) || base,
      img = picture(src, `quest-figure quest-${slot}`, art.url);
    img.dataset.flip = String(flipStagePortrait(src, facing));
    return img;
  };
  screen.append(
    figure(actor, ownPose, "right", kind === "place" ? "alone" : "left"),
  );
  if (kind === "place") return screen;
  if (!target || covered)
    screen.append(picture(BACK, "quest-back quest-right", art.url));
  else if (kind === "item")
    screen.append(picture(art.thing(target), "quest-thing", art.url));
  else screen.append(figure(target, theirPose, "left", "right"));
  return screen;
}
