import { describe, it, expect } from "vitest";
import { createWorld, addLog } from "../v2/card-game/world.mjs";
import { currentScene } from "../v2/card-game/scene.mjs";
import {
  sceneVideoContext,
  sceneVideoOptions,
  sceneVideoPrompt,
} from "../v2/card-game/scene-video-context.mjs";

function fixture() {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  world.items.lamp.lit = true;
  world.items.cloth.holder = "lamp";
  const say = (id, text, locationId = "station") =>
    addLog(world, id === "vale" ? "Vale" : "Pip", text, {
      generated: true,
      kind: "dialogue",
      actorId: id,
      locationId,
      cast: ["vale", "moth"],
    });
  say("vale", "An earlier line.");
  say("vale", "The light is under this cloth.");
  say("moth", "I can still see the shape of it.");
  return { world, say };
}
describe("the scene camera", () => {
  it("uses the last two displayed lines, actual holders, visible states, and character appearances", () => {
    const { world } = fixture();
    const scene = sceneVideoContext(world, currentScene(world));
    expect(scene.dialogue.map((line) => line.text)).toEqual([
      "The light is under this cloth.",
      "I can still see the shape of it.",
    ]);
    expect(
      scene.people.find((person) => person.name === "Pip").appearance,
    ).toContain("moth");
    expect(scene.items.find((item) => item.name === "Lamp")).toMatchObject({
      holder: "Vale",
      lit: true,
      covered: true,
    });
    const prompt = sceneVideoPrompt(scene, 10);
    expect(prompt).toContain("10 second film");
    expect(prompt).toContain('Pip: "I can still see the shape of it."');
    expect(prompt).toContain("Black cloth");
    expect(prompt).toContain("Empty station");
  });
  it("keeps future queued lines, other rooms, and private memories outside the snapshot", () => {
    const { world, say } = fixture();
    const reviewed = currentScene(world);
    say("vale", "This has yet to be shown.");
    say("moth", "Words in another room.", "pond");
    world.memories.vale.innerLife = { thought: "A private thought." };
    const scene = sceneVideoContext(world, reviewed);
    expect(JSON.stringify(scene)).not.toContain("yet to be shown");
    expect(JSON.stringify(scene)).not.toContain("another room");
    expect(JSON.stringify(scene)).not.toContain("private thought");
    world.items.oil.holder = "pond";
    expect(
      sceneVideoContext(world, reviewed).items.some(
        (item) => item.name === "Oil flask",
      ),
    ).toBe(false);
  });
  it("chooses a supported duration near ten seconds and adds a frame where supported", () => {
    const model = {
      supported_durations: [4, 6, 8],
      supported_resolutions: ["720p"],
      supported_aspect_ratios: ["16:9"],
      supported_frame_images: ["first_frame"],
      generate_audio: true,
    };
    expect(
      sceneVideoOptions(model, "data:image/jpeg;base64,frame"),
    ).toMatchObject({
      duration: 8,
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
      frame_images: [
        {
          frame_type: "first_frame",
          image_url: { url: "data:image/jpeg;base64,frame" },
        },
      ],
    });
    expect(
      sceneVideoOptions({ supported_durations: [12, 10, 5] }).duration,
    ).toBe(10);
    expect(sceneVideoOptions({ supported_durations: [8, 12] }).duration).toBe(
      8,
    );
    expect(() => sceneVideoOptions(null)).toThrow();
    expect(() => sceneVideoOptions({})).toThrow();
  });
});
