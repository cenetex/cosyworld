const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DURATION_PATTERN = /^[1-9][0-9]*(?:s|m|h|d|w)$/;

const requireIdentifier = (value, label) => {
  if (!value || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, ".", "_", or "-"`);
  }
  return value;
};

export const buildOomQuery = (app, window = '30m') => {
  requireIdentifier(app, 'app');
  if (!DURATION_PATTERN.test(window)) {
    throw new Error('window must be a positive Prometheus duration such as 30m or 2h');
  }
  return (
    `max(max_over_time(fly_instance_exit_oom{app="${app}"}[${window}]))`
    + ` or (0 * max(fly_instance_up{app="${app}"}))`
  );
};

export const flyAuthorization = (token) => {
  const trimmed = token?.trim();
  if (!trimmed) {
    throw new Error('FLY_METRICS_READ_TOKEN is required');
  }
  return trimmed.startsWith('FlyV1 ') ? trimmed : `FlyV1 ${trimmed}`;
};

export const parseOomMetric = (payload) => {
  if (payload?.status !== 'success') {
    const detail = [payload?.errorType, payload?.error].filter(Boolean).join(': ');
    throw new Error(`Fly metrics query failed${detail ? `: ${detail}` : ''}`);
  }
  const result = payload?.data?.result;
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('Fly metrics query returned no OOM series');
  }
  const values = result.map((series) => Number(series?.value?.[1]));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Fly metrics query returned a nonnumeric OOM value');
  }
  return Math.max(...values);
};

export const checkFlyOom = async ({
  org,
  app,
  window = '30m',
  token,
  fetchImpl = fetch,
}) => {
  requireIdentifier(org, 'organization');
  const query = buildOomQuery(app, window);
  const url = new URL(
    `https://api.fly.io/prometheus/${encodeURIComponent(org)}/api/v1/query`
  );
  url.searchParams.set('query', query);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Authorization: flyAuthorization(token),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Fly metrics request failed: ${error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Fly metrics request returned HTTP ${response.status}`);
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('Fly metrics request returned invalid JSON');
  }
  return { app, maxOom: parseOomMetric(payload), query, window };
};

const main = async () => {
  const [org, app, window = '30m', ...extra] = process.argv.slice(2);
  if (!org || !app || extra.length > 0) {
    throw new Error('usage: check-fly-oom.mjs <organization> <app> [window]');
  }
  const result = await checkFlyOom({
    org,
    app,
    window,
    token: process.env.FLY_METRICS_READ_TOKEN,
  });
  if (result.maxOom > 0) {
    console.error(
      `::error title=Fly OOM detected::${result.app} recorded an OOM exit in the last ${result.window}`
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `${result.app}: no OOM exits in the last ${result.window} (metric=${result.maxOom})`
  );
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(`::error title=Fly OOM check failed::${error.message}`);
    process.exitCode = 1;
  });
}
