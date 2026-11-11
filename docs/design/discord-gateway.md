# Discord gateway

Status: design proposed (2026-11-11). Nothing built. Owner decisions below
await sign-off. **The companion bot is conversation-only** (2026-11-11): it
answers as the residents; it does not play the game. Companion and home modes
share one gateway; the official bot runs companion mode by default and home
mode on our own server.

## The security law

No customer credentials, ever. Competitors died by custodying other people's
Discord keys (Shapes Inc was removed for this pattern). CosyWorld has exactly
two modes, and the middle mode — where we hold a customer's bot token or a
pasted webhook URL — does not exist in the design, cannot be added by users,
and is not a roadmap item.

| Mode | Who holds credentials | Discord relationship |
| --- | --- | --- |
| Official companion bot | Only our own app's credentials, on our servers. Users invite via OAuth consent; the bot creates and manages **its own webhooks** in assigned channels. | One verified multi-tenant app. |
| Self-hosted gateway | The operator's own application and token, beside their own orchestrator. | Their bot, their world. |

A user asking "can I paste my bot key into your site?" gets a page that says
no, explains why, and links both legitimate paths.

## Owner decisions (signed off 2026-11-11)

All seven approved with their recommendations.

1. **Scope:** ship SSO, the companion bot's Talk, the pulse/poem, and home
   mode; the bot does **not** play the game. Playing inside Discord would be a
   separate embedded Activity running the web card table, not this bot.
   (Recommend: yes.)
