````markdown
# Guild Settings

## Overview
The Guild Settings UI lets administrators configure per-guild behavior for avatars and tools via the web dashboard. Settings are stored in the guild config and consumed by services such as Chat and Avatar services.

## Key Features
- Admin toggle for features (combat, breeding, item creation)
- Tool emoji customization (summon, breed, attack, defend, etc.)
- Rate limiting
- Prompt templates
- Avatar tribe restrictions (channel overrides)

## Avatar Tribe Restrictions
Controls which avatar tribes (by emoji) are allowed per guild/channel.

- `mode: "permit"` — Permit all except listed emojis (blocklist)
- `mode: "forbid"` — Forbid all except listed emojis (allowlist)

Data shape:
```json
{
  "avatarTribeRestrictions": {
    "default": { "mode": "permit", "emojis": ["😈", "🧟"] },
    "channels": {
      "123456789012345678": { "mode": "forbid", "emojis": ["🦄", "🦊"] }
    }
  }
}
```

Resolution order:
1) Channel override if present
2) Otherwise fall back to default

Application (AvatarService.getAvatarsInChannel):
- Filters out avatars that are dead or inactive
- Applies the restriction mode and emojis per above

## Detected Guilds
The dashboard can display detected but unauthorized guilds. Clicking Authorize creates or updates the guild configuration with sensible defaults, then clears relevant caches.

## API Endpoints
- `GET /api/guilds` — List configs
- `POST /api/guilds` — Create new config
- `GET /api/guilds/:id` — Get config
- `POST /api/guilds/:id` — Update config
- `DELETE /api/guilds/:id` — Delete config
- `GET /api/guilds/detected` — List detected guilds
- `POST /api/guilds/:id/clear-cache` — Clear guild cache
- `POST /api/guilds/:id/authorize` — Mark guild authorized and clear caches

## Frontend Module
See `src/services/web/public/js/guild-settings.js` for implementation details of:
- Loading/storing configs
- Authorizing detected guilds
- Building UI for tribe restrictions (default + per-channel)

### Authorizing a New Server
There are two ways to authorize a server after inviting the bot:

1) From the Admin Dashboard: visit `/admin/guild-settings`, open the Detected Guilds section, and click "Authorize" on the new server. This creates or updates the guild config with `authorized: true` and clears caches so the bot starts responding immediately.

2) Via API: send a POST request to `/api/guilds/<GUILD_ID>/authorize`. Example:

```
curl -X POST http://localhost:3100/api/guilds/123456789012345678/authorize
```

If you create a guild with the `POST /api/guilds` endpoint and include `authorized: true`, that will now be honored on creation (even when cloning from a template).

## Notes
- UI uses Discord CDN for guild icon preview
- Non-critical failures (e.g., cache clear) are surfaced as warnings
- Inputs are trimmed and validated client-side

_Last updated: August 2025_
````
