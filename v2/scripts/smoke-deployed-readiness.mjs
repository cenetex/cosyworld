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
  assert(typeof meta.deployment?.process_id === "string" && meta.deployment.process_id.length > 0, `${baseUrl.origin} has no process id`);
  assert(meta.primary_game === "card-table", `${baseUrl.origin} is not serving the card table`);
  assert(
    typeof meta.card_game?.shared_rules_version === "string" && meta.card_game.shared_rules_version.length > 0,
    `${baseUrl.origin} reports no shared card rules version`,
  );
  assert(meta.persistence?.event_store_enabled === true, `${baseUrl.origin} event-store persistence is disabled`);
  assert(meta.persistence?.event_store?.status === "healthy", `${baseUrl.origin} persistence is ${meta.persistence?.event_store?.status ?? "unobservable"}`);
  assert(meta.persistence?.event_store?.consecutive_append_failures === 0, `${baseUrl.origin} has consecutive event-store append failures`);
  assert(meta.persistence?.event_store?.consecutive_read_failures === 0, `${baseUrl.origin} has consecutive event-store read failures`);
  assert(meta.persistence?.event_store?.pending_event_count === 0, `${baseUrl.origin} has pending event-store writes`);
  // The card-only server (#1652) has no classic world, worldpack, snapshot or
  // linked-avatar adapter, so none of them is reported or checked.
  for (const classic of ["worldpack", "world", "linked_avatar_adapter"]) {
    assert(meta[classic] === undefined, `${baseUrl.origin} still reports classic ${classic} state`);
  }

  return {
    url: baseUrl.origin,
    profile: meta.deployment.profile,
    process_id: meta.deployment.process_id,
    shared_rules_version: meta.card_game.shared_rules_version,
  };
}

const reports = [];
for (const target of targets) reports.push(await inspectTarget(target));
console.log(JSON.stringify({ ok: true, targets: reports }, null, 2));
