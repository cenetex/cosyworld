# Reset account without replacing the passkey

## Revision foundation

The account ID remains the passkey identity and the quota/admission owner.
`GET /auth/account` reports `account_revision` (zero initially, null signed out).
This first change exposes that revision and tested guard helpers only. It does
not offer Reset account or change any game or maker data. Mutation routes must
be wired before a reset route is enabled.

A page captures `user_id` and `account_revision` when it signs in. Mutations send
`X-Account-User` and `X-Account-Revision`. A page must not silently replace its
captured revision with one discovered in the background and upload old data.
A legacy request without either header is accepted only at revision zero.

`Revision::capture` receives the server-authenticated user, never trusts the
header as authentication, and captures one immutable admission token. Each write
must call `check` after `BEGIN IMMEDIATE`, inside the transaction that writes.
An HTTP-only check before waiting for the transaction is insufficient. Async
maker jobs must carry the same token through their final private file commit.

Stale or missing identity/revision returns HTTP 409 with `ok: false`, code
`account_reset`, and error `Your account changed. Reload before continuing.`
Duplicate or malformed headers return HTTP 400, code `invalid_account_revision`,
and error `Send one account revision and account user.` Both are `no-store`.

## Planned reset boundary

The reset must atomically advance the revision with canonical seat release and
own-data cleanup, preserving passkeys, sessions, shared history, other players,
and financial/provider records. It must not change the quota owner. Active
shared plays or maker jobs should refuse reset without partial changes; job
admission must also check its captured revision inside its write transaction.
The eventual endpoint needs a persistent idempotency receipt, including retry
after a lost response, and recoverable private-file cleanup. These operations
are deliberately not part of the revision foundation.

## Shared mutation integration

Shared world creation, commands and browser-supplied dialogue now capture the
revision at admission. Creation and commands check it inside their write
transaction; dialogue workers carry it to the final publication transaction.
Maker guards and the reset operation are still required before enabling reset.

## Maker mutation integration

Pack writes, private file commits and job admission/settlement check the captured
revision inside `BEGIN IMMEDIATE`. Paid jobs retain that token when the request
ends. Admission and quotas still use the stable user ID. Direct generation
routes return data only; browsers must discard their late results after reset.
