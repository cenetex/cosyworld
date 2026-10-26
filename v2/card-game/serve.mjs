import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { roomTracks } from "./music.mjs";
import { packMediaFiles } from "./pack-registry.mjs";

const assets = new Map([
  ["/shared.mjs", ["shared.mjs", "text/javascript"]],
  ["/shared-auth.mjs", ["shared-auth.mjs", "text/javascript"]],
  ["/shared-rules.mjs", ["shared-rules.mjs", "text/javascript"]],
  ["/shared.css", ["shared.css", "text/css"]],
  ["/shared-cast.json", ["shared-cast.json", "application/json"]],
  ["/assets/shared-cast.png", ["assets/shared-cast.png", "image/png"]],
  ["/assets/shared-places.png", ["assets/shared-places.png", "image/png"]],
  ["/assets/shared-items.png", ["assets/shared-items.png", "image/png"]],

  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/entry.mjs", ["entry.mjs", "text/javascript"]],
  ["/awakening.css", ["awakening.css", "text/css"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/world.mjs", ["world.mjs", "text/javascript"]],
  ["/scene.mjs", ["scene.mjs", "text/javascript"]],
  ["/cards.mjs", ["cards.mjs", "text/javascript"]],
  ["/lessons.mjs", ["lessons.mjs", "text/javascript"]],
  ["/motives.mjs", ["motives.mjs", "text/javascript"]],
  ["/life.mjs", ["life.mjs", "text/javascript"]],
  ["/quests.mjs", ["quests.mjs", "text/javascript"]],
  ["/quest-cards.mjs", ["quest-cards.mjs", "text/javascript"]],
  ["/situations.mjs", ["situations.mjs", "text/javascript"]],
  ["/memory.mjs", ["memory.mjs", "text/javascript"]],
  ["/narrative.mjs", ["narrative.mjs", "text/javascript"]],
  ["/dialogue.mjs", ["dialogue.mjs", "text/javascript"]],
  ["/pack-schema.mjs", ["pack-schema.mjs", "text/javascript"]],
  ["/pack-registry.mjs", ["pack-registry.mjs", "text/javascript"]],
  ["/pack-rules.mjs", ["pack-rules.mjs", "text/javascript"]],
  ["/legacy-saves.mjs", ["legacy-saves.mjs", "text/javascript"]],
  ["/packs.json", ["packs.json", "application/json"]],
  ["/music.mjs", ["music.mjs", "text/javascript"]],
  ...Object.values(roomTracks)
    .flat()
    .map(({ file }) => [
      `/assets/music/${file}`,
      [`assets/music/${file}`, "audio/mpeg"],
    ]),
  ["/entity-profiles.json", ["entity-profiles.json", "application/json"]],
  ...["lamp", "oil", "bell", "cloth"].map((id) => [
    `/assets/${id}-card.png`,
    [`assets/${id}-card.png`, "image/png"],
  ]),
  ...["lamp", "oil", "bell", "cloth"].map((id) => [
    `/assets/${id}-card.jpg`,
    [`assets/${id}-card.jpg`, "image/jpeg"],
  ]),
  ...["station", "attic", "pond", "vale", "moth", "keeper", "keeper-right"].map(
    (id) => [`/assets/${id}.png`, [`assets/${id}.png`, "image/png"]],
  ),
  ...packMediaFiles.map((file) => [
    `/${file}`,
    [
      file,
      file.endsWith(".svg")
        ? "image/svg+xml"
        : file.endsWith(".webp")
          ? "image/webp"
          : "image/png",
    ],
  ]),
]);
export function createServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
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
        const response = await fetch(new URL("/card-game/text", origin), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: req.headers.accept || "application/json",
          },
          body: Buffer.concat(chunks),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(28_000)]),
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
    try {
      const body = await readFile(new URL(asset[0], import.meta.url));
      const headers = {
        "Content-Type":
          asset[1] === "audio/mpeg" ? asset[1] : `${asset[1]}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      };
      if (asset[1] === "audio/mpeg") {
        headers["Accept-Ranges"] = "bytes";
        const range =
          req.method === "GET" &&
          /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range) {
          const start = range[1]
            ? Number(range[1])
            : Math.max(0, body.length - Number(range[2]));
          const end =
            range[1] && range[2]
              ? Math.min(Number(range[2]), body.length - 1)
              : body.length - 1;
          if (start > end || (!range[1] && !range[2])) {
            res.writeHead(416, {
              ...headers,
              "Content-Range": `bytes */${body.length}`,
            });
            res.end();
            return;
          }
          res.writeHead(206, {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${body.length}`,
            "Content-Length": end - start + 1,
          });
          res.end(body.subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, { ...headers, "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end(
        "The card table could not load. Please restart the local server.",
      );
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
