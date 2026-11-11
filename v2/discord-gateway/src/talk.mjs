// Talk routing: turn a Discord message into a `/talk` call and the resident
// lines back into webhook-ready identities. Everything here is injectable and
// tested without Discord or a network.

export function resolveTarget(content, residents) {
  const lowered = (content || "").toLowerCase();
  for (const resident of residents) {
    const name = (resident.name || "").toLowerCase();
    if (name && lowered.includes(name)) return resident.id;
  }
  return null;
}

export function buildTalkRequest({ worldId, avatarId, target, text }) {
  const body = { target };
  if (avatarId) body.avatar = avatarId;
  if (text) body.text = text;
  return { url: `/card-game/shared/worlds/${worldId}/talk`, body };
}

export function residentLines(body) {
  const lines =
    body?.lines ??
    body?.speech?.lines ??
    body?.state?.lines ??
    (body?.events || []).find((e) => e?.op === "speech" || e?.kind === "speech")?.lines ??
    [];
  return lines
    .map((line) => ({ id: line?.actorId ?? line?.entityId ?? line?.id, text: line?.text ?? "" }))
    .filter((line) => line.id && line.text);
}

export async function resolveWorld(fetch, origin, { token, discordUserId }) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (discordUserId) headers["x-cosyworld-discord-user"] = discordUserId;
  const response = await fetch(`${origin}/card-game/shared/worlds`, { headers });
  if (!response.ok) throw new Error(`worlds failed: ${response.status}`);
  const body = await response.json();
  const worlds = Array.isArray(body?.worlds) ? body.worlds : [];
  const first = worlds[0];
  if (!first?.id) return null;
  return { worldId: first.id, avatarId: first.actor ?? first.bound ?? null };
}

export async function talkTo(fetch, origin, { worldId, avatarId, target, text, token, discordUserId }) {
  const { url, body } = buildTalkRequest({ worldId, avatarId, target, text });
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (discordUserId) headers["x-cosyworld-discord-user"] = discordUserId;
  const response = await fetch(`${origin}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`talk failed: ${response.status}`);
  }
  return residentLines(await response.json());
}
