# Signed envelopes

Status: the primitive and its first use (local dialogue) are built. Everything
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

- `COSYWORLD_SIGNING_KEY` holds the current private key as
  `<kid>:<base64url 32-byte Ed25519 seed>`. It is a Fly secret, generated
  outside the repository. No key is committed; tests generate their own.
- `COSYWORLD_SIGNING_PUBLIC_KEYS` lists retired public keys as
  comma-separated `<kid>:<base64url public key>`, so content they signed keeps
  verifying.
- `GET /.well-known/cosyworld-signing-keys.json` publishes every key with its
  `kid`, `alg`, `current` flag and public key.
- Without a configured key, each process makes an ephemeral one (kid
  `ephemeral-…`). Its envelopes stop verifying on restart or on another
  machine, and the words they carried are left out of context, not refused.

Create a key (the seed never leaves your terminal and the secret store):

```sh
node -e 'const {generateKeyPairSync}=require("crypto");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const seed=privateKey.export({format:"der",type:"pkcs8"}).subarray(-32);
const pub=publicKey.export({format:"der",type:"spki"}).subarray(-32);
const kid="lf-"+new Date().toISOString().slice(0,7);
console.log("COSYWORLD_SIGNING_KEY="+kid+":"+seed.toString("base64url"));
console.log("public: "+kid+":"+pub.toString("base64url"));'
```

Set it with `fly secrets set --stage COSYWORLD_SIGNING_KEY=… -a <app>` and let
the next deploy pick it up. A plain `fly secrets set` during a rollout has
reverted that rollout before.

Rotate: make a new key, append the old `kid:public` to
`COSYWORLD_SIGNING_PUBLIC_KEYS`, stage both secrets, and deploy. Drop a
retired key from the list only when nothing it signed still matters. A
leaked key is rotated the same way but dropped at once.

## First use: local dialogue

`/card-game/text` signs each line it returns (`entries[].signed`), and
`/card-game/reflections` signs each thought, persona and dream
(`reflections[].signed`). The browser keeps the envelopes
(`v2/card-game/signed-words.mjs`) and sends them back with the words they
cover. The server refuses an unsigned or altered word with 400 and leaves out
a word signed by an unlisted key ([untrusted input](../../v2/docs/card-table/shared-worlds.md#untrusted-input)).

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
- **Saves.** A local save that carries envelopes for its server-written
  content could be imported into a shared world with those parts verified,
  which closes the import path still open today.
