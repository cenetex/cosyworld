// Sections share permanent access through the pack's recorded story choices.
export function sectionPlace(pack, id) {
  if (pack.places[id]) return id;
  if (pack.avatars[id]) return pack.avatars[id].place;
  if (pack.fixtures?.[id]) return pack.fixtures[id].at;
  const holder = pack.items?.[id]?.holder;
  return holder && (pack.places[holder] ? holder : pack.avatars[holder]?.place);
}

// Reuse authored membership during one validation pass. Requirements stay live.
export function indexSections(pack) {
  const index = new Map();
  for (const section of pack.sections || [])
    for (const place of section.places)
      if (!index.has(place)) index.set(place, section);
  return index;
}

export function sectionAllows(world, pack, id, conditionsMet, index = null) {
  if (world.packs?.[pack.id]?.scope === "full") return true;
  const place = sectionPlace(pack, id);
  const section = index
    ? index.get(place)
    : pack.sections?.find((part) => part.places.includes(place));
  return !section || conditionsMet(world, pack.id, section.requires);
}
