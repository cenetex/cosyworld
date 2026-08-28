export const worldpackRuns = [
  { name: 'Core only', place: 'The Cosy Cottage', replayed: true },
  { name: 'Bethlehem', place: 'Bethlehem', replayed: true },
  { name: 'Lantern Keeper', place: 'The Cosy Cottage', replayed: true },
  { name: 'Ruby High', place: 'Homeroom', replayed: true },
  { name: 'Project89', place: 'Threshold Interface', replayed: true },
  { name: 'Elysium', place: 'Void 001', replayed: true },
] as const;

export const journeyStops = [
  'The Cosy Cottage',
  'Rain-Soft Garden',
  'Moonlit Trail',
  'Old Oak Tree',
  'Lost Woods',
  'Quiet Abbey',
  'Rain-Soft Garden',
] as const;

export const storyRules = [
  {
    title: 'Begin with care',
    text: 'Give the small kindness real weight: a warm cup, a repaired path, a bell placed in the right paw.',
  },
  {
    title: 'Name the real thing',
    text: 'Use exact item and location names. Precision makes the world feel alive and lets a change be remembered.',
  },
  {
    title: 'Let choices meet state',
    text: 'Do not force a quest. Offer a few honest actions and let the current people, items, and places shape the next beat.',
  },
  {
    title: 'Keep one window lit',
    text: 'Wonder may be strange and very large, but the story stays close to dignity, warmth, and a safe way home.',
  },
  {
    title: 'Show what moved',
    text: 'When an item is found, traded, used, or given, say where it was before and where it is now.',
  },
  {
    title: 'End with a changed place',
    text: 'The proof of a story is not a badge. It is a room, relationship, route, or project that the next visitor can meet.',
  },
] as const;
