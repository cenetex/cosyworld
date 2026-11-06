// The quest card's screen: a small 4:3 picture of the player doing the
// quest's verb with its target, drawn from the images the stage already
// uses. Presentation only; the rules own the want (want.mjs).
import { combatPortrait } from "./combat-portraits.mjs";
import { flipStagePortrait } from "./portrait-facing.mjs";
import { people, places, things } from "./world.mjs";

const BACK = "./assets/card-back.webp";
// Poses for verbs that have them; others use the speaking portraits.
const POSES = { Strike: ["attack", "guard"], Threaten: ["attack", null] };
const ACTION_POSES = { attack: "Strike", threaten: "Threaten" };

// A resolved action carries its subjects even after an item changes hands.
export function actionScene(event, visible) {
  const { actorId, itemId, targetId, receiveId, locationId, fromLocationId } =
    event;
  if (!people[actorId] || !visible(actorId)) return null;

  const items = [...new Set([itemId, receiveId, targetId])].filter(
    (id) => things[id] && visible(id),
  );
  const other =
    people[targetId] && targetId !== actorId && visible(targetId)
      ? targetId
      : null;
  const course = event.verb === "course" ? targetId : null;
  const here = [course, locationId, fromLocationId].find(
    (id) => places[id] && visible(id),
  );
  return {
    actor: actorId,
    here,
    verb: ACTION_POSES[event.verb],
    kind: items.length ? "item" : other ? "person" : "place",
    target: items[0] || other || here,
    items,
    to: items.length ? other : null,
  };
}

const picture = (src, className, url, entity) => {
  const img = document.createElement("img");
  img.className = className;
  if (entity) img.dataset.entity = entity;
  img.src = url(src);
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  return img;
};

// view: { verb, actor, kind, target, covered, here, to, toCovered,
// atCovered }. A step that gives to someone (`to`) shows all three: the
// player, the thing and the recipient. A step bound to a place not yet
// found (`atCovered`) shows the carved box in the recipient's slot, as
// anything unknown on the card does. art: { url, portrait, thing, place } turn ids into image
// paths.
export function questScreen(view, art, asScene = false) {
  const screen = document.createElement("span");
  screen.className = "quest-screen";
  const { verb, actor, kind, target, covered, to } = view;
  screen.dataset.kind = kind;
  if (to || (view.atCovered && !asScene)) screen.dataset.parts = "3";
  // An unknown place is the carved back, whole.
  if (kind === "place" && covered && !asScene) {
    screen.append(picture(BACK, "quest-back", art.url));
    screen.dataset.back = "true";
    return screen;
  }
  // The place where the step happens shows when it is the place itself or
  // the place the player stands in; elsewhere stays a dark ground.
  const ground = kind === "place" ? target : view.here;
  const hiddenPlace =
    (kind === "place" && covered) || view.hereCovered || view.atCovered;
  if (asScene && hiddenPlace)
    screen.append(picture(BACK, "quest-ground", art.url));
  else if (ground)
    screen.append(picture(art.place(ground), "quest-ground", art.url, ground));
  const [ownPose, theirPose] = POSES[verb] || [];
  const figure = (id, pose, facing, slot) => {
    const base = art.portrait(id),
      src = (pose && combatPortrait(id, pose, base, facing)) || base,
      img = picture(src, `quest-figure quest-${slot}`, art.url);
    img.dataset.entity = id;
    img.dataset.flip = String(flipStagePortrait(src, facing));
    return img;
  };
  // A place with no one in it is the painting alone (Settings' pack cards).
  if (actor)
    screen.append(
      figure(actor, ownPose, "right", kind === "place" ? "alone" : "left"),
    );
  if (kind === "place") return screen;
  if (!target || covered)
    screen.append(picture(BACK, "quest-back quest-right", art.url));
  else if (kind === "item")
    for (const item of view.items || [target])
      screen.append(picture(art.thing(item), "quest-thing", art.url, item));
  else screen.append(figure(target, theirPose, "left", "right"));
  if (to && !view.toCovered)
    screen.append(figure(to, theirPose, "left", "right quest-to"));
  else if (to || (view.atCovered && !asScene))
    screen.append(picture(BACK, "quest-back quest-right quest-to", art.url));
  return screen;
}
