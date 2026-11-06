// Portrait precedence shared by the scene and draft catalogue.
export const residentPortrait = (resident, variant, pose) =>
  pose?.portrait ||
  resident.portrait ||
  variant?.portrait ||
  resident.variants?.awake?.portrait;
