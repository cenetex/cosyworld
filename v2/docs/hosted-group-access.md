# Rendezvous parties

Hosted guest access was retired by issue #682. Invites still let players meet
and keep a bounded social party, but party membership never grants access,
changes ownership, or affects world simulation.

## Player and API contract

`GET /invites/{invite_id}` includes `invite.rendezvous`. It reports whether the
invite's location still exists, the party expiry, guest limit, explanation, and
these explicit restrictions:

- `rendezvous_only`
- `no_access_grants`
- `no_ownership_transfer`

`POST /invites/{invite_id}/follow` moves the accepting avatar to the inviter's
current shared-world location and forms or joins the party when the canonical
location matches the invite. The returned `party` object contains opaque actor
references and a bounded expiry. It is social state only.

Party lifecycle endpoints require the actor session and canonical identity:

- `POST /parties/{party_id}/leave`
- `POST /parties/{party_id}/members/{guest_actor_id}/remove` (inviter only)
- `POST /parties/{party_id}/revoke` (inviter only)

All locations and movement remain public. The server does not derive a
movement decision from party membership, wallet ownership, a location card,
or an entitlement. Removing or revoking membership records no relocation
event and never moves an avatar.

## Runtime limits

| Environment variable | AWS variable | Default | Accepted range |
| --- | --- | ---: | ---: |
| `COSYWORLD_RENDEZVOUS_PARTY_MAX_GUESTS` | `rendezvous_party_max_guests` | 4 | 1–16 |
| `COSYWORLD_RENDEZVOUS_PARTY_MAX_ACTIVE_PER_GUEST` | `rendezvous_party_max_active_per_guest` | 4 | 1–16 |
| `COSYWORLD_RENDEZVOUS_PARTY_TTL_SECS` | `rendezvous_party_ttl_seconds` | 7200 | 300–86400 |

There is no access-grace or evacuation setting because parties no longer
authorize entry.

## Historical audit data

Existing `canonical_hosted_access_entries` and
`canonical_hosted_access_events` tables remain readable so old deployments can
be inspected. Existing `hosted_access_grant` journal fields also remain
deserializable. New runtime actions do not create, reconcile, close, broadcast,
or otherwise act on those records.

The party tables keep their historical SQL names to avoid a database rewrite.
That storage compatibility does not restore the retired access behavior.
