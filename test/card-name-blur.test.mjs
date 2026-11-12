import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { people, places, things } from "../v2/card-game/world/catalog.mjs";
import { coveredTextReader } from "../v2/card-game/speech-knowledge.mjs";

const CARDS = {
  places: {
    zzHatch: { name: "Parcel Hatch" },
    zzLoft: { name: "Quiet loft" },
  },
  people: { zzBell: { name: "Old Bell" }, zzOrla: { name: "Orla" } },
  things: { zzLamp: { name: "The Brass Lamp" }, zzKey: { name: "Tin Whistle" } },
};
const catalogs = { places, people, things };
const world = {
  actors: { zzBell: {}, zzOrla: {} },
  items: { zzLamp: {}, zzKey: {}, cloth: { holder: null } },
};
const ids = Object.values(CARDS).flatMap(Object.keys);
const read = (hidden = ids) =>
  coveredTextReader(world, (id) => hidden.includes(id));

describe("caption blur covers names, not ordinary words (#2740)", () => {
  beforeAll(() => {
    for (const kind in CARDS) Object.assign(catalogs[kind], CARDS[kind]);
  });
  afterAll(() => {
    for (const kind in CARDS)
      for (const id in CARDS[kind]) delete catalogs[kind][id];
  });

  it("covers a whole name in any case, with its article", () => {
    const blur = read();
    expect(blur("I left it at the Parcel Hatch.")).toBe("I left it at a place.");
    expect(blur("ask at parcel hatch")).toBe("ask at a place");
    expect(blur("Orla took The Brass Lamp from Old Bell.")).toBe(
      "Someone took something from someone.",
    );
    expect(blur("Parcel Hatch is shut.")).toBe("A place is shut.");
  });

  it("leaves a common noun that is a name's last word", () => {
    const blur = read();
    for (const line of [
      "The kettle warms and rain taps the hatch.",
      "A lamp burns low; the bell rings twice.",
      "I lost my whistle under a hatch.",
      "Hatch light falls on the floor.",
      "It is late. Bell or no bell, I am staying.",
      "The loft is cold and quiet.",
      "Hatchs rattle and lamps gutter.",
    ])
      expect(blur(line)).toBe(line);
  });

  it("covers a short form written as the name is", () => {
    const blur = read();
    expect(blur("Meet me by the Hatch at dusk.")).toBe("Meet me by a place at dusk.");
    expect(blur("I gave Bell the Lamp.")).toBe("I gave someone something.");
    expect(blur("The Lamp is lit.")).toBe("Something is lit.");
    expect(blur("Ask Bell for the Whistle.")).toBe("Ask someone for something.");
  });

  it("handles possessives and plurals", () => {
    const blur = read();
    expect(blur("That is Bell's Whistle.")).toBe("That is someone's something.");
    expect(blur("Orla's hands shook at the Parcel Hatch's sill.")).toBe(
      "Someone's hands shook at a place's sill.",
    );
    expect(blur("Three Lamps and two Whistles.")).toBe("Three Lamps and two Whistles.");
  });

  it("keeps the names of uncovered cards", () => {
    const blur = read(["zzLamp", "zzKey", "zzBell"]);
    expect(blur("Then Bell stood by the Hatch with the Lamp.")).toBe(
      "Then someone stood by the Hatch with something.",
    );
    expect(read([])("Bell stood by the Parcel Hatch.")).toBe(
      "Bell stood by the Parcel Hatch.",
    );
  });
});
