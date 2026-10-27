import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { publicAssets } from "./public-assets.mjs";

const assets = new Map(
  publicAssets.map(({ file, contentType }) => [
    `/${file}`,
    [file, contentType],
  ]),
);
assets.set("/", assets.get("/index.html"));
function storyBudget() {
  const value = Number(process.env.COSYWORLD_CARD_STORY_BUDGET_MS || 30_000);
  return Number.isFinite(value)
    ? Math.max(30_000, Math.min(value, 1_900_000))
    : 30_000;
}
export function createServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const path = pathname.startsWith("/card-game/")
      ? pathname.slice("/card-game".length)
      : pathname;
    if (["/card-game/text", "/card-game/text/prepare", "/card-game/text/complete"].includes(pathname) && req.method === "POST") {
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
    try {
      let body = await readFile(new URL(asset[0], import.meta.url));
      if (asset[0] === "index.html")
        body = Buffer.from(
          body
            .toString()
            .replace(
              'name="cosy-story-budget-ms" content="30000"',
              `name="cosy-story-budget-ms" content="${storyBudget()}"`,
            ),
        );
      const headers = {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://openrouter.ai; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
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