2. **OAuth scope:** `identify` only — no `guilds`, no email. (Recommend: yes;
   matches the privacy page's minimum-identity posture.)
3. **One Discord identity per account, one account per Discord identity.**
   (Recommend: yes; `/unlink` breaks it.)
4. **Bind permission:** `/cosyworld bind` requires Manage Server or Manage
   Channels. (Recommend: Manage Server for the first bind, Manage Channels
   after; the bound channel is explicit state.)
5. **Anonymous play:** unlinked users in a Room-mode channel speak to the
   residents as an anonymous traveler whose acts are journaled but unowned.
   (Recommend: yes — this is the growth path; ownership arrives on link.)
6. **Surface field:** journaled acts record `surface: browser | discord` so
   the corpus can separate the habitats. (Recommend: yes.)
7. **No DMs, no pings, no @mentions, ever.** (Recommend: yes — the ecosystem
   law; the world never asks for attention.)

## Identity: Discord SSO

- "Continue with Discord" on the hosted site extends the existing passkey
  auth. OAuth2 code flow, `identify` scope, state nonce, PKCE where the
  client supports it.
- The callback exchanges the code for a Discord token, reads the user's id,
  finds or creates an account linked to that id, then calls the existing
  `AccountAuth::issue_session` and sets the session cookie — the Discord id
  never becomes a second session mechanism, only an account link.
- Stored: `discord_links (discord_user_id UNIQUE, account_id UNIQUE,
  username, avatar_url, linked_at)`. No guild membership is read or stored.
- `/link` in Discord: the gateway issues a one-time code that opens the game's
  authorize URL with the code as state; the callback completes the link. The
  browser path and the Discord path share the same callback.

## Architecture

The gateway is a client, exactly like the browser. It never embeds the
engine, never calls a model, and never holds state that is not a view.

- **`v2/discord-gateway/`** — a small Node service (discord.js v14), managed
  beside the orchestrator, configured from env (`DISCORD_TOKEN`,
  `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `ORCHESTRATOR_URL`).
- It speaks only the orchestrator's HTTP API and adds nothing to it that a
  browser could not also call:
  - `/meta` — version and mounted-pack list (channel bootstrap, asset pinning).
  - `/card-game/shared/worlds/{id}/command` and `.../browser-chat` — plays and
    human speech; the shared service already voices resident replies through
    `full_speech::generate` → `shared_lines`.
  - `/card-game/shared/worlds/{id}/talk` — the client-agnostic Talk endpoint
    (below), which wraps the browser's three-step flow into one call.

## Talk path

The browser's Talk is three HTTP steps: submit the `talk` play
(`command` with `op:"play"`, `action:{kind:"talk",target}`), submit the
human's own line through `browser-chat`, then read the residents' voiced lines
from the journaled `speech` op via `view`. No new narrative code is needed —
`shared_lines` already turns a journaled scene into voices.

The Discord gateway needs none of that encoding or polling. The refactor is a
single endpoint that owns it server-side:

`POST /card-game/shared/worlds/{id}/talk` — body `{avatar?, target, text?}`.

1. Resolve the account (bot token or session) and the claimed avatar.
2. Build and enqueue the `talk` play with a server-generated key.
3. If `text` is present, publish it through the `browser::chat` validation
   path so the human's own words are checked as a hosted line.
4. Trigger and await the voice worker, then return the residents' lines.

The await-the-worker half landed in Phase 1c as a synchronous endpoint:
`kick`'s loop was extracted into a reusable `voice_once`, and `/talk` now
commits the play, awaits one voice pass inline, and returns the view with the
resident lines — the owner chose synchronous-over-poll (2026-11-11), with the
model call's internal timeout as the bound. The human's `text` line (step 3)
still follows in a later slice.

## Anonymous Talk (owner rule, 2026-11-11)

A Talk from Discord is a real Talk in a real world: journaled with
`surface: "discord"`, part of the corpus, and — for a **linked** account — it
changes trust like any Talk. An **unlinked** user's chat is the anonymous
traveler: it is journaled as **unowned**, raises no trust, unlocks nothing,
takes no quest, and is never credited to a later link.

This is a server rule, not a gateway rule. The mechanism:

- Every play carries a `surface` (`browser` | `discord`) into the journal, so
  the corpus can separate the surfaces.
- An unlinked Discord snowflake resolves to an **anonymous traveler** — a
  visitor that voices a scene without a `card_members`/`card_bindings` row. The
  play record's `user` is a sentinel (`anonymous:<snowflake>`), never an
  account id, so nothing on a real account moves.
- Trust, quests, unlocks and claims all key off the avatar binding; an
  unowned visitor has none, so the four "no change" guarantees fall out of the
  binding model rather than out of special cases.
- Linking later never credits the sentinel, so earlier anonymous chat is not
  retroactively owned.

Four tests:

1. A linked Talk moves trust.
2. An unlinked Talk does not.
3. An unlinked Talk is journaled with `surface: "discord"` and no account.
4. Linking afterwards does not credit earlier anonymous chat.

The open engine question: today the shared world refuses a play from an
unclaimed avatar ("Claim an avatar first"). The anonymous traveler needs the
engine to allow a **visitor** that is present without claiming a seat — or a
reserved, never-claimable visitor avatar per world. That is the one
design decision to confirm before the four tests can pass.

- New orchestrator endpoints (thin, read/write of links and bindings):
  - `POST /auth/discord/start` — returns the authorize URL + state.
  - `POST /auth/discord/callback` — exchanges the code, links or creates the
    account, sets the session cookie, returns the redirect target.
  - `POST /auth/discord/unlink` — breaks the link (requires a session).
  - `GET/PUT/DELETE /discord/bindings` — per-channel binding state
    (`guild_id, channel_id, mode, pack, world_ref, budget`), authenticated by
    a bot service token, not a user session.
- **Persistence** lives in the accounts SQLite (the same store as
  `AccountAuth`): `discord_links`, `discord_bindings`. Gateway-side state is
  cache only; the store is authoritative.

## The user journey

1. **Discover** — the game site's "Bring your world to Discord" page, later
   the App Directory. The page's job is trust: a plain-words permission sheet
   (read bound channels, send messages, manage its own webhooks — nothing
   else, no admin, no DMs).
2. **Add** — standard OAuth invite; Discord renders the consent.
3. **Bind** — `/cosyworld setup` in the target channel: mode picker (Room /
   Your world / Quiet), pack picker (forest default), poem-at-dusk default.
   Defaults good enough to need no configuration.
4. **Link** — `/link` → button → OAuth → done.
5. **Talk** — users type to the residents; they answer through per-message
   webhook identity (the founding `sendAsWebhook` pattern). A Talk is a real
   committed act, journaled like a card play. Playing the game itself (cards,
   movement, quests) is not part of this bot — that would be a separate
   embedded Activity running the web card table.
6. **Trust** — `/cosyworld privacy` posts the posture card: no message logging
   beyond committed acts, no tokens held, no pings, the world never begs.
   Kick the bot and Discord removes its webhooks — no residue.

## Rendering

- One webhook per channel; each resident message posts with per-message
  `username` and `avatarURL` overrides pointing at the pack's served portrait
  assets — so the Discord face and the card face are the same bytes under the
  same `/meta.card_game.assets_sha256` contract.
- Every webhook send sets `allowedMentions: { parse: [] }`, so a resident line
  can never ping anyone.

## Safety and compliance

- Per-user and per-guild token buckets; one resident speaks per beat; the
  voice gate and model pool stay server-side so a Discord flood never reaches
  a provider unthrottled.
- The world pulse (rhapsode at dusk, world-life beats) fires only when humans
  are actually present in the bound channel — Elysium's law, doubled as cost
  control.
- Anonymous daily metrics only, same as the browser. No DMs, no pings. The
  anti-dark-pattern list is the app-review narrative: this bot cannot nag,
  streak, or decay.

## Data surface

The same human plays on two surfaces, one avatar, one journal. Acts record a
`surface` field so the corpus can measure cross-surface continuity — the
densest long-horizon signal the instrument produces. Discord is the ecosystem's
highest-frequency habitat; the poem channel is its public save.

## Phases (each within the change budget)

- **Phase 0 — SSO and links:** OAuth endpoints, `discord_links` table,
  `/unlink`, tests. No bot yet.
- **Phase 1 — companion bot:** invite handling, `/cosyworld setup` and bind,
  Room mode, webhook identity, Talk through the shared `/talk` endpoint. Users
  can talk to Pip in their own servers.
- **Phase 2 — pulse and poem:** dusk verses, world-life beats, presence
  gating, Quiet mode.
- **Phase 3 — home mode and self-host docs:** the home transfer on our guild,
  the self-host guide, the no-keys-ever trust page.
