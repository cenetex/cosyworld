// The used-up state (rules 95). A used-up thing is out of play: it waits,
// unseen and with no history, at its authored holder, and its id is listed in
// `world.usedUp`. Only regrowth or a choice's drop brings it back, as the same
// thing with the same id, so a world never holds two of anything.
export const usedUp = (world, id) =>
  Array.isArray(world.usedUp) && world.usedUp.includes(id);

// Use a thing up. Whatever it held is left where it was, and every record
// that named it as a keepsake, a stake or a taken thing lets it go, so a
// regrown loaf can never answer an old theft.
export function useUp(world, id, rest) {
  sendHome(world, id, rest);
  world.usedUp = [...new Set([...(world.usedUp || []), id])].sort();
}

// Put a thing at its rest, as using it up does, but leave it in play: what it
// held is left where it was, and every record that named it lets it go.
export function sendHome(world, id, rest) {
  const item = world.items[id];
  let place = item.holder;
  for (let i = 0; i < 32 && world.items[place]; i++)
    place = world.items[place].holder;
  place = world.actors?.[place]?.place ?? place;
  for (const other of Object.values(world.items))
    if (other.holder === id) other.holder = place;
  item.holder = rest;
  item.history = [];
  for (const list of Object.values(world.motives?.grievances || {}))
    for (const g of list) if (g.item === id) delete g.item;
  for (const c of world.standoffs || []) if (c.item === id) c.item = null;
  for (const life of Object.values(world.life?.actors || {}))
    delete life.attachments?.[id];
}

// Bring a used-up thing back into play at a holder.
export function bringBack(world, id, holder) {
  world.usedUp = world.usedUp.filter((other) => other !== id);
  world.items[id].holder = holder;
  world.items[id].history = [];
}
