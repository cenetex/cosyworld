# Hosted group access

Hosted access keeps a public-room party together when one active member owns a
compatible location entitlement. It is a temporary server decision, never an
ownership grant.

## Player and API contract

`GET /invites/{invite_id}` includes `invite.hosted_access` before acceptance.
It states whether the public-room invite is eligible, the party/session/location
scope, expiry and grace times, guest limit, explanation, and restrictions.
`POST /invites/{invite_id}/follow` forms or joins the party only when inviter
and guest rendezvous at the invite's original ungated room. Its `party` object
contains opaque canonical actor references and the bounded expiry.

The host enters a gated room with ordinary provider-backed access. A guest
then uses the ordinary movement endpoint. The server derives party membership,
host presence, location, and the host's current provider receipt; the client
cannot submit a party id or shared token to authorize movement. A successful
move reports `access.mode: hosted_guest`, the host and party references, expiry,
and restrictions. Directly entitled players report `solo_entitled`; rejected
moves report `denied` with a stable public explanation.

Party lifecycle endpoints require the actor session and canonical identity:

- `POST /parties/{party_id}/leave`
- `POST /parties/{party_id}/members/{guest_actor_id}/remove` (host only)
- `POST /parties/{party_id}/revoke` (host only)

## Server-enforced restrictions

A sponsored guest receives no card, entitlement, claim, transferable token, or
post-session ownership. While the guest remains in a gated room without direct
entitlement, the canonical journal rejects gated item pickup/use/give/drop,
trading, crafting, search/collectible discovery, reward-producing combat, job
or pathway progress, visit-ledger rewards, advancement, and bond progress.
Speech, presence, and movement back to public space remain available. Wallet
mint, burn, and claim routes still require their own signed wallet ownership;
hosted party state is not an input to those routes.

Production startup already requires an authenticated remote entitlement
provider. Runtime verification fails closed when the host identity, activity,
co-presence, canonical store, or current provider grant is absent. The last
good provider snapshot remains the service's ordinary entitlement boundary;
revocation in a successful refresh triggers reconciliation.

## Expiry, grace, and evacuation

Active hosted entries are reconciled after movement, party mutation, presence
loss, and ownership refresh, plus every 15 seconds. Party expiry, host
departure/disconnect, removal, revocation, missing identity, missing gated
location, or lost entitlement starts the configured grace. At grace expiry the
guest is moved through the canonical journal to the public room where the party
formed. If that room is unavailable, the ungated Cosy Cottage is the fallback.
Leaving the gated room or gaining direct entitlement ends the hosted entry
without recording a false evacuation.

The runtime limits are storefront-neutral:

| Environment variable | AWS variable | Default | Accepted range |
| --- | --- | ---: | ---: |
| `COSYWORLD_HOSTED_PARTY_MAX_GUESTS` | `hosted_party_max_guests` | 4 | 1–16 |
| `COSYWORLD_HOSTED_PARTY_MAX_ACTIVE_PER_GUEST` | `hosted_party_max_active_per_guest` | 4 | 1–16 |
| `COSYWORLD_HOSTED_ACCESS_TTL_SECS` | `hosted_access_ttl_seconds` | 7200 | 300–86400 |
| `COSYWORLD_HOSTED_ACCESS_GRACE_SECS` | `hosted_access_grace_seconds` | 60 | 0–300 |

## Telemetry and privacy

`canonical_hosted_access_events` schema version 1 records world epoch, time,
opaque actor, party and location references, required grant id, access mode, outcome, and a
stable reason code. It distinguishes `solo_entitled`, `hosted_guest`, and
`denied`, plus `allowed`, `failed`, `ended`, and `evacuated` outcomes. It does
not record invite copy, speech, chat, account profile fields, or other private
social content.

## Free-progression invariant

Hosted access is additive. It is not required by any authored recipe,
evolution, or pact contribution. `npm run check:worldpack` validates entitlement
references and reachable content. `npm run check:proof-world` additionally
proves the pact home is ungated, joining needs no entitlement, critical recipe
and evolution inputs are renewable, care loops are repeatable, and the seven
scripted visits begin and end in public sanctuary space. These checks remain
release gates even though this feature does not change worldpack content.

## Rollout and rollback

Roll out with the default limits and watch denial, hosted-entry, and evacuation
reason counts. A spike in `hosted_verification_error` or
`canonical_store_unavailable` is an operational failure, not a reason to grant
access. Before rolling back to a build without hosted access, stop new invites,
revoke active parties, set grace to zero for the drain deployment, and wait for
all active entries to become `ended` or `evacuated`. The tables are additive
and may remain in SQLite after rollback.
