import http from "node:http";
import { once } from "node:events";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { publicAssets } from "./public-assets.mjs";

function storyBudget() {
  const value = Number(process.env.COSYWORLD_CARD_STORY_BUDGET_MS || 30_000);
  return Number.isFinite(value)
    ? Math.max(30_000, Math.min(value, 1_900_000))
    : 30_000;
}
const fingerprints = new Map();
const isMedia = (type) =>
  !type.startsWith("image/svg+xml") && /^(image|audio|video)\//.test(type);

async function fingerprint(handle, key, offset) {
  const stat = await handle.stat({ bigint: true });
  if (BigInt(offset) > stat.size)
    throw new RangeError("The public asset offset exceeds its source.");
  const stamp = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  let cached = fingerprints.get(key);
  if (!cached || cached.stamp !== stamp) {
    const task = (async () => {
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({
        start: offset,
        autoClose: false,
      }))
        hash.update(chunk);
      return hash.digest("hex");
    })();
    cached = { stamp, task };
    fingerprints.set(key, cached);
  }
  try {
    return { length: Number(stat.size) - offset, hash: await cached.task };
  } catch (error) {
    if (fingerprints.get(key) === cached) fingerprints.delete(key);
    throw error;
  }
}

function unchanged(value, etag) {
  return String(value || "")
    .split(",")
    .some((candidate) => {
      candidate = candidate.trim();
      return candidate === "*" || candidate.replace(/^W\//, "") === etag;
    });
}

function byteRange(value, length) {
  if (typeof value !== "string" || !value.startsWith("bytes=")) return;
  const range = value.slice(6);
  if (range.includes(",")) return;
  const match = /^(\d*)-(\d*)$/.exec(range);
  if (!match || length === 0) return { invalid: true };
  const total = BigInt(length);
  if (!match[1]) {
    if (!match[2] || BigInt(match[2]) === 0n) return { invalid: true };
    const count = BigInt(match[2]);
    return {
      start: Number(count >= total ? 0n : total - count),
      end: length - 1,
    };
  }
  const start = BigInt(match[1]);
  const requestedEnd = match[2] ? BigInt(match[2]) : total - 1n;
  const end = requestedEnd >= total ? total - 1n : requestedEnd;
  return start > end
    ? { invalid: true }
    : { start: Number(start), end: Number(end) };
}

export function createServer({
  assetRoot = new URL("./", import.meta.url),
  assetList = publicAssets,
} = {}) {
  const assets = new Map(
    assetList.map(({ file, contentType, source = file, offset = 0 }) => {
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new RangeError("A public asset needs a whole source offset.");
      return [`/${file}`, { file, contentType, source, offset }];
    }),
  );
  assets.set("/", assets.get("/index.html"));
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const path = pathname.startsWith("/card-game/")
      ? pathname.slice("/card-game".length)
      : pathname;
    if (pathname === "/card-game/text" && req.method === "POST") {
      // Use the same Rust service as production. Keep provider keys there.
      const origin = process.env.COSYWORLD_CARD_TEXT_ORIGIN;
      if (!origin) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Set COSYWORLD_CARD_TEXT_ORIGIN to the Rust game server.",
          }),
        );
        return;
      }
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const response = await fetch(new URL(pathname, origin), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: req.headers.accept || "application/json",
          },
          body: Buffer.concat(chunks),
          signal: AbortSignal.any([
            abort.signal,
            AbortSignal.timeout(storyBudget() - 2_000),
          ]),
        });
        res.writeHead(response.status, {
          "Content-Type":
            response.headers.get("content-type") || "application/json",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        for await (const chunk of response.body) {
          if (!res.write(chunk))
            await once(res, "drain", { signal: abort.signal });
        }
        res.end();
      } catch {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.writeHead(503);
        res.end(
          JSON.stringify({ error: "The story service is taking a moment." }),
        );
      }
      return;
    }
    const asset = assets.get(path);
    if (!asset || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404);
      res.end("Choose the card table at /.");
      return;
    }
    let handle;
    try {
      const file = new URL(asset.source, assetRoot);
      handle = await open(file);
      const headers = {
        "Content-Type": asset.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://openrouter.ai; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
      };
      if (asset.file === "index.html") {
        const source = await handle.readFile();
        if (asset.offset > source.length)
          throw new RangeError("The public asset offset exceeds its source.");
        const body = Buffer.from(
          source
            .subarray(asset.offset)
            .toString()
            .replace(
              'name="cosy-story-budget-ms" content="30000"',
              `name="cosy-story-budget-ms" content="${storyBudget()}"`,
            ),
        );
        res.writeHead(200, { ...headers, "Content-Length": body.length });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }
      const { length, hash } = await fingerprint(
        handle,
        `${file.href}#offset=${asset.offset}`,
        asset.offset,
      );
      const etag = `"${hash}"`;
      const media = isMedia(asset.contentType);
      headers.ETag = media ? etag : `W/${etag}`;
      headers["Cache-Control"] =
        url.search === `?v=${hash}`
          ? "public, max-age=31536000, immutable"
          : "public, no-cache";
      if (media) headers["Accept-Ranges"] = "bytes";
      else headers.Vary = "Accept-Encoding";
      if (unchanged(req.headers["if-none-match"], etag)) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const range =
        req.method === "GET" &&
        media &&
        (!req.headers["if-range"] || req.headers["if-range"] === etag)
          ? byteRange(req.headers.range, length)
          : undefined;
      if (range?.invalid) {
        res.writeHead(416, {
          ...headers,
          "Content-Range": `bytes */${length}`,
          "Content-Length": 0,
        });
        res.end();
        return;
      }
      res.writeHead(range ? 206 : 200, {
        ...headers,
        "Content-Length": range ? range.end - range.start + 1 : length,
        ...(range
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${length}` }
          : {}),
      });
      if (req.method === "HEAD") res.end();
      else
        await pipeline(
          handle.createReadStream({
            start: asset.offset + (range?.start || 0),
            ...(range ? { end: asset.offset + range.end } : {}),
            autoClose: false,
          }),
          res,
        );
    } catch {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(500);
        res.end(
          "The card table is taking a moment. Please restart the local server.",
        );
      }
    } finally {
      await handle?.close();
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.COSYWORLD_CARD_PORT || 4177);
  const server = createServer();
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`CosyWorld card table: http://127.0.0.1:${port}`),
  );
}
