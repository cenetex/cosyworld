// Earned forms are presentation data. Saved experience remains the authority.
const appearances = {
  "hoppycat-arc":
    "Silver-white tousled hair and blue eyes; ivory open-collar shirt, dark brown knitted cardigan, dark trousers, brown leather shoes, and a brown-strapped wristwatch.",
  "hoppycat-hoppy-cat":
    "Long flowing green hair, green eyes, a blue ribbon and small white flowers; ivory floral blouse, teal skirt embroidered with gold, teal sash, turquoise pendant, and brown ankle boots.",
};
export const rarityForms = Object.freeze(
  Object.fromEntries(
    [
      ["hoppycat-arc", 30, "epic", "left"],
      ["hoppycat-hoppy-cat", 100, "mythic", "front"],
    ].map(([id, level, tier, facing]) => [
      id,
      {
        level,
        facing,
        appearance: appearances[id],
        portrait: `assets/hoppycat-archive/${id}-${tier}-cutout.png`,
        combat: `assets/combat/${id}-${tier}`,
      },
    ]),
  ),
);
export const rarityForm = (id, level) =>
  level >= rarityForms[id]?.level ? rarityForms[id] : null;
export const crossedPortraitTier = (id, from, to) =>
  Number.isSafeInteger(from) && !rarityForm(id, from) && !!rarityForm(id, to);
export function portraitFormForSource(id, source) {
  const form = rarityForms[id],
    path = source?.replace(/^\.\//, "");
  return form &&
    (path === form.portrait ||
      ["attack", "hit", "guard"].some(
        (pose) => path === `${form.combat}-${pose}.webp`,
      ))
    ? form
    : null;
}
export const rarityPortraitAssets = Object.values(rarityForms).flatMap(
  (form) => [
    form.portrait,
    ...["attack", "hit", "guard"].map((pose) => `${form.combat}-${pose}.webp`),
  ],
);
