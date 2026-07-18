const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://cosyworld.fly.dev", "https://lonelyforest.com"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.text();
  assert(response.ok, `${url} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
}

async function inspectTarget(value) {
  const baseUrl = new URL(value);
  const healthUrl = new URL("/health", baseUrl);
  const metaUrl = new URL("/meta", baseUrl);
  const [health, meta] = await Promise.all([json(healthUrl), json(metaUrl)]);

  assert(health.ok === true, `${baseUrl.origin} health is not ok`);
  assert(meta.ok === true, `${baseUrl.origin} meta is not ok`);
  assert(meta.deployment?.profile === "production", `${baseUrl.origin} is not in production mode`);
  assert(meta.deployment?.world_id === "world://cosyworld/official", `${baseUrl.origin} has the wrong canonical world id`);
  assert(meta.deployment?.world_epoch === 1, `${baseUrl.origin} has the wrong canonical world epoch`);
  assert(typeof meta.deployment?.process_id === "string" && meta.deployment.process_id.length > 0, `${baseUrl.origin} has no process id`);
  assert(meta.deployment?.shard_id === meta.deployment?.process_id, `${baseUrl.origin} shard alias differs from process id`);
  assert(meta.ownership_feed?.remote_configured === true, `${baseUrl.origin} has no remote Ruby High feed`);
  assert(meta.ownership_feed?.bearer_configured === true, `${baseUrl.origin} has no Ruby High feed bearer`);
  assert(
    Number.isInteger(meta.ownership_feed?.timeout_secs)
      && meta.ownership_feed.timeout_secs >= 1
      && meta.ownership_feed.timeout_secs <= 60,
    `${baseUrl.origin} has no bounded Ruby High feed timeout`,
  );
  assert(
    meta.ownership_feed?.status === "healthy",
    `${baseUrl.origin} Ruby High feed is ${meta.ownership_feed?.status ?? "unobservable"}`
      + ` (failures=${meta.ownership_feed?.consecutive_failures ?? "unknown"},`
      + ` error=${meta.ownership_feed?.last_error_code ?? "unknown"})`,
  );
  assert(
    Number.isInteger(meta.ownership_feed?.last_success_at_unix),
    `${baseUrl.origin} has no recorded successful Ruby High feed fetch`,
  );

  return {
    url: baseUrl.origin,
    profile: meta.deployment.profile,
    ownership_feed_status: meta.ownership_feed.status,
    wallet_count: meta.ownership_feed.wallet_count,
    last_success_at_unix: meta.ownership_feed.last_success_at_unix,
    consecutive_failures: meta.ownership_feed.consecutive_failures,
  };
}

const reports = [];
for (const target of targets) reports.push(await inspectTarget(target));
console.log(JSON.stringify({ ok: true, targets: reports }, null, 2));
