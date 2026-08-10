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
  assert(meta.persistence?.snapshot_enabled === true, `${baseUrl.origin} snapshot persistence is disabled`);
  assert(meta.persistence?.event_store_enabled === true, `${baseUrl.origin} event-store persistence is disabled`);
  assert(meta.persistence?.event_store?.status === "healthy", `${baseUrl.origin} persistence is ${meta.persistence?.event_store?.status ?? "unobservable"}`);
  assert(meta.persistence?.event_store?.consecutive_append_failures === 0, `${baseUrl.origin} has consecutive event-store append failures`);
  assert(meta.persistence?.event_store?.consecutive_read_failures === 0, `${baseUrl.origin} has consecutive event-store read failures`);
  assert(meta.persistence?.event_store?.pending_event_count === 0, `${baseUrl.origin} has pending event-store writes`);
  assert(meta.features?.card_policy_mode === "shadow", `${baseUrl.origin} card policy is not in shadow mode`);
  assert(meta.features?.card_policy_top_k === 3, `${baseUrl.origin} card policy top-k is not 3`);
  assert(
    meta.features?.card_policy_model_hash === "1e1002a4907456f2",
    `${baseUrl.origin} has the wrong card-policy model`,
  );
  assert(meta.linked_avatar_adapter?.remote_configured === true, `${baseUrl.origin} has no remote linked-avatar feed`);
  assert(meta.linked_avatar_adapter?.bearer_configured === true, `${baseUrl.origin} has no linked-avatar feed bearer`);
  assert(
    Number.isInteger(meta.linked_avatar_adapter?.timeout_secs)
      && meta.linked_avatar_adapter.timeout_secs >= 1
      && meta.linked_avatar_adapter.timeout_secs <= 60,
    `${baseUrl.origin} has no bounded linked-avatar feed timeout`,
  );
  assert(
    meta.linked_avatar_adapter?.status === "healthy",
    `${baseUrl.origin} linked-avatar feed is ${meta.linked_avatar_adapter?.status ?? "unobservable"}`
      + ` (failures=${meta.linked_avatar_adapter?.consecutive_failures ?? "unknown"},`
      + ` error=${meta.linked_avatar_adapter?.last_error_code ?? "unknown"})`,
  );
  assert(
    Number.isInteger(meta.linked_avatar_adapter?.last_success_at_unix),
    `${baseUrl.origin} has no recorded successful linked-avatar feed fetch`,
  );

  return {
    url: baseUrl.origin,
    profile: meta.deployment.profile,
    card_policy_mode: meta.features.card_policy_mode,
    card_policy_top_k: meta.features.card_policy_top_k,
    card_policy_model_hash: meta.features.card_policy_model_hash,
    linked_avatar_adapter_status: meta.linked_avatar_adapter.status,
    wallet_count: meta.linked_avatar_adapter.wallet_count,
    last_success_at_unix: meta.linked_avatar_adapter.last_success_at_unix,
    consecutive_failures: meta.linked_avatar_adapter.consecutive_failures,
  };
}

const reports = [];
for (const target of targets) reports.push(await inspectTarget(target));
console.log(JSON.stringify({ ok: true, targets: reports }, null, 2));
