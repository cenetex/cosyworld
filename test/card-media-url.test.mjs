import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mediaUrl } from "../v2/card-game/media.mjs";
import hashes from "../v2/card-game/media-manifest.json" with { type: "json" };

const root = new URL("../v2/card-game/", import.meta.url);
describe("card media URLs", () => {
  it("uses one content-versioned URL for relative and public image paths", () => {
    const relative = mediaUrl("./assets/station.png");
    expect(mediaUrl("/card-game/assets/station.png")).toBe(relative);
    expect(mediaUrl(new URL("assets/station.png", root).href)).toBe(relative);
    expect(new URL(relative).searchParams.get("v")).toBe(
      hashes["assets/station.png"],
    );
  });
  it("versions music and keeps playback fragments and other query values", () => {
    const url = new URL(
      mediaUrl("./assets/music/station-1.mp3?v=old&test=1#t=5"),
    );
    expect(url.searchParams.get("v")).toBe(
      hashes["assets/music/station-1.mp3"],
    );
    expect(url.searchParams.get("test")).toBe("1");
    expect(url.hash).toBe("#t=5");
  });
  it("keeps remote, generated, and unknown media URLs", () => {
    for (const source of [
      "https://example.com/card-game/assets/station.png",
      "data:image/png;base64,AA==",
      "blob:https://example.com/test",
      "./generated/new.png",
      "",
      null,
    ])
      expect(mediaUrl(source)).toBe(source);
  });
  it("records the actual bytes for a scene image and a music track", () => {
    for (const path of ["assets/station.png", "assets/music/station-1.mp3"]) {
      const bytes = readFileSync(new URL(path, root));
      expect(hashes[path]).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });
});
