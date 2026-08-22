import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { candidateFromRegistry } from "./check-deploy-worldpack.mjs";
import {
  recoveryCapturesFromArgs,
  verifyLonelyForestTenants,
} from "./check-lonelyforest-worldpacks.mjs";
import {
  candidateRegistryPath,
  readLonelyForestTenants,
} from "./lonelyforest-tenants.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const deploymentRoot = resolve(repoRoot, "deploy/lonelyforest");
const tenants = readLonelyForestTenants();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function candidateHashes() {
  return new Map(await Promise.all(tenants.map(async (tenant) => {
    const registry = JSON.parse(await readFile(candidateRegistryPath(tenant), "utf8"));
    return [tenant.hosts[0], candidateFromRegistry(registry).bundleHash];
  })));
}

test("Lonely Forest tenant manifest strictly covers supervisor, nginx, Fly health, and deployment", async () => {
  const [nginx, proxyJsonApi, jsonApiUnavailable, supervisor, healthMonitor, fly, workflow, dockerfile, entrypoint] = await Promise.all([
    readFile(resolve(deploymentRoot, "nginx.conf"), "utf8"),
    readFile(resolve(deploymentRoot, "proxy-json-api.conf"), "utf8"),
    readFile(resolve(deploymentRoot, "json-api-unavailable.conf"), "utf8"),
    readFile(resolve(deploymentRoot, "run-multitenant.sh"), "utf8"),
    readFile(resolve(deploymentRoot, "check-required-health.sh"), "utf8"),
    readFile(resolve(repoRoot, "fly.lonelyforest.toml"), "utf8"),
    readFile(resolve(repoRoot, ".github/workflows/deploy.yml"), "utf8"),
    readFile(resolve(repoRoot, "Dockerfile"), "utf8"),
    readFile(resolve(repoRoot, "deploy/entrypoint.sh"), "utf8"),
  ]);

  assert.match(supervisor, /tenant_config="\$\{COSYWORLD_MULTITENANT_TENANTS_CONFIG:-\/app\/deploy\/lonelyforest\/tenants\.tsv\}"/);
  assert.match(supervisor, /while IFS='\|' read -r slug requirement hosts upstream port registry entry_location snapshot_path event_db_path generated_asset_dir extra_origins;/);
  assert.match(supervisor, /trap 'stop_all; exit 1' USR1/);
  assert.match(supervisor, /trap 'stop_all; exit 0' TERM INT HUP/);
  assert.match(supervisor, /trap '' TERM INT HUP USR1/);
  assert.match(
    supervisor,
    /shutdown_grace_secs="\$\{COSYWORLD_MULTITENANT_SHUTDOWN_GRACE_SECS:-4\}"/,
  );
  assert.match(supervisor, /event=shutdown_started grace_secs=\$shutdown_grace_secs/);
  assert.match(supervisor, /event=tenant_shutdown_forced/);
  assert.match(supervisor, /event=shutdown_complete elapsed_secs=\$elapsed_secs forced_process_count=\$forced_process_count/);
  assert.match(supervisor, /if \[ "\$requirement" = "required" \]; then[\s\S]*?failing supervisor/);
  assert.match(supervisor, /kill -USR1 "\$supervisor_pid"/);
  assert.match(supervisor, /health_startup_grace_secs="\$\{COSYWORLD_MULTITENANT_HEALTH_STARTUP_GRACE_SECS:-45\}"/);
  assert.match(supervisor, /supervisor_pid="\$\$"/);
  assert.match(supervisor, /run_world "\$@" "\$supervisor_pid"/);
  assert.match(supervisor, /"\$health_monitor" "\$tenant_config" "\$supervisor_pid" "\$health_startup_grace_secs" "\$health_interval_secs"/);
  assert.match(supervisor, /required tenant health monitor exited with status \$status; failing supervisor \$supervisor_pid/);
  assert.match(healthMonitor, /sleep "\$startup_grace_secs"/);
  assert.match(healthMonitor, /\[ "\$requirement" = "required" \] \|\| continue/);
  assert.match(
    healthMonitor,
    /curl --noproxy '\*' --fail --silent --show-error --max-time "\$probe_timeout_secs" "http:\/\/127\.0\.0\.1:\$port\/health"/,
  );
  assert.match(healthMonitor, /required tenant \$slug failed private \/health[\s\S]*?kill -USR1 "\$supervisor_pid"/);
  // A required tenant that is briefly busy must not cost every hostname on the
  // Machine: root can hold the authoritative runtime lock for seconds under
  // load, so the supervisor only fails after repeated misses.
  assert.match(healthMonitor, /failure_threshold="\$\{5:-3\}"/);
  assert.match(healthMonitor, /probe_timeout_secs="\$\{6:-10\}"/);
  assert.match(healthMonitor, /\[ "\$failures" -ge "\$failure_threshold" \]/);
  assert.match(healthMonitor, /still within tolerance/);
  assert.match(
    supervisor,
    /health_failure_threshold="\$\{COSYWORLD_MULTITENANT_HEALTH_FAILURE_THRESHOLD:-3\}"/,
  );
  assert.match(
    supervisor,
    /health_probe_timeout_secs="\$\{COSYWORLD_MULTITENANT_HEALTH_PROBE_TIMEOUT_SECS:-10\}"/,
  );
  assert.match(
    supervisor,
    /"\$health_monitor" "\$tenant_config" "\$supervisor_pid" "\$health_startup_grace_secs" "\$health_interval_secs" "\$health_failure_threshold" "\$health_probe_timeout_secs"/,
  );

  for (const tenant of tenants) {
    assert.match(
      nginx,
      new RegExp(`upstream\\s+${escapeRegExp(tenant.upstream)}\\s*\\{\\s*server\\s+127\\.0\\.0\\.1:${tenant.port};`),
      `${tenant.slug} upstream must stay on its manifest port`,
    );
    for (const host of tenant.hosts) {
      assert.match(
        nginx,
        new RegExp(`server_name[^;]*${escapeRegExp(host)}[^;]*;[\\s\\S]*?proxy_pass\\s+http://${escapeRegExp(tenant.upstream)};`),
        `${host} must route only to ${tenant.upstream}`,
      );
    }
  }
  assert.deepEqual(
    tenants.filter((tenant) => tenant.required).map((tenant) => tenant.slug),
    ["root", "7", "89", "lantern", "hoppycat"],
  );
  assert.deepEqual(tenants.filter((tenant) => !tenant.required).map((tenant) => tenant.slug), ["0"]);
  assert.match(supervisor, /optional tenant \$slug registry is absent/);
  assert.match(nginx, /return 503 '\{"ok":false,"error":"Elysium is not installed in this release"\}'/);
  assert.match(nginx, /listen 0\.0\.0\.0:3000 default_server;[\s\S]*?location = \/health[\s\S]*?lonelyforest_root/);
  assert.equal((fly.match(/\[\[http_service\.checks\]\]/g) ?? []).length, 1);
  assert.match(fly, /path = "\/health"/);
  assert.match(workflow, /node v2\/scripts\/check-lonelyforest-worldpacks\.mjs/);
  assert.match(workflow, /check-lonelyforest-worldpacks\.mjs[\s\S]*?npm run v2:lonelyforest:contract[\s\S]*?flyctl deploy/);
  assert.match(supervisor, /health_url="http:\/\/127\.0\.0\.1:\$port\/health"/);
  assert.match(
    supervisor,
    /Root readiness follows the same required\/optional boundary[\s\S]*?\[ "\$requirement" = "required" \] \|\| continue[\s\S]*?\[ "\$slug" = "root" \] && continue/,
    "root readiness must not couple optional tenant health to every hostname",
  );
  assert.match(supervisor, /COSYWORLD_REQUIRED_HEALTH_URLS="\$required_health_urls"/);
  assert.equal(
    (supervisor.match(/COSYWORLD_REQUIRED_HEALTH_URLS="\$required_health_urls"/g) ?? []).length,
    1,
    "only root readiness may receive the sibling health list",
  );
  assert.match(
    supervisor,
    /if \[ "\$entry_location_id" = "-" \]; then[\s\S]*?COSYWORLD_REQUIRED_HEALTH_URLS="\$required_health_urls"[\s\S]*?else\n      env -u COSYWORLD_REQUIRED_HEALTH_URLS/,
    "non-root workers must not recursively probe the sibling health list",
  );
  assert.match(nginx, /location = \/health\/live/);
  assert.equal(
    (nginx.match(/include \/app\/deploy\/lonelyforest\/proxy-json-api\.conf;/g) ?? []).length,
    tenants.length + 2,
    "each world plus both default health routes must use the bounded JSON proxy contract",
  );
  assert.equal(
    (nginx.match(/include \/app\/deploy\/lonelyforest\/json-api-unavailable\.conf;/g) ?? []).length,
    tenants.length + 1,
    "every nginx server must install the JSON upstream-failure location",
  );
  assert.match(nginx, /location ~ \^\/\(commands\|state\|health\(\?:\/live\)\?\)\$/);
  assert.match(proxyJsonApi, /^proxy_buffering on;$/m);
  assert.match(proxyJsonApi, /^proxy_request_buffering on;$/m);
  assert.match(proxyJsonApi, /^client_max_body_size 2m;$/m);
  assert.match(proxyJsonApi, /^client_body_timeout 15s;$/m);
  assert.match(proxyJsonApi, /^proxy_read_timeout 15s;$/m);
  assert.match(proxyJsonApi, /^proxy_send_timeout 15s;$/m);
  assert.match(proxyJsonApi, /^proxy_intercept_errors on;$/m);
  assert.match(proxyJsonApi, /^error_page 408 = @json_api_request_timeout;$/m);
  assert.match(proxyJsonApi, /^error_page 413 = @json_api_payload_too_large;$/m);
  assert.match(proxyJsonApi, /^error_page 502 504 =503 @json_api_unavailable;$/m);
  const errorBodies = new Map(
    [...jsonApiUnavailable.matchAll(/return (408|413|503) '([^']+)'/gu)].map((match) => [
      Number(match[1]),
      JSON.parse(match[2]),
    ]),
  );
  assert.deepEqual(errorBodies.get(503), {
    ok: false,
    status: 503,
    command: "",
    verb: "",
    output: "The world is temporarily unavailable. Retry this request; commands must reuse the same intent_id.",
    error_kind: "server_unavailable",
    action: null,
    receipt: null,
    events: [],
  });
  assert.deepEqual(errorBodies.get(408), {
    ok: false,
    status: 408,
    command: "",
    verb: "",
    output: "The command request timed out before it could be accepted. Retry with the same intent_id.",
    error_kind: "invalid_request",
    action: null,
    receipt: null,
    events: [],
  });
  assert.deepEqual(errorBodies.get(413), {
    ok: false,
    status: 413,
    command: "",
    verb: "",
    output: "The command request body is too large.",
    error_kind: "invalid_request",
    action: null,
    receipt: null,
    events: [],
  });
  assert.match(
    nginx,
    /location ~ \^\/\(commands\|state\)\$[\s\S]*?return 421 '\{"ok":false,"status":421,[^']+"error_kind":"invalid_request"/,
  );
  assert.match(nginx, /listen 0\.0\.0\.0:3000 default_server;[\s\S]*?return 421;/);
  assert.doesNotMatch(nginx, /^user\s+/m, "nginx runs as the non-root entrypoint user");
  assert.doesNotMatch(nginx, /\/dev\/(?:stdout|stderr)/, "non-root nginx must not open container-owned standard streams");
  assert.doesNotMatch(nginx, /\/var\/lib\/nginx/, "non-root nginx must not retain default temp paths");
  assert.match(nginx, /^error_log \/tmp\/cosyworld-nginx\/error\.log notice;$/m);
  assert.match(nginx, /^\s*access_log \/tmp\/cosyworld-nginx\/access\.log combined;$/m);
  assert.match(supervisor, /mkdir -p[\s\S]*?\/tmp\/cosyworld-nginx \\/);
  assert.match(supervisor, /tail -n 0 -F \/tmp\/cosyworld-nginx\/error\.log \/tmp\/cosyworld-nginx\/access\.log/);
  assert.match(supervisor, /kill -TERM "\$nginx_log_pid"/);
  for (const [directive, directory] of [
    ["client_body_temp_path", "/tmp/cosyworld-nginx/client-body"],
    ["proxy_temp_path", "/tmp/cosyworld-nginx/proxy"],
    ["fastcgi_temp_path", "/tmp/cosyworld-nginx/fastcgi"],
    ["uwsgi_temp_path", "/tmp/cosyworld-nginx/uwsgi"],
    ["scgi_temp_path", "/tmp/cosyworld-nginx/scgi"],
  ]) {
    assert.match(nginx, new RegExp(`\\b${directive}\\s+${escapeRegExp(directory)};`));
    assert.match(
      supervisor,
      new RegExp(`mkdir -p[\\s\\S]*?${escapeRegExp(directory)}`),
      `${directive} directory must exist before non-root nginx -t`,
    );
  }
  assert.ok(
    supervisor.indexOf("/tmp/cosyworld-nginx/scgi") < supervisor.indexOf('if ! nginx -t -c "$nginx_config"'),
    "all nginx temp directories must be created before nginx validates its config",
  );
  assert.equal((fly.match(/\[\[mounts\]\]/g) ?? []).length, 1);
  assert.match(fly, /source = "lonelyforest_data"/);
  assert.match(fly, /app = "\/app\/deploy\/lonelyforest\/run-multitenant\.sh"/);
  assert.match(fly, /^\s*COSYWORLD_AI_VOICE_MAX_ATTEMPTS = "4"$/m);
  assert.match(fly, /^\s*COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS = "650000"$/m);
  assert.match(fly, /^\s*COSYWORLD_SHUTDOWN_DRAIN_MS = "3000"$/m);
  assert.match(fly, /^\s*COSYWORLD_MULTITENANT_SHUTDOWN_GRACE_SECS = "4"$/m);
  assert.match(dockerfile, /apt-get install[^\\\n]*ca-certificates curl gosu nginx/);
  assert.match(dockerfile, /COPY deploy\/lonelyforest \/app\/deploy\/lonelyforest/);
  assert.match(dockerfile, /COPY deploy\/entrypoint\.sh \/app\/entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/entrypoint\.sh"\]/);
  assert.match(dockerfile, /check-required-health\.sh/);
  assert.match(entrypoint, /chown -R cosyworld:cosyworld \/data/);
  assert.match(entrypoint, /exec gosu cosyworld/);
});

