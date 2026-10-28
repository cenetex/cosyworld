import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const musicRoot = new URL("../card-game/assets/music/", import.meta.url);
const destination = new URL("../card-game/music-streams.json", import.meta.url);

// ID3 sizes cover the tag body. A v2.4 footer adds ten bytes after that body.
// https://id3.org/id3v2.4.0-structure and https://id3.org/id3v2.3.0
export function musicStreamOffset(bytes, label = "Music") {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes.length < 10) fail("ID3 needs its complete header.");
    const version = bytes[3];
    if (![3, 4].includes(version) || bytes[4] === 0xff)
      fail("Use a supported ID3v2.3 or ID3v2.4 tag.");
    const allowed = version === 4 ? 0xf0 : 0xe0;
    if (bytes[5] & ~allowed) fail("ID3 needs supported header flags.");
    const sizeBytes = bytes.subarray(6, 10);
    if (sizeBytes.some((value) => value & 0x80))
      fail("ID3 needs a synchsafe tag size.");
    const size = sizeBytes.reduce((total, value) => total * 128 + value, 0);
    const footer = version === 4 && Boolean(bytes[5] & 0x10);
    offset = 10 + size + (footer ? 10 : 0);
    if (offset + 4 > bytes.length)
      fail("ID3 needs its complete tag and audio.");
    if (footer) {
      const start = 10 + size;
      if (
        bytes[start] !== 0x33 ||
        bytes[start + 1] !== 0x44 ||
        bytes[start + 2] !== 0x49 ||
        Array.from({ length: 7 }, (_, i) => i + 3).some(
          (i) => bytes[start + i] !== bytes[i],
        )
      )
        fail("ID3 needs a footer that matches its header.");
    }
  }
  const [a, b, c, d] = bytes.subarray(offset, offset + 4);
  if (
    offset + 4 > bytes.length ||
    a !== 0xff ||
    (b & 0xe0) !== 0xe0 ||
    ((b >> 3) & 3) === 1 ||
    ((b >> 1) & 3) !== 1 ||
    c >> 4 === 15 ||
    ((c >> 2) & 3) === 3 ||
    (d & 3) === 2
  )
    fail("Audio needs an MPEG Layer III frame after the tag.");
  return offset;
}

export function buildMusicStreams(directory = musicRoot) {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((file) => file.endsWith(".mp3"))
      .sort()
      .map((file) => {
        const original = `assets/music/${file}`;
        const bytes = readFileSync(new URL(file, directory));
        return [
          original,
          {
            file: `assets/music-stream/${file}`,
            offset: musicStreamOffset(bytes, original),
            sourceHash: createHash("sha256").update(bytes).digest("hex"),
          },
        ];
      }),
  );
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const streams = buildMusicStreams();
  const content = `${JSON.stringify(streams, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8") !== content)
      throw new Error(
        "Build the current music stream map with node v2/scripts/build-card-music.mjs.",
      );
  } else writeFileSync(destination, content);
  console.log(
    `Card music streams ${process.argv.includes("--check") ? "checked" : "built"}: ${Object.keys(streams).length} original MP3s preserved.`,
  );
}
