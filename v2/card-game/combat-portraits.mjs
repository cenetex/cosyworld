// Combat keeps the wardrobe already on stage while the committed beats play.
import variants from "./image-variants.json" with { type: "json" };
import { humanAvatarIds } from "./human-cast.mjs";
import { imageUrl } from "./images.mjs";
import { flipStagePortrait, portraitFraming } from "./portrait-facing.mjs";
import { portraitFormForSource } from "./rarity-portraits.mjs";
import { castCombatStem } from "./cast-combat-art.mjs";

const players = new Set(humanAvatarIds);
const poses = ["guard", "attack", "hit"];
export function combatPortrait(id, pose, source, facing) {
  const form = portraitFormForSource(id, source),
    stem = castCombatStem(id);
  if (
    !poses.includes(pose) ||
    (!form && !stem && !players.has(id) && !["moth", "keeper"].includes(id))
  )
    return null;
  // The left-facing clock cannot be mirrored. Keep its authored right view.
  if (id === "keeper" && facing === "right") return null;
  const scarf = players.has(id) && source?.includes(`/${id}-scarf`);
  const file = form
    ? `${form.combat}-${pose}.webp`
    : stem
      ? `assets/combat/${stem}-${pose}.webp`
      : `assets/combat/${id}${scarf ? "-scarf" : ""}-${pose}.webp`;
  return variants.images[file]?.stage ? `./${file}` : null;
}

export function showCombatPortrait(figure, source, pose) {
  const image = figure.querySelector(".portrait-body > img");
  if (!image || !source) return;
  image.src = imageUrl(source);
  image.dataset.source = source;
  image.dataset.flip = String(flipStagePortrait(source, figure.dataset.facing));
  figure.dataset.flip = image.dataset.flip;
  figure.dataset.framing = portraitFraming(source);
  figure.dataset.combatArt = pose;
}

export function createCombatPortraits(fighter) {
  const originals = new Map(),
    ready = new Set();
  const capture = (id) => {
    const figure = fighter(id),
      image = figure?.querySelector(".portrait-body > img");
    if (!image) return null;
    if (!originals.has(figure))
      originals.set(figure, {
        id,
        image,
        src: image.getAttribute("src"),
        source: image.dataset.source,
        imageFlip: image.dataset.flip,
        flip: figure.dataset.flip,
        pose: figure.dataset.pose,
        framing: figure.dataset.framing,
        art: figure.dataset.combatArt,
      });
    return { figure, ...originals.get(figure) };
  };
  const restore = (figure, original) => {
    original.image.src = original.src;
    original.image.dataset.source = original.source;
    original.image.dataset.flip = original.imageFlip;
    figure.dataset.flip = original.flip;
    figure.dataset.pose = original.pose;
    figure.dataset.framing = original.framing;
    if (original.art) figure.dataset.combatArt = original.art;
    else delete figure.dataset.combatArt;
  };
  return {
    async prepare(beats) {
      const needed = new Set();
      for (const beat of beats) {
        for (const [id, pose] of [
          [beat.actorId, beat.kind],
          [beat.targetId, "hit"],
          [beat.targetId, "guard"],
        ]) {
          const original = capture(id);
          if (!original) continue;
          const source = combatPortrait(
            id,
            pose,
            original.source,
            original.figure.dataset.facing,
          );
          if (source && !ready.has(source)) needed.add(source);
        }
      }
      await Promise.all(
        [...needed].map(
          (source) =>
            new Promise((resolve) => {
              const image = new Image();
              const timer = setTimeout(resolve, 1500);
              image.onload = () => {
                ready.add(source);
                clearTimeout(timer);
                resolve();
              };
              image.onerror = () => {
                clearTimeout(timer);
                resolve();
              };
              image.src = imageUrl(source);
            }),
        ),
      );
      for (const figure of originals.keys()) figure.dataset.framing = "wide";
    },
    // Before the first frame the two fighters turn to face each other,
    // whoever they were watching. The keeper's clock is never mirrored:
    // he turns by his right-facing painting.
    face(id, otherId) {
      const figure = fighter(id),
        other = fighter(otherId);
      if (!capture(id) || !other) return;
      const original = originals.get(figure);
      const middle = (el) => {
        const box = el.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      const facing = middle(other) > middle(figure) ? "right" : "left";
      if (figure.dataset.facing === facing) return;
      figure.dataset.facing = facing;
      figure.style.setProperty(
        "--lean",
        facing === "right" ? ".35deg" : "-.35deg",
      );
      if (/^\.\/assets\/keeper(-right)?\.png$/u.test(original.source || "")) {
        original.source = `./assets/keeper${facing === "right" ? "-right" : ""}.png`;
        original.src = imageUrl(original.source);
      }
      original.flip = original.imageFlip = String(
        flipStagePortrait(original.source, facing),
      );
      restore(figure, original);
    },
    pose(id, value) {
      const original = capture(id);
      if (!original) return;
      const { figure } = original;
      const pose = value === "beaten" ? "hit" : value;
      const source = combatPortrait(
        id,
        pose,
        original.source,
        figure.dataset.facing,
      );
      if (source && ready.has(source)) showCombatPortrait(figure, source, pose);
      else restore(figure, original);
      figure.dataset.framing = "wide";
      figure.dataset.pose = value;
    },
    restore() {
      for (const [figure, original] of originals) restore(figure, original);
      originals.clear();
    },
  };
}
