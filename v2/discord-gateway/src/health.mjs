import { createServer } from "node:http";

export const STALE_MS = 300000;

export function healthStatus({ ready, rooms, cast, lastTickAt, startedAt, now }) {
  const last = lastTickAt ?? startedAt;
  const fresh = now - last < STALE_MS;
  return {
    code: ready && fresh ? 200 : 503,
    body: { ready: Boolean(ready), rooms, cast, lastTickAt: lastTickAt ?? null },
  };
}

export function startHealth(port, read) {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const { code, body } = healthStatus({ ...read(), now: Date.now() });
    response.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  server.listen(port);
  return server;
}
