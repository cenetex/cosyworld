import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import streams from "../v2/card-game/music-streams.json" with { type: "json" };
import {
  buildMusicStreams,
  musicStreamOffset,
} from "../v2/scripts/build-card-music.mjs";

const frame = Buffer.from([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]);
function tagged({ version = 4, footer = false, body = 130 } = {}) {
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    version,
    0,
    footer ? 0x10 : 0,
    (body >> 21) & 127,
    (body >> 14) & 127,
    (body >> 7) & 127,
    body & 127,
  ]);
  const end = Buffer.from(header);
  end.write("3DI", 0, "ascii");
  return Buffer.concat([
    header,
    Buffer.alloc(body),
    ...(footer ? [end] : []),
    frame,
  ]);
}

describe("music stream metadata", () => {
  it.each([3, 4])("preserves the audio after an ID3v2.%s tag", (version) => {
    const bytes = tagged({ version });
    const before = Buffer.from(bytes);
    const offset = musicStreamOffset(bytes);
    expect(offset).toBe(140);
    expect(bytes.subarray(offset)).toEqual(frame);
    expect(bytes).toEqual(before);
  });
  it("includes a matching v2.4 footer in the skipped metadata", () => {
    const bytes = tagged({ footer: true });
    expect(musicStreamOffset(bytes)).toBe(150);
    expect(bytes.subarray(150)).toEqual(frame);
  });
  it("keeps tag-free audio at offset zero", () => {
    expect(musicStreamOffset(frame)).toBe(0);
  });
  it.each([
    ["a complete header", () => Buffer.from("ID3")],
    ["a supported version", () => tagged({ version: 5 })],
    ["a supported older version", () => tagged({ version: 2 })],
    [
      "a valid revision",
      () => {
        const b = tagged();
        b[4] = 255;
        return b;
      },
    ],
    [
      "supported v2.3 flags",
      () => {
        const b = tagged({ version: 3 });
        b[5] = 16;
        return b;
      },
    ],
    [
      "supported v2.4 flags",
      () => {
        const b = tagged();
        b[5] = 1;
        return b;
      },
    ],
    [
      "a synchsafe size",
      () => {
        const b = tagged();
        b[6] = 128;
        return b;
      },
    ],
    ["a complete tag", () => tagged().subarray(0, 15)],
    [
      "a footer signature",
      () => {
        const b = tagged({ footer: true });
        b[140] = 0;
        return b;
      },
    ],
    [
      "a matching footer",
      () => {
        const b = tagged({ footer: true });
        b[144] = 1;
        return b;
      },
    ],
    ["an MPEG frame", () => Buffer.from("plain audio")],
    ["an MPEG version", () => Buffer.from([255, 235, 144, 0])],
    ["Layer III audio", () => Buffer.from([255, 253, 144, 0])],
    ["an MPEG sample rate", () => Buffer.from([255, 251, 156, 0])],
    ["an MPEG bitrate", () => Buffer.from([255, 251, 240, 0])],
  ])("requires %s", (_, makeBytes) => {
    expect(() => musicStreamOffset(makeBytes())).toThrow();
  });
  it("records every original hash and keeps each audio suffix unchanged", () => {
    expect(buildMusicStreams()).toEqual(streams);
    expect(Object.keys(streams).length).toBeGreaterThan(0);
    for (const [source, record] of Object.entries(streams)) {
      const bytes = readFileSync(
        new URL(`../v2/card-game/${source}`, import.meta.url),
      );
      const before = createHash("sha256").update(bytes).digest("hex");
      expect(record.sourceHash).toBe(before);
      expect(record.file).toBe(
        source.replace("assets/music/", "assets/music-stream/"),
      );
      expect(musicStreamOffset(bytes)).toBe(record.offset);
      expect(musicStreamOffset(bytes.subarray(record.offset))).toBe(0);
      expect(
        createHash("sha256")
          .update(
            readFileSync(new URL(`../v2/card-game/${source}`, import.meta.url)),
          )
          .digest("hex"),
      ).toBe(before);
    }
  });
});
