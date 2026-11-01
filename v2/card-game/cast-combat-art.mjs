// Painted combat poses for the wider cast. Account aliases share their
// identity's paintings; Oak's backdrop edits are not portrait sprites.
import roster from "./assets/combat/cast-roster.json" with { type: "json" };

const portraits = roster.identities.filter(
  (i) => i.presentation !== "backdrop",
);
const stems = new Map(
  portraits.flatMap((i) => i.actorIds.map((id) => [id, i.stem])),
);
export const castCombatStem = (id) => stems.get(id) || null;
// Publish the landscape sources without selecting them as portrait sprites.
export const castCombatAssets = roster.identities.flatMap((i) =>
  i.poses.map((pose) => `assets/combat/${i.stem}-${pose}.webp`),
);
export const castCombatFacings = (facing) =>
  portraits
    .filter((i) => i.nativeFacing === facing)
    .flatMap((i) =>
      i.poses.map((pose) => `assets/combat/${i.stem}-${pose}.webp`),
    );
