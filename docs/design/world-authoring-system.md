# World Authoring System

Owner request, 2026-11-05. The authoring surface is `/make` on Lonely Forest.
The World Pack Store remains the work of PR #2129's author.

## Writing and cards

The author works at the existing card table. A World Idea card opens a plain
text writing state in the descriptor bar. The same hand holds Import and
Create. After Create, Places, Items, Avatars, Starting Quests and Publish
form card stacks. Selecting a card shows its text and action in the bar.
The existing hand renderer, frames, art, transitions and context action stay
in use. Writing supports paragraphs, paste, undo, composition and keyboard
navigation. A focused editor keeps its caret through background updates.

`/make` shares Lonely Forest's passkey origin and session. It opens an
independent document workspace. Local play and shared-world resume keep
their own saved state. A later subdomain may redirect to this route.

## Draft contract

A draft contains `schemaVersion: 1`, `id`, `revision`, `title`, `document`,
`pack`, `bridge`, `assets` and `sources`. The server assigns its identity,
owner, revision and timestamps. Its storage identity is separate from the
authored pack identity. Imported pack and bridge fields stay intact while
being edited. The original prose stays with the private draft.

Draft metadata is bounded to 2 MiB and prose to 256 KiB. Asset metadata uses
`{path, mime, sha256, size}`. Asset bytes are stored separately by digest and
uploaded one file at a time. Each file is bounded to 16 MiB; a pack may carry
up to 512 files and 256 MiB. File paths are relative and normalized. The
server verifies byte counts, media types and digests. Every private read and
write checks the signed-in account. Private responses use `no-store`.

Saves include `expectedRevision`. A concurrent edit returns a conflict with
the account's current revision, allowing the author to keep both versions.
Drafts may be incomplete. Publication checks the complete playable schema.

## Import and Create

Import opens a public GitHub source at one exact commit. The server resolves
a repository reference once, then reads all pack files from that commit.
It records the repository, commit and relative path. Git tree entries must
be ordinary files. Import keeps source pack data, bridge entries, media,
state backdrops, avatar poses and external lore. Existing compiled outputs
remain outputs of the pack compiler.

The local app also opens world files from disk. Its file picker grants
access to the files selected by the author. An imported document remains
editable before Create. Create copies it into an account-owned private
pack. A new fork receives its own authored namespace with internal
references remapped together. Source credit and source identity remain in
provenance.

The local app can keep drafts on disk. Hosted Create and Publish use a
browser passkey handoff with a short-lived, single-use upload claim bound
to that account and document. Hosted session credentials stay on their
origin.

## Haiku extraction

Haiku proposes places, item cards, avatar cards and starting quests from the
world document. The existing AI gateway pins the configured Haiku model.
Bounded extraction passes fit the model's output budget. A proposal records
the input draft revision, model, prompt version and resulting data.

The author reviews the proposed card stacks and applies them through the
context action. Apply checks the source revision. Manual edits made during
extraction remain available. Provider failure keeps the current document
and offers a retry. Text and references pass the pack schema before use.
Starting quests use the existing resident `want` fields. Places and item
holders refer to stable IDs from the proposed or imported pack.

## Character design and poses

Avatar cards use GPT Image 2.6 Flare in two steps. Design your character
creates a transparent full-body reference. The author can revise it, keep
variants, and choose the design. Generate poses uses that chosen image as
its reference for happy, sad, strike, brace, hit and sleep. Each pose joins
that avatar's stack and can be reviewed or retried on its own.

The selected design keeps its digest and revision. Each generation records
the source digest, prompt version and exact model. A changed design asks
for a fresh pose set. Accepted poses keep common framing, facing and scale.
The image pipeline verifies alpha pixels, crop bounds and pose identity,
then maps each file to the current avatar portrait and pose fields. Generated
assets join the same private storage and immutable release manifest as imports.

The production model is `openai/gpt-image-2.6-flare` through the configured
provider. The direct OpenAI model ID is `gpt-image-2.6-flare`. Both generation
and reference-image editing are documented in the [image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

## Publish and the Store

Publish first prepares the exact public file set: pack manifest,
`card-world.json`, `card-bridge.json`, assets and provenance. The descriptor
shows the title, credits, license, card counts and revision. The private
source document stays in the account's draft.

The final Publish action sends the expected revision and prepared digest.
One transaction records an immutable release and a durable Store submission.
Public file routes serve exactly the files named by that release. Editing a
published draft creates a later private revision. Publishing it makes a new
release.

The submission carries `submissionId`, `releaseId`, `contentSha256`,
`releaseUrl`, title, description, credits and license. The Store author owns
catalogue acceptance and the adapter to their reviewed vendor pipeline.
An acceptance receipt must name the same submission, release and digest.

The Publish card reads Private, Review publication, Release published /
Store review queued, Changes requested, or In the World Pack Store. The last
state follows a Store acceptance receipt and links its listing.

## Delivery

Each slice has its own `codex/` worktree and early draft PR, within the
400-line handwritten budget. The first slices cover private storage, draft
import data and reuse of the hand renderer. Later slices add the writing
state, GitHub and disk import, Haiku proposals, card edits, immutable
publication and the local passkey handoff.

Tests cover two-account ownership, revision conflicts, exact import bytes,
path bounds, schema failures, provider errors, proposal conflicts and repeat
publication. Browser checks cover the full Import, Create, edit and Publish
path at desktop and phone widths, including keyboard focus and long text.
The Store submission contract is tested separately from catalogue acceptance.
