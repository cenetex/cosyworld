// Per-message webhook identity, inherited from the founding `sendAsWebhook`
// pattern: one webhook per channel, the resident's name and portrait per message.

export function avatarUrl(assetBase, portraitPath) {
  if (!portraitPath) return null;
  return `${assetBase.replace(/\/+$/, "")}/${portraitPath.replace(/^\/+/, "")}`;
}

export function residentIdentity(resident, assetBase) {
  const name = (resident.name ?? resident.id ?? "resident")
    .slice(0, 80)
    .replace(/discord/gi, "");
  return { username: name, avatarUrl: avatarUrl(assetBase, resident.portraitPath) };
}