test("tenant manifest rejects path traversal and overlapping persistence identities", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-tenant-config-"));
  const valid = [
    "root|required|root.example|root|3100|/app/v2/content/root/registry.json|-|/data/root/snapshot.json|/data/root/events.sqlite|/data/root/generated|",
    "tenant|required|tenant.example|tenant_world|3101|/app/v2/content/tenant/registry.json|1|/data/tenant/snapshot.json|/data/tenant/events.sqlite|/data/tenant/generated|",
  ].join("\n");
  try {
    const cases = [
      [
        "registry traversal",
        valid.replace("/app/v2/content/tenant/registry.json", "/app/v2/content/tenant/../other/registry.json"),
        /registry must be a canonical path/,
      ],
      [
        "persistence normalization alias",
        valid.replace("/data/tenant/snapshot.json", "/data/tenant//snapshot.json"),
        /snapshot path must be a canonical path/,
      ],
      [
        "duplicate event database",
        valid.replace("/data/tenant/events.sqlite", "/data/root/events.sqlite"),
        /overlaps root event database path/,
      ],
      [
        "generated directory overlapping another tenant snapshot",
        valid.replace("/data/tenant/generated", "/data/root"),
        /overlaps root snapshot path/,
      ],
    ];
    for (const [name, source, expected] of cases) {
      const configPath = resolve(tempRoot, `${name.replaceAll(" ", "-")}.tsv`);
      await writeFile(configPath, source);
      assert.throws(() => readLonelyForestTenants(configPath), expected, name);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Lonely Forest deploy gate proves every configured tenant before image replacement", async () => {
  const hashes = await candidateHashes();
  const requests = [];
  const results = await verifyLonelyForestTenants({
    fetchImpl: async (url) => {
      requests.push(url);
      const host = new URL(url).host;
      return new Response(JSON.stringify({ worldpack: { bundle_hash: hashes.get(host) } }), { status: 200 });
    },
    log: () => {},
  });
  assert.deepEqual(requests, tenants.map((tenant) => `https://${tenant.hosts[0]}/meta`));
  assert.deepEqual(results.map((result) => result.tenant.slug), tenants.map((tenant) => tenant.slug));
  assert.ok(results.every((result) => result.ok));
});

test("a new tenant can bootstrap only while its live identity is absent", async () => {
  const hashes = await candidateHashes();
  const unavailableHoppycat = async (url) => {
    const host = new URL(url).host;
    if (host === "hoppycat.lonelyforest.com") throw new Error("not installed");
    return new Response(JSON.stringify({ worldpack: { bundle_hash: hashes.get(host) } }), { status: 200 });
  };
  const results = await verifyLonelyForestTenants({
    fetchImpl: unavailableHoppycat,
    freshEmptyTenants: new Set(["hoppycat"]),
    log: () => {},
  });
  assert.equal(results.find((result) => result.tenant.slug === "hoppycat")?.status, "fresh_install");

  await assert.rejects(
    verifyLonelyForestTenants({
      fetchImpl: async (url) => {
        const host = new URL(url).host;
        return new Response(JSON.stringify({ worldpack: { bundle_hash: hashes.get(host) } }), { status: 200 });
      },
      freshEmptyTenants: new Set(["hoppycat"]),
      log: () => {},
    }),
    /fresh install for hoppycat was supplied but live \/meta was available/,
  );
});

test("Lantern-style tenant mismatch blocks the release before Fly deployment", async () => {
  const hashes = await candidateHashes();
  const mismatch = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await assert.rejects(
    verifyLonelyForestTenants({
      fetchImpl: async (url) => {
        const host = new URL(url).host;
        return new Response(JSON.stringify({
          worldpack: { bundle_hash: host === "lantern.lonelyforest.com" ? mismatch : hashes.get(host) },
        }), { status: 200 });
      },
      log: () => {},
    }),
    (error) => error.message.includes("tenant=lantern")
      && error.message.includes(mismatch)
      && error.message.includes("candidate="),
  );
});

test("an unavailable tenant needs an explicit audited captured identity, never a skip", async () => {
  const hashes = await candidateHashes();
  const unavailableLantern = async (url) => {
    const host = new URL(url).host;
    if (host === "lantern.lonelyforest.com") throw new Error("connection refused");
    return new Response(JSON.stringify({ worldpack: { bundle_hash: hashes.get(host) } }), { status: 200 });
  };
  await assert.rejects(
    verifyLonelyForestTenants({ fetchImpl: unavailableLantern, log: () => {} }),
    /tenant=lantern.*Refusing to replace the image/,
  );

  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-lantern-capture-"));
  try {
    const capturePath = resolve(tempRoot, "lantern.json");
    await writeFile(capturePath, JSON.stringify({
      schema_version: 1,
      tenant: "lantern",
      source: "tenant-volume",
      captured_at: "2026-08-01T12:34:56Z",
      meta: { worldpack: { bundle_hash: hashes.get("lantern.lonelyforest.com") } },
    }));
    const captures = recoveryCapturesFromArgs(["--recovery-capture", `lantern=${capturePath}`], "/");
    const results = await verifyLonelyForestTenants({
      fetchImpl: unavailableLantern,
      recoveryCaptures: captures,
      log: () => {},
    });
    assert.equal(results.find((result) => result.tenant.slug === "lantern")?.identitySource.includes("recovery capture"), true);
    const cli = spawnSync(
      process.execPath,
      [resolve(scriptDir, "check-lonelyforest-worldpacks.mjs"), "--recovery-capture", `lantern=${capturePath}`],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    assert.match(`${cli.stdout}\n${cli.stderr}`, /reviewed file inside the committed checkout/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("required-tenant health monitor fails the Machine after startup grace when any required process is unready", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-required-health-"));
  try {
    const binDir = resolve(tempRoot, "bin");
    const curlLog = resolve(tempRoot, "curl.log");
    const fakeCurl = resolve(binDir, "curl");
    const tenantConfig = resolve(deploymentRoot, "tenants.tsv");
    await mkdir(binDir);
    await writeFile(fakeCurl, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$FAKE_CURL_LOG\"\ncase \"$*\" in *:3177*) exit 1 ;; *) exit 0 ;; esac\n");
    await chmod(fakeCurl, 0o755);
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(
        "sh",
        [resolve(deploymentRoot, "check-required-health.sh"), tenantConfig, "999999", "0", "1"],
        {
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_CURL_LOG: curlLog },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolveResult({ code, output }));
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /required tenant hoppycat failed private \/health/);
    const requests = await readFile(curlLog, "utf8");
    for (const port of ["3100", "3107", "3189", "3180", "3177"]) {
      assert.match(requests, new RegExp(`127\\.0\\.0\\.1:${port}/health`));
    }
    assert.doesNotMatch(requests, /127\.0\.0\.1:3101\/health/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a required tenant that misses one probe and recovers keeps every hostname up", async () => {
  // Root can hold the authoritative runtime lock for several seconds under
  // load, which starves its readiness endpoint while the world is alive and
  // serving. Tearing down every hostname on the first missed probe turned that
  // into a site-wide flap, so a miss inside the threshold must be survivable.
  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-required-health-transient-"));
  try {
    const binDir = resolve(tempRoot, "bin");
    const curlLog = resolve(tempRoot, "curl.log");
    const stateFile = resolve(tempRoot, "root-probe-count");
    const fakeCurl = resolve(binDir, "curl");
    const tenantConfig = resolve(deploymentRoot, "tenants.tsv");
    await mkdir(binDir);
    // Root fails its very first probe, then answers normally for good.
    await writeFile(
      fakeCurl,
      "#!/bin/sh\n"
        + "printf '%s\\n' \"$*\" >> \"$FAKE_CURL_LOG\"\n"
        + "case \"$*\" in\n"
        + "  *:3100*)\n"
        + "    if [ -f \"$FAKE_CURL_STATE\" ]; then exit 0; fi\n"
        + "    : > \"$FAKE_CURL_STATE\"\n"
        + "    exit 1\n"
        + "    ;;\n"
        + "  *) exit 0 ;;\n"
        + "esac\n",
    );
    await chmod(fakeCurl, 0o755);
    const child = spawn(
      "sh",
      [resolve(deploymentRoot, "check-required-health.sh"), tenantConfig, "999999", "0", "1"],
      {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_CURL_LOG: curlLog, FAKE_CURL_STATE: stateFile },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = new Promise((resolveResult) => child.once("close", (code) => resolveResult(code)));
    const settled = await Promise.race([
      exited,
      new Promise((resolveRace) => setTimeout(() => resolveRace("still-running"), 4_000)),
    ]);
    child.kill("SIGKILL");
    assert.equal(settled, "still-running", `monitor must survive one missed probe: ${output}`);
    assert.match(output, /required tenant root missed private \/health[\s\S]*?\(1\/3\)/);
    assert.doesNotMatch(output, /failing supervisor/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a required child crash exits the supervisor nonzero", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-supervisor-exit-"));
  try {
    const binDir = resolve(tempRoot, "bin");
    const registry = resolve(tempRoot, "registry.json");
    const tenantConfig = resolve(tempRoot, "tenants.tsv");
    const snapshot = resolve(tempRoot, "snapshot.json");
    const eventDb = resolve(tempRoot, "events.sqlite");
    const generated = resolve(tempRoot, "generated");
    await mkdir(binDir);
    await writeFile(registry, "{}");
    await writeFile(tenantConfig, `root|required|root.example|root|3100|${registry}|-|${snapshot}|${eventDb}|${generated}|\n`);
    const scripts = {
      chown: "#!/bin/sh\nexit 0\n",
      nginx: "#!/bin/sh\nif [ \"$1\" = \"-t\" ]; then exit 0; fi\nexec sleep 300\n",
      orchestrator: "#!/bin/sh\nexit 1\n",
      monitor: "#!/bin/sh\nexec sleep 300\n",
    };
    await Promise.all(Object.entries(scripts).map(async ([name, content]) => {
      const script = resolve(binDir, name);
      await writeFile(script, content);
      await chmod(script, 0o755);
    }));
    const startedAt = Date.now();
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn("sh", [resolve(deploymentRoot, "run-multitenant.sh")], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          COSYWORLD_ORCHESTRATOR_BINARY: resolve(binDir, "orchestrator"),
          COSYWORLD_MULTITENANT_TENANTS_CONFIG: tenantConfig,
          COSYWORLD_MULTITENANT_HEALTH_MONITOR: resolve(binDir, "monitor"),
          COSYWORLD_MULTITENANT_NGINX_CONFIG: resolve(tempRoot, "nginx.conf"),
          COSYWORLD_MULTITENANT_DATA_ROOT: resolve(tempRoot, "worldpacks"),
          COSYWORLD_MULTITENANT_HEALTH_STARTUP_GRACE_SECS: "60",
        },
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolveResult({ code }));
    });
    assert.equal(result.code, 1);
    assert.ok(
      Date.now() - startedAt < 3_000,
      "required child crash must fail the supervisor immediately",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("the supervisor forwards shutdown once and force-stops wedged children within budget", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "cosyworld-supervisor-shutdown-"));
  let child;
  try {
    const binDir = resolve(tempRoot, "bin");
    const registry = resolve(tempRoot, "registry.json");
    const tenantConfig = resolve(tempRoot, "tenants.tsv");
    const snapshot = resolve(tempRoot, "snapshot.json");
    const eventDb = resolve(tempRoot, "events.sqlite");
    const generated = resolve(tempRoot, "generated");
    const orchestratorPid = resolve(tempRoot, "orchestrator.pid");
    await mkdir(binDir);
    await writeFile(registry, "{}");
    await writeFile(tenantConfig, `root|required|root.example|root|3100|${registry}|-|${snapshot}|${eventDb}|${generated}|\n`);
    const scripts = {
      nginx: "#!/usr/bin/env node\nif (process.argv.includes('-t')) process.exit(0);\nfor (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {});\nconsole.log('fake nginx ready');\nsetInterval(() => {}, 1_000);\n",
      orchestrator: "#!/usr/bin/env node\nfor (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {});\nrequire('node:fs').writeFileSync(process.env.FAKE_ORCHESTRATOR_PID_FILE, String(process.pid) + '\\n');\nconsole.log('fake orchestrator ready');\nsetInterval(() => {}, 1_000);\n",
      monitor: "#!/bin/sh\nexec sleep 300\n",
    };
    await Promise.all(Object.entries(scripts).map(async ([name, content]) => {
      const script = resolve(binDir, name);
      await writeFile(script, content);
      await chmod(script, 0o755);
    }));

    let output = "";
    let markReady;
    const ready = new Promise((resolveReady) => { markReady = resolveReady; });
    child = spawn("sh", [resolve(deploymentRoot, "run-multitenant.sh")], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_ORCHESTRATOR_PID_FILE: orchestratorPid,
        COSYWORLD_ORCHESTRATOR_BINARY: resolve(binDir, "orchestrator"),
        COSYWORLD_MULTITENANT_TENANTS_CONFIG: tenantConfig,
        COSYWORLD_MULTITENANT_HEALTH_MONITOR: resolve(binDir, "monitor"),
        COSYWORLD_MULTITENANT_NGINX_CONFIG: resolve(tempRoot, "nginx.conf"),
        COSYWORLD_MULTITENANT_DATA_ROOT: resolve(tempRoot, "worldpacks"),
        COSYWORLD_MULTITENANT_HEALTH_STARTUP_GRACE_SECS: "60",
        COSYWORLD_MULTITENANT_SHUTDOWN_GRACE_SECS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk) => {
      output += chunk;
      if (
        output.includes("hostname router listening")
        && output.includes("fake nginx ready")
        && output.includes("fake orchestrator ready")
      ) markReady();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    let readyTimeout;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          readyTimeout = setTimeout(
            () => reject(new Error(`supervisor did not become ready: ${output}`)),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(readyTimeout);
    }

    const startedAt = Date.now();
    child.kill("SIGTERM");
    const repeatedSignal = setTimeout(() => child?.kill("SIGINT"), 50);
    let shutdownTimeout;
    let code;
    try {
      code = await Promise.race([
        new Promise((resolveExit, reject) => {
          child.once("error", reject);
          child.once("exit", resolveExit);
        }),
        new Promise((_, reject) => {
          shutdownTimeout = setTimeout(
            () => reject(new Error(`supervisor exceeded shutdown budget: ${output}`)),
            3_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(repeatedSignal);
      clearTimeout(shutdownTimeout);
    }
    assert.equal(code, 0, output);
    assert.ok(Date.now() - startedAt < 2_500, output);
    assert.match(output, /event=shutdown_started grace_secs=1/);
    assert.match(output, /event=tenant_shutdown_started tenant=root/);
    assert.match(output, /event=tenant_shutdown_forced tenant=root/);
    assert.match(output, /event=shutdown_forced reason=deadline/);
    assert.match(output, /event=shutdown_complete elapsed_secs=\d+ forced_process_count=[1-9]\d*/);

    const pid = Number.parseInt(await readFile(orchestratorPid, "utf8"), 10);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    child?.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
});
