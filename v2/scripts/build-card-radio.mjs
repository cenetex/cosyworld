import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomTracks } from "../card-game/music.mjs";
import { CUE_TRACKS } from "../card-game/music-cues.mjs";
import { TITLE_SONG } from "../card-game/title-song.mjs";

const root = new URL("../card-game/assets/music/", import.meta.url);
const destination = new URL("radio-catalog.json", root);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function radioSources() {
  return [
    ...new Map(
      [
        ...Object.values(roomTracks).flat(),
        ...Object.values(CUE_TRACKS),
        TITLE_SONG,
      ]
        .filter(({ file }) => file)
        .map(({ file, title }) => [file, { file, title }]),
    ).values(),
  ]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((track) => ({
      ...track,
      sourceHash: hash(readFileSync(new URL(track.file, root))),
    }));
}
export function validateRadioCatalog(catalog) {
  const sources = radioSources();
  if (
    !catalog.tracks?.length ||
    JSON.stringify(
      catalog.tracks.map(({ durationMs, ...source }) => source),
    ) !== JSON.stringify(sources) ||
    catalog.tracks.some(
      ({ durationMs }) => !Number.isSafeInteger(durationMs) || durationMs <= 0,
    ) ||
    catalog.version !== hash(JSON.stringify(catalog.tracks))
  )
    throw new Error(
      "Rebuild the radio catalog with node v2/scripts/build-card-radio.mjs (requires ffprobe).",
    );
  return catalog;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let catalog;
  if (process.argv.includes("--check"))
    catalog = validateRadioCatalog(
      JSON.parse(readFileSync(destination, "utf8")),
    );
  else {
    const tracks = radioSources().map((track) => {
      const seconds = Number(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            fileURLToPath(new URL(track.file, root)),
          ],
          { encoding: "utf8" },
        ).trim(),
      );
      return { ...track, durationMs: Math.round(seconds * 1000) };
    });
    catalog = validateRadioCatalog({
      version: hash(JSON.stringify(tracks)),
      tracks,
    });
    writeFileSync(destination, `${JSON.stringify(catalog, null, 2)}\n`);
  }
  console.log(
    `RatiRadio: ${catalog.tracks.length} songs, ${catalog.tracks.reduce((sum, track) => sum + track.durationMs, 0)} ms per loop.`,
  );
}
