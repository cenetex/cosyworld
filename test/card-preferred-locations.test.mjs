import { describe, expect, it } from "vitest";
import { preferredLocations } from "../v2/card-game/preferred-locations.mjs";

const spots = [
  [20, 80, 1],
  [50, 70, 0.8],
  [80, 80, 1],
];
const catalog = {
  pond: {
    spots,
    avatars: { vale: 1 },
    backdrops: {
      "assets/night.png": {
        spots: [
          [15, 85, 1],
          [45, 75, 1],
          [75, 85, 1],
        ],
      },
    },
  },
};

describe("preferred painting locations", () => {
  it("reserves named spots before assigning the rest in stable order", () => {
    expect(
      preferredLocations(
        "pond",
        "./assets/day.png",
        ["vale", "ash", "pip"],
        catalog,
      ),
    ).toEqual({
      vale: spots[1],
      ash: spots[0],
      pip: spots[2],
    });
    expect(
      preferredLocations(
        "pond",
        "./assets/day.png",
        ["pip", "vale", "ash"],
        catalog,
      ).ash,
    ).toEqual(spots[0]);
  });
  it("chooses the actual painting and validates its spots", () => {
    expect(
      preferredLocations("pond", "./assets/night.png", ["vale"], catalog).vale,
    ).toEqual([45, 75, 1]);
    expect(
      preferredLocations("pond", "x", ["a", "b", "c", "d"], catalog),
    ).toEqual({});
    expect(
      preferredLocations("pond", "x", ["a"], {
        pond: { spots: [[200, 5, 1]] },
      }),
    ).toEqual({});
    expect(preferredLocations("unknown", "x", ["a"], catalog)).toEqual({});
  });
});

it("projects painting coordinates through a crop and keeps feet visible", async () => {
  const { projectPaintedSpot } = await import(
    "../v2/card-game/preferred-locations.mjs"
  );
  const stage = { left: 0, right: 400, top: 0 };
  const cast = { left: 20, bottom: 700 };
  const art = { left: -100, top: -50, width: 600, height: 900 };
  expect(projectPaintedSpot([50, 50], art, cast, stage, 650)).toEqual({
    left: 180,
    bottom: 300,
  });
  expect(projectPaintedSpot([0, 95], art, cast, stage, 650)).toEqual({
    left: -8,
    bottom: 50,
  });
});
