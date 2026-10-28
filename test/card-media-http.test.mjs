import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "../v2/card-game/serve.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(check) {
  const directory = await mkdtemp(join(tmpdir(), "card-media-http-"));
  const song = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
  const module = 'export const sample = "alpha";\n';
  await mkdir(join(directory, "assets/music"), { recursive: true });
  await writeFile(join(directory, "assets/music/attic-1.mp3"), song);
  await writeFile(join(directory, "shared.mjs"), module);
  await writeFile(
    join(directory, "index.html"),
    '<meta name="cosy-story-budget-ms" content="30000">',
  );
  const server = createServer({ assetRoot: pathToFileURL(directory + sep) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await check({
      origin: `http://127.0.0.1:${server.address().port}`,
      directory,
      song,
      module,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

describe("card media HTTP delivery", () => {
  it("keeps content URLs immutable and revalidates aliases and stale versions", async () => {
    await fixture(async ({ origin, song }) => {
      const hash = digest(song);
      for (const path of [
        "/assets/music/attic-1.mp3",
        "/card-game/assets/music/attic-1.mp3",
      ]) {
        for (const [query, cache] of [
          ["", "public, no-cache"],
          ["?v=old", "public, no-cache"],
          [`?v=${hash}&v=${hash}`, "public, no-cache"],
          [`?v=${hash}`, "public, max-age=31536000, immutable"],
        ]) {
          const result = await fetch(origin + path + query);
          expect(result.status).toBe(200);
          expect(result.headers.get("cache-control")).toBe(cache);
          expect(result.headers.get("etag")).toBe(`"${hash}"`);
          expect(Buffer.from(await result.arrayBuffer())).toEqual(song);
        }
      }
    });
  });

  it("returns empty 304 replies for weak, list, and wildcard validators", async () => {
    await fixture(async ({ origin, song }) => {
      const etag = `"${digest(song)}"`;
      for (const validator of [etag, `W/${etag}`, `"old", W/${etag}`, "*"]) {
        for (const method of ["GET", "HEAD"]) {
          const result = await fetch(
            origin + "/card-game/assets/music/attic-1.mp3",
            {
              method,
              headers: { "If-None-Match": validator, Range: "bytes=0-2" },
            },
          );
          expect(result.status).toBe(304);
          expect(result.headers.get("etag")).toBe(etag);
          expect(result.headers.get("content-length")).toBeNull();
          expect((await result.arrayBuffer()).byteLength).toBe(0);
        }
      }
    });
  });

  it("streams valid selections and keeps HEAD metadata at full size", async () => {
    await fixture(async ({ origin, song }) => {
      for (const [range, start, end] of [
        ["bytes=0-31", 0, 31],
        ["bytes=100-", 100, song.length - 1],
        ["bytes=-32", song.length - 32, song.length - 1],
        ["bytes=7-999999999999999999999999", 7, song.length - 1],
        ["bytes=-999999999999999999999999", 0, song.length - 1],
      ]) {
        const result = await fetch(
          origin + "/card-game/assets/music/attic-1.mp3",
          { headers: { Range: range } },
        );
        expect(result.status, range).toBe(206);
        expect(result.headers.get("accept-ranges")).toBe("bytes");
        expect(result.headers.get("content-range")).toBe(
          `bytes ${start}-${end}/${song.length}`,
        );
        expect(result.headers.get("content-length")).toBe(
          String(end - start + 1),
        );
        expect(Buffer.from(await result.arrayBuffer())).toEqual(
          song.subarray(start, end + 1),
        );
      }
      const head = await fetch(origin + "/card-game/assets/music/attic-1.mp3", {
        method: "HEAD",
        headers: { Range: "bytes=0-2" },
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(song.length));
      expect((await head.arrayBuffer()).byteLength).toBe(0);
    });
  });

  it("uses strong If-Range values and returns full bytes for other validators", async () => {
    await fixture(async ({ origin, song }) => {
      const etag = `"${digest(song)}"`;
      for (const [validator, status] of [
        [etag, 206],
        [`W/${etag}`, 200],
        ['"old"', 200],
        ["Wed, 21 Oct 2015 07:28:00 GMT", 200],
      ]) {
        const result = await fetch(
          origin + "/card-game/assets/music/attic-1.mp3",
          { headers: { Range: "bytes=0-2", "If-Range": validator } },
        );
        expect(result.status).toBe(status);
        expect(Buffer.from(await result.arrayBuffer())).toEqual(
          status === 206 ? song.subarray(0, 3) : song,
        );
      }
      for (const range of ["items=0-2", "bytes=0-2,8-9"]) {
        const result = await fetch(
          origin + "/card-game/assets/music/attic-1.mp3",
          { headers: { Range: range } },
        );
        expect(result.status).toBe(200);
        expect(Buffer.from(await result.arrayBuffer())).toEqual(song);
      }
    });
  });

  it("returns bounded 416 replies for invalid and empty byte selections", async () => {
    await fixture(async ({ origin, directory, song }) => {
      for (const range of [
        "bytes=999999999999999999999999-",
        "bytes=9-2",
        "bytes=-0",
        "bytes=-",
        "bytes=invalid",
      ]) {
        const result = await fetch(
          origin + "/card-game/assets/music/attic-1.mp3",
          { headers: { Range: range } },
        );
        expect(result.status, range).toBe(416);
        expect(result.headers.get("content-range")).toBe(
          `bytes */${song.length}`,
        );
        expect((await result.arrayBuffer()).byteLength).toBe(0);
      }
      await writeFile(join(directory, "assets/music/attic-1.mp3"), "");
      const result = await fetch(
        origin + "/card-game/assets/music/attic-1.mp3",
        { headers: { Range: "bytes=0-" } },
      );
      expect(result.status).toBe(416);
      expect(result.headers.get("content-range")).toBe("bytes */0");
      expect((await result.arrayBuffer()).byteLength).toBe(0);
    });
  });

  it("refreshes validators after same-size local edits and keeps HTML fresh", async () => {
    await fixture(async ({ origin, directory, module }) => {
      const first = await fetch(origin + "/card-game/shared.mjs");
      const previous = first.headers.get("etag");
      expect(previous).toBe(`W/"${digest(module)}"`);
      expect(first.headers.get("vary").toLowerCase()).toContain(
        "accept-encoding",
      );
      await first.arrayBuffer();
      const path = join(directory, "shared.mjs");
      const before = await stat(path);
      await writeFile(path, module.replace("alpha", "omega"));
      await utimes(path, before.atime, before.mtime);
      const next = await fetch(origin + "/card-game/shared.mjs", {
        headers: { "If-None-Match": previous },
      });
      expect(next.status).toBe(200);
      expect(next.headers.get("etag")).not.toBe(previous);
      expect(Buffer.from(await next.arrayBuffer())).toEqual(
        await readFile(path),
      );
      const unchanged = await fetch(origin + "/card-game/shared.mjs", {
        headers: { "If-None-Match": next.headers.get("etag") },
      });
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("vary").toLowerCase()).toContain(
        "accept-encoding",
      );
      await unchanged.arrayBuffer();
      for (const path of [
        "/",
        "/index.html",
        "/card-game/",
        "/card-game/index.html",
      ]) {
        const result = await fetch(origin + path, {
          headers: { "If-None-Match": "*" },
        });
        expect(result.status, path).toBe(200);
        expect(result.headers.get("cache-control")).toBe("no-store");
        expect(result.headers.get("etag")).toBeNull();
        await result.arrayBuffer();
      }
    });
  });
});
