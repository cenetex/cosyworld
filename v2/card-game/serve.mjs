import http from "node:http";
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
  ["/quests.mjs", ["quests.mjs", "text/javascript"]],
  ...["station", "attic", "pond", "vale", "moth", "keeper"].map((id) => [
    `/assets/${id}.png`,
    [`assets/${id}.png`, "image/png"],
  ]),
]);
export function createServer() {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
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
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
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
