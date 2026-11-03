# Signed envelopes

Status: the primitive, its first use (local dialogue) and imported saves
are built. Everything
after "Toward everything" is a sketch.

## Why

The server should not take a client's word for content the server wrote. A
browser that holds a dialogue line sends it back later as context, and the
server must know the line is the one it wrote, for that speaker, unedited.
The owner's direction is to do this for everything the server writes or
commits, because content that anyone can verify can also move between
machines and servers. That is how the game becomes decentralized.

So the signature is asymmetric (Ed25519), not a shared HMAC secret. Anyone
with the published public key can check it, not only our server.

## The envelope

```json
{
  "v": 1,
  "claims": {
    "content": "<sha256 hex of the UTF-8 content>",
    "entity": "vale",
    "iat": 1793635200,
    "kind": "line",
    "kid": "lf-2026-11",
    "rules": "cosyworld-orchestrator/1.2.116",
    "seq": 41,
    "turn": 12,
    "world": "local"
  },
  "sig": "<base64url Ed25519 signature, no padding>"
}
```

- `content` is a hash, so the envelope stays small and the content travels
  beside it (the line's `text`, a memory's `text`).
- `kind` names what is vouched for: `line`, `thought`, `persona`, `dream`.
  New kinds (`journal-row`, `snapshot`, `asset`) need no format change.
- `entity` binds the content to its speaker or subject, so a line cannot be
  moved to another character.
- `world` is a shared world id, or `local` for a browser save (which has no
  server-side id). `seq` is the world revision or journal sequence, and `turn`
  the turn it was written on.
- `rules` names the build that wrote it (the rules bundle hash for journal
  rows).
- `kid` picks the public key. `iat` is the issue time in Unix seconds.

**Signed bytes.** The signature covers `cosyworld.envelope.v1\n` followed by
the claims as canonical JSON: keys in ascending order, no whitespace,
integers only, and string values limited to printable ASCII without `"` or
`\`. With those limits every JSON encoder (serde, `JSON.stringify` with
sorted keys, Python `json.dumps(sort_keys=True, separators=(",", ":"))`)
writes the same bytes. A verifier rebuilds those bytes from `claims` and
never trusts a client-supplied byte string.

The code is `v2/orchestrator-rust/src/signed_envelope.rs` (`KeyRing::sign`,
`KeyRing::verify`).

## Keys

- **First start makes the key.** With no key yet, the server generates an
  Ed25519 key and keeps it in a `signing_keys` table (`kid`, `seed`,
  `created_at`, `retired_at`) in its event database
  (`COSYWORLD_V2_EVENT_DB_PATH`, on the app's volume), so volume backups
  carry it with the journal. Later starts load it. The log names the new
  `kid` once and never the seed. No secret needs setting.
- **Elsewhere.** The desktop runtime (`COSYWORLD_LOCAL_APP=1`) keeps its keys
  in `<COSYWORLD_LOCAL_DATA_DIR>/signing-keys.json` (mode 600). A process
  with only a snapshot path keeps them in `cosyworld-signing-keys.json` beside
  the snapshot. A process with neither (tests) signs with a temporary
  `ephemeral-…` key and logs a warning; its envelopes stop verifying on
  restart, and the words they carried are left out of context, not refused.
- **Override.** `COSYWORLD_SIGNING_KEY` (`<kid>:<base64url 32-byte seed>`)
  is optional. When set it signs instead of the stored key, for recovery or
  for several machines that must share one key; the stored keys keep
  verifying. A set but malformed value stops startup.
- **Rotation.** Start once with `COSYWORLD_SIGNING_KEY_ROTATE=<new kid>`. If
  the store has no key by that id, startup makes it current and marks the old
  one retired; retired keys keep verifying. Leaving the variable set is
  harmless, because the rotation happens only once per id. A leaked key is
  rotated the same way, then its row is deleted so it stops verifying.
- `COSYWORLD_SIGNING_PUBLIC_KEYS` lists further public keys to accept, as
  comma-separated `<kid>:<base64url public key>` (for example another
  server's or a deleted key's).
- `GET /.well-known/cosyworld-signing-keys.json` publishes every key with its
  `kid`, `alg`, `current` flag and public key.

**Machines.** `.dev` (`cosyworld`) and Lonely Forest (`cosyworld-lonelyforest`)
each run one machine with one `/data` volume (`fly.toml`,
`fly.lonelyforest.toml`), so each app's key lives on that volume. Processes
that share one event database share its keys. Machines with separate volumes
would each make their own key, and a word signed on one would be left out on
another; give such a deployment one `COSYWORLD_SIGNING_KEY` instead.

To make a key for the override:

```sh
node -e 'const {generateKeyPairSync}=require("crypto");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const seed=privateKey.export({format:"der",type:"pkcs8"}).subarray(-32);
const pub=publicKey.export({format:"der",type:"spki"}).subarray(-32);
const kid=process.argv[1]+"-"+new Date().toISOString().slice(0,7);
console.log("COSYWORLD_SIGNING_KEY="+kid+":"+seed.toString("base64url"));
console.log("public: "+kid+":"+pub.toString("base64url"));' lf
```

Stage it with `fly secrets set --stage COSYWORLD_SIGNING_KEY=… -a <app>` so
the next deploy picks it up. A plain `fly secrets set` during a rollout has
reverted that rollout before.

## First use: local dialogue

`/card-game/text` signs each line it returns (`entries[].signed`), and
`/card-game/reflections` signs each thought, persona and dream
(`reflections[].signed`). The browser keeps the envelopes
(`v2/card-game/signed-words.mjs`) and sends them back with the words they
cover. The server refuses an unsigned or altered word with 400 and leaves out
a word signed by an unlisted key ([untrusted input](../../v2/docs/card-table/shared-worlds.md#untrusted-input)).

What a returned word is checked against (`card_narrative/untrusted.rs`):

| Claim                       | Enforced                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`, `kind`, `entity` | Must match the word, its field and its speaker; otherwise 400.                                                                                                       |
| `world`                     | Must be `local`; otherwise 400.                                                                                                                                      |
| `rules`                     | Must name this build family (`cosyworld-orchestrator/…`); otherwise 400. Any version verifies, so remembered words survive a release.                                |
| `turn`                      | No later than the scene's turn. A thought, dream or between-us line has its own turn; a remembered line is no later than its memory. Otherwise the word is left out. |
| `seq`                       | No later than the scene's revision; otherwise left out.                                                                                                              |
| `iat`                       | No more than five minutes in the future; otherwise left out.                                                                                                         |

