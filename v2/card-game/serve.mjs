import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/world.mjs", ["world.mjs", "text/javascript"]],
  ["/scene.mjs", ["scene.mjs", "text/javascript"]],
  ["/cards.mjs", ["cards.mjs", "text/javascript"]],
  ["/motives.mjs", ["motives.mjs", "text/javascript"]],
  ["/quests.mjs", ["quests.mjs", "text/javascript"]],
  ["/situations.mjs", ["situations.mjs", "text/javascript"]],
  ["/memory.mjs", ["memory.mjs", "text/javascript"]],
  ["/narrative.mjs", ["narrative.mjs", "text/javascript"]],
  ["/dialogue.mjs", ["dialogue.mjs", "text/javascript"]],
  ["/entity-profiles.json", ["entity-profiles.json", "application/json"]],
  ...["station", "attic", "pond", "vale", "moth", "keeper", "keeper-right"].map(
    (id) => [`/assets/${id}.png`, [`assets/${id}.png`, "image/png"]],
  ),
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
      res.writeHead(200, {
        "Content-Type": `${asset[1]}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      });
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
