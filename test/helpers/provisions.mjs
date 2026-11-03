// Myrto packs the Travel Provisions from bread, figs and wine, and the
// voyage out of Thebes uses them up (rules 95). A test that starts aboard or
// mid-voyage puts the packed provisions straight into play.
export function stowProvisions(world, holder) {
  world.usedUp = (world.usedUp || []).filter((id) => id !== "greek-provisions");
  world.items["greek-provisions"].holder = holder;
  return world;
}
