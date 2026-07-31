#!/usr/bin/env node
import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const baseUrl = new URL(
  args.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? "http://127.0.0.1:3000",
);
const expectElysium = args.includes("--expect-elysium");
const allowRemoteMutations = args.includes("--allow-remote-mutations");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

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

function request(host, path, { method = "GET", body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const transport = baseUrl.protocol === "https:" ? https : http;
  return new Promise((resolveRequest, rejectRequest) => {
    const req = transport.request(
      {
        protocol: baseUrl.protocol,
        hostname: baseUrl.hostname,
        port: baseUrl.port || undefined,
        method,
        path,
        headers: {
          host,
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
    req.on("error", rejectRequest);
    req.on("timeout", () => req.destroy(new Error(`timed out requesting ${host}${path}`)));
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

  const unknown = await request("untrusted.lonelyforest.com", "/");
  assert(unknown.status === 421, `unknown host returned HTTP ${unknown.status}`);

  console.log(JSON.stringify({
    ok: true,
    root_worldpack: root.json.worldpack.id,
    matrix,
    elysium: expectElysium ? "ready" : "pending-registry",
    unknown_host_status: unknown.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
