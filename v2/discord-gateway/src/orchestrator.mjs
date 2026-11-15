const TIMEOUT_MS = 30000;

function headers(token) {
  return { authorization: `Bearer ${token}` };
}

export async function fetchCast(fetch, origin, token, pack) {
  try {
    const response = await fetch(`${origin}/discord/cast?pack=${encodeURIComponent(pack)}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) return null;
    const body = await response.json();
    const residents = (Array.isArray(body?.residents) ? body.residents : []).filter(
      (resident) => typeof resident?.id === "string" && typeof resident?.name === "string",
    );
    return residents.length
      ? residents.map(({ id, name, portrait, avatar }) => ({
          id,
          name,
          portrait: portrait ?? null,
          avatar: avatar ?? null,
        }))
      : null;
  } catch {
    return null;
  }
}

export async function channelLines(fetch, origin, token, body, signal) {
  try {
    const response = await fetch(`${origin}/discord/lines`, {
      method: "POST",
      headers: { ...headers(token), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) return { lines: [], reason: `http-${response.status}` };
    const parsed = await response.json();
    const lines = (Array.isArray(parsed?.lines) ? parsed.lines : []).filter(
      (line) => typeof line?.id === "string" && typeof line?.text === "string" && line.text,
    );
    if (lines.length) return { lines, reason: null };
    const reason = typeof parsed?.reason === "string" && parsed.reason ? parsed.reason : "empty";
    return { lines, reason };
  } catch (error) {
    return { lines: [], reason: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "error" };
  }
}
