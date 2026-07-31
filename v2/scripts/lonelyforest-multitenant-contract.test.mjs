import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const deploymentRoot = resolve(repoRoot, "deploy/lonelyforest");

const expected = [
  {
    slug: "root",
    host: "lonelyforest.com",
    upstream: "lonelyforest_root",
    port: "3100",
    registry: "/app/v2/content/official/registry.json",
    entry: "-",
    eventDb: "/data/cosyworld-v2-events.sqlite",
  },
  {
    slug: "0",
    host: "0.lonelyforest.com",
    upstream: "elysium",
    port: "3101",
    registry: "$elysium_registry",
    entry: "652000",
    eventDb: "$tenant_data_root/0/events.sqlite",
  },
  {
    slug: "7",
    host: "7.lonelyforest.com",
    upstream: "bethlehem",
    port: "3107",
    registry: "/app/v2/content/bethlehem/registry.json",
    entry: "700",
    eventDb: "$tenant_data_root/7/events.sqlite",
  },
  {
    slug: "89",
    host: "89.lonelyforest.com",
    upstream: "project89",
    port: "3189",
    registry: "/app/v2/content/project89/registry.json",
    entry: "8900",
    eventDb: "$tenant_data_root/89/events.sqlite",
  },
  {
    slug: "lantern",
    host: "lantern.lonelyforest.com",
    upstream: "lantern_keeper",
    port: "3180",
    registry: "/app/v2/content/lantern-keeper/registry.json",
    entry: "800",
    eventDb: "$tenant_data_root/lantern/events.sqlite",
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startWorldArguments(script, slug) {
  const blockPattern = new RegExp(
    `start_world[\\s\\\\]+\\n\\s+"${escapeRegExp(slug)}"([\\s\\S]*?)(?:\\n\\s*\\n|\\n(?:else|fi)$)`,
    "m",
  );
  const block = script.match(blockPattern)?.[0];
  assert.ok(block, `missing start_world block for ${slug}`);
  return [...block.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

test("Lonely Forest routes fixed hosts to isolated fixed world processes", async () => {
  const [nginx, supervisor, fly, dockerfile] = await Promise.all([
    readFile(resolve(deploymentRoot, "nginx.conf"), "utf8"),
    readFile(resolve(deploymentRoot, "run-multitenant.sh"), "utf8"),
    readFile(resolve(repoRoot, "fly.lonelyforest.toml"), "utf8"),
    readFile(resolve(repoRoot, "Dockerfile"), "utf8"),
  ]);

  const eventDbs = new Set();
  for (const tenant of expected) {
    assert.match(
      nginx,
      new RegExp(
        `upstream\\s+${escapeRegExp(tenant.upstream)}\\s*\\{\\s*server\\s+127\\.0\\.0\\.1:${tenant.port};`,
      ),
      `${tenant.upstream} must stay on its fixed loopback port`,
    );
    assert.match(
      nginx,
      new RegExp(
        `server_name[^;]*${escapeRegExp(tenant.host)}[^;]*;[\\s\\S]*?proxy_pass\\s+http://${escapeRegExp(tenant.upstream)};`,
      ),
      `${tenant.host} must route only to ${tenant.upstream}`,
    );

    const args = startWorldArguments(supervisor, tenant.slug);
    assert.equal(args[0], tenant.slug);
    assert.equal(args[1], tenant.port);
    assert.equal(args[2], tenant.registry);
    assert.equal(args[3], tenant.entry);
    assert.equal(args[6], tenant.eventDb);
    assert.ok(!eventDbs.has(tenant.eventDb), `${tenant.eventDb} is reused`);
    eventDbs.add(tenant.eventDb);
  }

  assert.match(
    supervisor,
    /if \[ -r "\$elysium_registry" \]; then/,
    "Elysium must be optional until its compiled registry lands",
  );
  assert.match(
    supervisor,
    /elysium_registry="\/app\/v2\/content\/elysium-only\/registry\.json"/,
  );
  assert.match(
    nginx,
    /return 503 '\{"ok":false,"error":"Elysium is not installed in this release"\}'/,
  );
  assert.match(nginx, /listen 0\.0\.0\.0:3000 default_server;[\s\S]*?return 421;/);
  assert.equal((fly.match(/\[\[mounts\]\]/g) ?? []).length, 1);
  assert.match(fly, /source = "lonelyforest_data"/);
  assert.match(fly, /app = "\/app\/deploy\/lonelyforest\/run-multitenant\.sh"/);
  assert.match(dockerfile, /apt-get install[^\\\n]*ca-certificates nginx/);
  assert.match(dockerfile, /COPY deploy\/lonelyforest \/app\/deploy\/lonelyforest/);
});