A word that fails a binding check is left out rather than refused, because
the browser keeps envelopes by text and an honest player can meet the same
words in another save. Local play has no world or run id, so `seq` is not
checked as strictly increasing per run: a word replayed into the same save
at an equal or later point still verifies. Shared journal rows, which carry
a world id and sequence, would close that.

## Toward everything (sketch)

- **Journal rows.** Each `card_log` row could carry an envelope with
  `kind: "journal-row"`, `world` the shared world id, `seq` the row's
  sequence, `rules` the released bundle hash, and `content` the hash of the
  row's canonical bytes plus the previous row's hash. That makes the journal
  a signed hash chain: any copy can be checked offline, and a replay can
  prove which rules produced which state.
- **World snapshots.** A checkpoint signed the same way (`kind: "snapshot"`,
  `seq` its journal position) lets a client or another server start from it
  without trusting the host it came from.
- **Client verification.** The browser could fetch the published keys and
  verify shared lines and snapshots before showing them, so a compromised
  relay or cache cannot inject words.
- **Other servers.** A third-party server holding our public keys could
  accept our avatars, items and lines as genuine, and sign its own content
  with its own published keys. Envelopes from several issuers can travel
  together, because each names its `kid`. A key directory (a list of trusted
  issuers and their well-known URLs) would be the next design step.
- **Saves.** Built for imports (#2067): sharing a local save sends the
  envelopes the browser kept, and the service keeps only the save's words
  they verify (`world` `local`, the same speaker and content), with the rest
  of its text checked against the authored catalogs
  ([untrusted input](../../v2/docs/card-table/shared-worlds.md#untrusted-input)).
  The kept words are not re-signed as journal rows yet; that waits for
  signed journal rows above.
