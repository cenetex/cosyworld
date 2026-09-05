#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const baseUrl = new URL(
  args.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:3000",
);
const expectElysium = args.includes("--expect-elysium");
const useSharedTransport = args.includes("--shared-transport");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const scriptPath = fileURLToPath(import.meta.url);

const cases = [
  {
    host: "7.lonelyforest.com",
    worldpack: "cosyworld.bethlehem",
    location: "Bethlehem",
    entryLocation: "cosyworld.core:location/1",
  },
  {
    host: "89.lonelyforest.com",
    worldpack: "project89.three-rings",
    location: "Threshold Interface",
    entryLocation: "project89.operation-liberation:location/8900",
  },
  {
    host: "lantern.lonelyforest.com",
    worldpack: "cosyworld.lantern-keeper",
    location: "Wayside Lantern Inn",
    entryLocation: "cosyworld.core:location/1",
  },
  {
    host: "hoppycat.lonelyforest.com",
    worldpack: "hoppycat.february-third",
    location: "Halfway Tea Garden",
    entryLocation: "hoppycat.archive:location/770000",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function requestTarget(base, host, {
  routerProbe = false,
  sharedTransport = false,
} = {}) {
  const connectToBase = loopbackHosts.has(base.hostname) || routerProbe || sharedTransport;
  const hostname = connectToBase ? base.hostname : host;
  return {
    hostname,
    port: base.port || undefined,
    hostHeader: host,
    servername: base.protocol === "https:" ? hostname : undefined,
  };
}

export function requestContext({ method, host, path, target }) {
  const authority = target.port ? `${target.hostname}:${target.port}` : target.hostname;
  return `${method} host=${host} path=${path} connect=${authority}`;
}

export function request(host, path, {
  method = "GET",
  body,
  routerProbe = false,
  sharedTransport = false,
} = {}, base = baseUrl) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const transport = base.protocol === "https:" ? https : http;
  const target = requestTarget(base, host, { routerProbe, sharedTransport });
  const context = requestContext({ method, host, path, target });
  return new Promise((resolveRequest, rejectRequest) => {
    const req = transport.request(
      {
        protocol: base.protocol,
        hostname: target.hostname,
        port: target.port,
        ...(target.servername ? { servername: target.servername } : {}),
        method,
        path,
        headers: {
          host: target.hostHeader,
          accept: "application/json",
          ...(payload === null
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }),
        },
        timeout: 10_000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch {
            }
          }
          resolveRequest({ status: response.statusCode, json, text });
        });
      },
    );
    req.on("error", (error) => {
      rejectRequest(new Error(`${context}: ${error.message}`, { cause: error }));
    });
    req.on("timeout", () => req.destroy(new Error(`${context}: timed out after 10000ms`)));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function ready(host, expectedStatus = 200) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await request(host, "/meta", { sharedTransport: useSharedTransport });
      if (last.status === expectedStatus) return last;
    } catch (error) {
      last = { text: error.message };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(
    `${host} did not become ready with HTTP ${expectedStatus}: ${last?.text ?? "no response"}`,
  );
}

async function assertWorld(spec) {
  const meta = await ready(spec.host);
  assert(
    meta.json?.worldpack?.id === spec.worldpack,
    `${spec.host} mounted ${meta.json?.worldpack?.id}, expected ${spec.worldpack}`,
  );
  assert(
    meta.json?.worldpack?.entry_location === spec.entryLocation,
    `${spec.host} entry location was ${meta.json?.worldpack?.entry_location}, expected ${spec.entryLocation}`,
  );
  assert(
    meta.json?.persistence?.snapshot_enabled === true
      && meta.json?.persistence?.event_store_enabled === true,
    `${spec.host} does not have snapshot and event-store persistence enabled`,
  );
  assert(
    meta.json?.persistence?.event_store?.status === "healthy"
      && meta.json.persistence.event_store.consecutive_append_failures === 0
      && meta.json.persistence.event_store.consecutive_read_failures === 0
      && meta.json.persistence.event_store.pending_event_count === 0,
    `${spec.host} persistence is degraded: ${JSON.stringify(meta.json?.persistence?.event_store)}`,
  );

  return {
    host: spec.host,
    worldpack: spec.worldpack,
    location: spec.location,
    entry_location: spec.entryLocation,
  };
}

async function main() {
  const root = await ready("lonelyforest.com");
  assert(
    root.json?.worldpack?.id === "cosyworld.official",
    `root host mounted ${root.json?.worldpack?.id}`,
  );

  const matrix = [];
  for (const spec of cases) matrix.push(await assertWorld(spec));

  if (expectElysium) {
    matrix.push(await assertWorld({
      host: "0.lonelyforest.com",
      worldpack: "cosyworld.elysium",
      location: "Void 001",
      entryLocation: "cosyworld.elysium:location/652000",
    }));
  } else {
    const elysium = await ready("0.lonelyforest.com", 503);
    assert(
      elysium.json?.error === "Elysium is not installed in this release",
      `unexpected Elysium placeholder: ${elysium.text}`,
    );
  }

  const unknown = await request("untrusted.lonelyforest.com", "/", { routerProbe: true }, baseUrl);
  assert(unknown.status === 421, `unknown host returned HTTP ${unknown.status}`);

  console.log(JSON.stringify({
    ok: true,
    root_worldpack: root.json.worldpack.id,
    matrix,
    elysium: expectElysium ? "ready" : "pending-registry",
    unknown_host_status: unknown.status,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
