import { importPack } from "./authoring-draft.mjs";
import { sourceEdit } from "./authoring-edits.mjs";
import { nameKey } from "./authoring-cast.mjs";

export const seedKinds = { place: "places", avatar: "avatars", item: "items" };
const need = (ok, text) => {
  if (!ok) throw new Error(text);
};
export function emptySeedWorld() {
  return {
    draft: importPack({
      pack: {
        id: "made-world",
        name: "Your world",
        entry: "",
        places: {},
        avatars: {},
        items: {},
      },
    }),
    launch: null,
    assets: new Map(),
  };
}
export function seedCards(pack) {
  return Object.entries(seedKinds).flatMap(([kind, group]) =>
    Object.entries(pack?.[group] || {}).map(([id, card]) => ({
      id,
      kind,
      name: card.name,
      text: card.text,
    })),
  );
}
export function seedContext(source, replacing) {
  const all = seedCards(source.pack),
    names = new Map(all.map((c) => [c.id, c.name]));
  return all
    .filter((c) => !replacing || c.id === replacing)
    .map(({ id, ...card }) => {
      const entity = source.pack[seedKinds[card.kind]][id];
      const place = names.get(entity.place || entity.holder);
      const target = names.get(entity.want?.target);
      return {
        ...card,
        text: `${place ? `At ${place}. ` : ""}${target ? `Wants ${target}. ` : ""}${card.text}`.slice(
          0,
          600,
        ),
      };
    })
    .slice(0, 24);
}
function checkedCards(cards, kind, source, replacing) {
  const expected = kind === "world" ? Object.keys(seedKinds) : [kind];
  need(
    Array.isArray(cards) && cards.length === expected.length,
    "Draw the requested set of cards again.",
  );
  const names = new Set(
    seedCards(source.pack)
      .filter((c) => c.id !== replacing)
      .map((c) => nameKey(c.name)),
  );
  const kinds = new Set();
  for (const c of cards) {
    need(
      c &&
        Object.keys(c).sort().join() === "kind,name,text" &&
        expected.includes(c.kind) &&
        !kinds.has(c.kind),
      "Draw one card of each requested kind.",
    );
    for (const [key, max] of [
      ["name", 80],
      ["text", 600],
    ])
      need(
        typeof c[key] === "string" &&
          c[key].trim() &&
          c[key].length <= max &&
          !/[\u0000-\u001f\u007f]/u.test(c[key]),
        "Use a short card name and description.",
      );
    const name = nameKey(c.name);
    need(name && !names.has(name), "Draw a card with a fresh name.");
    names.add(name);
    kinds.add(c.kind);
  }
}
export function seedEdit(
  record,
  { kind, cards, replacing, discard, quest },
  id = () => `made-${crypto.randomUUID()}`,
) {
  const source = {
    pack: record.draft.pack,
    bridge: record.draft.bridge,
    launch: record.launch ?? null,
  };
  need(source.pack?.id === "made-world", "Open a world made from a seed.");
  const pack = structuredClone(source.pack);
  let launch = structuredClone(source.launch),
    selected;
  if (quest) {
    need(pack.avatars[quest], "Choose an avatar in this world.");
    if (discard) delete pack.avatars[quest].want;
    else {
      const choices = seedCards(pack).filter(
        (c) =>
          c.id !== quest &&
          (c.kind !== "place" || c.id !== pack.avatars[quest].place),
      );
      need(
        choices.length && pack.entry,
        "Uncover a location and a quest target first.",
      );
      const previous = pack.avatars[quest].want?.target;
      const next =
        choices[
          (choices.findIndex((c) => c.id === previous) + 1) % choices.length
        ];
      pack.avatars[quest].want = {
        kind: next.kind === "avatar" ? "person" : next.kind,
        target: next.id,
      };
    }
  } else if (discard) {
    const group = seedKinds[kind],
      old = pack[group]?.[discard];
    need(old, "Choose a card in this world.");
    delete pack[group][discard];
    const home =
      kind === "place"
        ? Object.keys(pack.places)[0] || ""
        : old.place || pack.entry;
    for (const avatar of Object.values(pack.avatars)) {
      if (avatar.place === discard) avatar.place = home;
      if (avatar.want?.target === discard || !home) delete avatar.want;
    }
    for (const item of Object.values(pack.items))
      if (item.holder === discard) item.holder = home;
    for (const [place, card] of Object.entries(pack.places)) {
      const linked = card.exits.includes(discard);
      card.exits = card.exits.filter((to) => to !== discard);
      if (linked && home && place !== home) {
        card.exits = [...new Set([...card.exits, home])];
        pack.places[home].exits = [
          ...new Set([...pack.places[home].exits, place]),
        ];
      }
    }
    if (pack.entry === discard) pack.entry = home;
    if (launch?.place === discard)
      launch = home ? { schemaVersion: 1, place: home } : null;
  } else {
    need(
      Object.hasOwn(seedKinds, kind) || kind === "world",
      "Choose a card kind.",
    );
    need(
      kind !== "world" || !seedCards(pack).length,
      "Uncover cards in the current world.",
    );
    checkedCards(cards, kind, source, replacing);
    if (replacing)
      need(
        pack[seedKinds[kind]]?.[replacing],
        "Choose the card to regenerate.",
      );
    for (const card of [...cards].sort(
      (a, b) => Number(b.kind === "place") - Number(a.kind === "place"),
    )) {
      const group = seedKinds[card.kind],
        key = replacing || id(),
        old = pack[group][key];
      need(
        replacing || !seedCards(pack).some((c) => c.id === key),
        "Draw a fresh card identity.",
      );
      const base =
        old ||
        (card.kind === "place"
          ? { exits: [] }
          : card.kind === "avatar"
            ? { place: pack.entry }
            : { holder: pack.entry });
      pack[group][key] = {
        ...base,
        name: card.name.trim(),
        text: card.text.trim(),
      };
      if (card.kind === "place" && !old) {
        if (pack.entry) {
          pack.places[pack.entry].exits.push(key);
          pack.places[key].exits.push(pack.entry);
        } else {
          pack.entry = key;
          launch = { schemaVersion: 1, place: key };
        }
        for (const avatar of Object.values(pack.avatars))
          if (!avatar.place) avatar.place = key;
        for (const item of Object.values(pack.items))
          if (!item.holder) item.holder = key;
      }
      selected = { id: key, kind: card.kind };
    }
    if (kind === "world") {
      Object.values(pack.avatars)[0].want = {
        kind: "item",
        target: Object.keys(pack.items)[0],
      };
      pack.name = pack.places[pack.entry].name;
    }
  }
  const edit = sourceEdit(
    source,
    discard ? "Discard card" : replacing ? "Regenerate card" : "Uncover cards",
    [
      ...["name", "entry", "places", "avatars", "items"].map((key) => ({
        path: ["pack", key],
        value: pack[key],
      })),
      { path: ["launch"], value: launch },
    ],
  );
  return {
    edit,
    selected,
    assets: [],
    bytes: new Map(),
    baseline: JSON.stringify([
      record.key,
      record.generation,
      record.draft,
      record.launch ?? null,
    ]),
  };
}
