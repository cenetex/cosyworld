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
const allowRemoteMutations = args.includes("--allow-remote-mutations");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const scriptPath = fileURLToPath(import.meta.url);

if (!loopbackHosts.has(baseUrl.hostname) && !allowRemoteMutations) {
  throw new Error(
    "refusing to create smoke avatars outside loopback; pass "
      + "--allow-remote-mutations for an intentional deployed smoke",
  );
}

const cases = [
  {
    host: "7.lonelyforest.com",
    worldpack: "cosyworld.bethlehem",
    location: "Bethlehem",
  },
  {
    host: "89.lonelyforest.com",
    worldpack: "project89.three-rings",
    location: "Threshold Interface",
  },
  {
    host: "lantern.lonelyforest.com",
    worldpack: "cosyworld.lantern-keeper",
    location: "Wayside Lantern Inn",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function requestTarget(base, host, { routerProbe = false } = {}) {
  // Local router tests deliberately exercise nginx's Host dispatch through one
  // loopback listener. A remote smoke must instead connect to the hostname it
  // advertises, so DNS and TLS SNI agree with Host.
  const connectToBase = loopbackHosts.has(base.hostname) || routerProbe;
  const hostname = connectToBase ? base.hostname : host;
  return {
    hostname,
    port: base.port || undefined,
    hostHeader: host,
    // Node otherwise derives SNI from Host. Router probes intentionally send
    // an untrusted Host through the base certificate, so pin SNI separately.
    servername: base.protocol === "https:" ? hostname : undefined,
  };
}

export function requestContext({ method, host, path, target }) {
  const authority = target.port ? `${target.hostname}:${target.port}` : target.hostname;
  return `${method} host=${host} path=${path} connect=${authority}`;
}

export function request(host, path, { method = "GET", body, routerProbe = false } = {}, base = baseUrl) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const transport = base.protocol === "https:" ? https : http;
  const target = requestTarget(base, host, { routerProbe });
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
              // Some intentional routing failures have an empty nginx body.
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
      last = await request(host, "/meta");
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

  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const wallet = `lonelyforest-router-smoke-${spec.host}-${nonce}`;
  const avatarRequest = {
    method: "POST",
    body: {
      name: `Router Smoke ${spec.host}`,
      wallet_address: wallet,
    },
  };
  const mutationDeadline = Date.now() + 10_000;
  let created;
  do {
    created = await request(spec.host, "/avatar", avatarRequest);
    if (created.status === 200 && created.json?.ok) break;
    if (created.status !== 200 || created.json?.status !== 500) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  } while (Date.now() < mutationDeadline);
  assert(
    created.status === 200 && created.json?.ok && created.json?.actor_session,
    `${spec.host} avatar creation failed: ${created.status} ${created.text}`,
  );
  const query = new URLSearchParams({
    actor_id: String(created.json.actor.id),
    actor_session: created.json.actor_session,
    wallet_address: wallet,
  });
  const state = await request(spec.host, `/state?${query}`);
  assert(
    state.status === 200 && state.json?.location?.name === spec.location,
    `${spec.host} entered ${state.json?.location?.name}, expected ${spec.location}`,
  );
  return {
    host: spec.host,
    worldpack: spec.worldpack,
    location: spec.location,
    actor_id: created.json.actor.id,
    world_seq: state.json.world_seq,
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
    }));
  } else {
    const elysium = await ready("0.lonelyforest.com", 503);
    assert(
      elysium.json?.error === "Elysium is not installed in this release",
      `unexpected Elysium placeholder: ${elysium.text}`,
    );
  }

  // This is intentionally a router probe rather than a tenant request: there
  // is no public DNS/TLS identity for the untrusted host.
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
