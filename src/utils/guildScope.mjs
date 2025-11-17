export function normalizeGuildId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export function buildCollectionConfigScopeQuery(guildId, {
  includeGlobal = true,
  matchAllWhenMissing = false,
} = {}) {
  const normalized = normalizeGuildId(guildId);
  if (!normalized) {
    if (matchAllWhenMissing) {
      return {};
    }
    if (!includeGlobal) {
      return { guildId: null };
    }
    return {
      $or: [
        { guildId: null },
        { guildId: { $exists: false } },
      ],
    };
  }

  const clauses = [
    { guildId: normalized },
    { guilds: normalized },
  ];

  if (includeGlobal) {
    clauses.push({ guildId: null }, { guildId: { $exists: false } });
  }

  return { $or: clauses };
}

export function buildAvatarGuildMatch(guildId) {
  const normalized = normalizeGuildId(guildId);
  if (!normalized) {
    return {
      $or: [
        { guildId: null },
        { guildId: { $exists: false } },
      ],
    };
  }

  return {
    $or: [
      { guildId: normalized },
      { guildId: { $exists: false } },
    ],
  };
}
