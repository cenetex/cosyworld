export function stowProvisions(world, holder) {
  world.usedUp = (world.usedUp || []).filter((id) => id !== "greek-provisions");
  world.items["greek-provisions"].holder = holder;
  return world;
}
