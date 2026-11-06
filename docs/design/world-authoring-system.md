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

## World cards and wooden boxes

Designer mode looks down onto the existing card table. Locations form the
main branches. Their open boxes fan out contents and linked places; locked
boxes fan out quests, requirements, steps and rewards. Existing card faces,
backs, frames, selection and the descriptor carry this view. Its layout
will have an owner-reviewed UI inventory and style change before merging.

The layout is a tree of expanded stacks with links between branches.
Road loops, shared quest targets and a ship serving several ports keep one
canonical entity each. A link card leads back to that entity. Opening a
branch keeps its ancestors visible. On phones the active branch fills the
hand and its parents remain available through the same cards.

Every location, avatar and item is available, including cards whose play
conditions are locked. With no box armed, selecting a location shows its
scene preview and sets the world's proposed starting place. Choosing it as
a link or quest target keeps that start. The descriptor says `Starting here`
or `Starting aboard at [port]`. The overview remains the editing table;
the selected location supplies its existing scene and card preview.

Starting place belongs in a versioned launch record beside the pack and
bridge. This is a planned extension to the current nine-field draft contract.
The launch adapter starts a fresh world there with the authored conditions.
`pack.entry` keeps its separate role as the pack's arrival point. An Arrival
card edits it and shows any required incoming bridge repair before Publish.
This separation also supports a player starting aboard the Charybdis.

A location has an open wooden box for its links and contents, and a locked
wooden box for quests that open its approaches. An avatar has an open box
for held items and a locked box for its quests. These are cards tucked behind
their owner, using the existing wooden backs, card selection and stack fan.
Selecting a box arms that destination. Selecting another card names the
change in the existing context button. A press applies one undoable edit.
Tapping the armed box again, Escape or the scene clears that selection.

| Selected box | Second card | Context action | Source edit |
| --- | --- | --- | --- |
| Location's open box | Another location | Link places | Add reciprocal `places[].exits` entries |
| Location's open box | Avatar | Place [name] here | Set `avatars[].place` |
| Location's open box | Item | Place [name] here | Set `items[].holder` |
| Avatar's open box | Item | Give [item] to [name] | Set `items[].holder` |
| Avatar's locked box | Item, place or person | Set starting quest | Set the resident's `want` |
| Location's locked box | Linked approach | Edit opening quest | Open that route's quest stack |
| Opening quest | A quest step or requirement | Add to opening quest | Patch its existing conditions and choices |

Each physical card has one initial holder. Moving it replaces that holder.
Home, return, regrowth and appearance rules remain separate fields. Simple
placement preserves them. An item with regrowth, a used-up start or a locked
start follows the existing place-only starting rule; the bar names the
required place when that item is selected for an avatar's inventory.
Link places is reciprocal by default; a One way
variant makes direction clear. Existing gated links open their quest stack.
Repeated linking keeps the existing link once.

The locked box fans into quest cards, then step cards. A step uses the bar
for its instruction and the same hand for its subject, place, items and
requirements. An Add requirement, Add step or Add reward card is an ordinary
card action. Supported choices appear as cards; their values appear in the
bar. Selection and the single context action carry every edit.

## Hand-written quest compatibility

The editor writes the same source structures as the hand-written packs:
`avatars[].want`, `choices`, `routes`, entity `requires`, and bridge
`crossings` and their `signal` fields. A derived editor index joins their references
into quest stacks. Each card keeps its source pointer and stable entity or
choice ID. Routes use their source array position and expected subtree hash,
since several route records can share the same endpoints. A draft revision
check protects those pointers. The original source objects remain the saved data.

An avatar's simple starting quest uses its one authored item, place or
person `want`. A second target offers `Replace starting quest`. The existing Eat/Drink and Lay templates retain their extra step
fields. Rich authored quests use choice cards: their trigger, subject,
place, ordered requirements, ordered effects and repeat behavior remain
visible through nested stacks. Rewards use those existing effects. Quest
chains, branches, flags and receipts retain their original links.

A location's locked box shows each approach separately, for example
`Gate → Battlefield` or `Attic → Cottage`. An internal approach edits
`routes[].requires`; a connection between packs edits
`bridge.crossings[].requires`. A location's own `requires` controls when
that location appears and has a separate `Appears when` state. The author
can inspect and edit either through the same stack.

A route can have several alternative records. The stack preserves each
alternative and its nested All/Any conditions. It also preserves the return
route. Converting an open link to a gated route removes the matching direct
exit in the same edit, so the route requirement governs that approach.

The opening quest shows both the actual requirement and its player-facing
hint. `route.sealed.reason` and `route.sealed.quest` supply the wooden box
and quest hint in play. Editing that hint keeps the actual opening conditions
in view. Internal routes show `Stays open` or `While conditions hold`;
`live: true` uses the latter. Crossings retain their live conditions and
signal timing.

The first compatibility journeys are:

- **Theban gate:** the guard holds Creon's writ. Its live gate opens and
  closes with that custody condition.
- **Polynices' funeral:** obtain permission and supplies, then Anoint,
  Shroud and Bury in order. Keep each requirement, flag, choice receipt,
  retired supply and shade state. The resulting road keeps its separate
  opening conditions and alternative routes.
- **Attic stairs:** lamplight AND either the Black cloth in the attic OR a
  carried scarf. Keep the free return crossing and backdrop state.
- **Hoppy programme:** Talk starts Mira's offer; giving the Draft or Brush
  chooses a branch; Wait completes that branch. Either ready flag reveals
  the Evening Programme. Keep the choice, item placement and one-time receipts.

Import and export preserve these packs semantically, including fields that
are outside the current editing templates. The editor describes an imported
advanced record through its existing card and retains its source subtree.
Changing one field patches that field. Array order, IDs, releases, archived
choices, appearance rules and media variants survive the edit.

## Moving locations: the Charybdis

The Charybdis is a location card with a transport state. Its open box fans
into Crew, Cargo, Docks and Sea Lanes. Its locked box exposes boarding
signals, lane requirements and linked quests. Placing an avatar or item
aboard writes the same initial place or holder as any other location.

The deck's source place keeps its empty static exits. Its bridge owns
`transports`, dock crossings and lanes. Linking a normal place to the ship
offers Add dock, followed by the joining port and lane cards. One edit adds
the dock, a valid boarding crossing and its lane. The existing return path
and the order of lanes remain visible. A First dock / Home port card edits
`transport.at`; that value is also the rescue home. The shipmaster role is
separate from where that avatar starts.

The tree shows the ship once, with port references on its docks branch.
Selecting a lane opens its direction, cargo requirement and travel reason.
Sea lanes, boarding crossings and side passages each keep their source type.
The Willows passage is a separate cross-pack crossing from the deck.

Charybdis examples anchor the transport adapter:

- Harbor to Piraeus requires provisions laid on deck, or Hoppy Cat cargo.
  Piraeus to the Jetty also accepts provisions carried aboard. Preserve
  `item_at`, `item_present` and `pack_item_present` as distinct conditions.
- Each outward cargo leg has its own free return lane. Lane order chooses
  the first available idle course. Cargo spending follows `spends` when set.
- The lamp signal preserves its ordered cover/take steps and maintained
  light/quiet conditions. It recalls an empty ship or waits for passengers.
- The locked provisions item keeps its recipe, ingredients, home and return
  behavior. Its recipe and the lanes that use it appear as linked cards.
- Dock, course, sea and arrived are runtime preview states. A chosen course
  commits one destination for the shared riders. The author edits starting
  conditions while the existing transport rules run each test voyage.
- The deck retains its sea/day/night paintings, boarding art, weather and
  music. The Willows' dark mist conditions remain on its own crossing.

A start-aboard launch uses the deck and its authored first dock. It needs the
explicit launch adapter above; boarding-crossing endpoints remain dock IDs.
Validation uses `laneProblems`, transport schema checks and `validTransports`.
Every dock needs an outgoing lane and a viable route home. Tests include
partial-signal reload, occupied recall, a full home port, shared passengers,
resident-only trips, cargo on deck versus carried, free returns, pack
switching and the Willows side passage. The full-home plus pending-recall
case found during this review is a runtime regression to repair and retest.

## Edit, test and save

Every edit is a single command with its inverse: move, link, set start,
change requirement, add step or change reward. Undo restores the source and
the selected location together. Each draft save uses its expected revision.
A stale save keeps the local draft and shows the two revisions for recovery.

Validation runs on the affected references and again before publication.
It uses `packProblems`, `packCompositionProblems`, `itemCycleProblems`, the
bridge compiler and the existing media checks. Conditions are traversed
through nested `any` and `not` records so every referenced card is visible.
The designer also reports unreachable starts, absent return paths, an item
needed behind its own gate, and a quest waiting on its own completion.
Intentional live gates and authored alternatives keep their exact semantics.

Test world starts a fresh preview at the launch place with the authored holders,
resident positions and quest conditions. The editor retains its draft while
the existing rules run the preview. A validated private catalogue adapter
provides its authored pack and chosen start to those rules. It shares the
pack contract used by the Store's mount work. Returning to edit restores the selected
location. A short quest journey verifies each imported example above before
those templates are offered for publication. Preview flags, receipts,
favor and moved items belong to that fresh preview state. Draft revision
and pack revision retain their separate meanings. Import tests compare the same
runtime journey before and after an unrelated card edit, including both
Hoppy branches and the funeral's consumed supplies and shade state.

## Draft contract

A draft contains `schemaVersion: 1`, `id`, `revision`, `title`, `document`,
`pack`, `bridge`, `assets` and `sources`. The server assigns its identity,
owner and revision. Server storage keeps timestamps outside this manifest.
Its storage identity is separate from the
authored pack identity. Imported pack and bridge fields stay intact while
being edited. The original prose stays with the private draft.

Draft JSON is bounded to 10 MiB and prose to 8 MiB. Asset metadata uses
`{path, mime, sha256, size}`. Asset bytes are stored separately by digest and
uploaded one file at a time. Each file is bounded to 16 MiB; a pack may carry
up to 512 files, 512 source records and 256 MiB. File paths are relative and normalized. The
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
pack. Create gives the private draft its own storage identity and preserves
imported authored IDs. The preview uses an isolated catalogue for that draft.
A named namespace migration is a separate reviewed operation: the funeral's
art, actions and music still have fixed-ID consumers. That migration needs
reference and runtime journey checks. Source credit stays in provenance.

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

## Six characters from a text

A single entry accepts pasted source text or a link to a `.txt` or `.md`
file. The author can paste a book. The reader divides the source into up to
six sections and samples one bounded chunk from each. Long sections use a
random chunk within that section. A saved random seed makes a draw repeatable;
Reroll uses a fresh seed. Paragraph boundaries keep the samples readable.

Haiku proposes one character from each sample. Each card carries a name,
a short special ability or epithet, and a source location. The face reads
`Name // Special Ability`, for example `Vale // The Lightbearer`. Candidate
names and aliases are normalized for deduplication. Each later extraction
receives the accepted identities; repeated identities get another sample.
A source with fewer distinct people returns the available distinct cast.

The author selects characters to keep, rerolls the remaining slots from the
source, and chooses which characters receive portraits. The author edits
the source material. The LLM's extraction and image prompts stay internal.
Selected cards and their images survive a reroll of the other slots.

## Character design and poses

Avatar cards use GPT Image 2.6 Flare in two steps. Design your character
creates a transparent full-body reference from the chosen character. The
author can reroll its design, keep variants, and choose one. Generate poses
uses that chosen image as its reference for happy, sad, strike, brace, hit
and sleep. Each pose joins that avatar's stack and can be reviewed or
retried on its own. The supplied dinosaur portrait and six-pose sheet
illustrate these steps in the designer's instructions. The source PNGs and
credit are kept in `v2/card-game/assets/authoring-guide/`.

The selected design keeps its digest and revision. Each generation records
the source digest, prompt version and exact model. A changed design asks
for a fresh pose set. Accepted poses keep common framing, facing and scale.
The image pipeline verifies alpha pixels, crop bounds and pose identity.
Generation metadata keeps the proposed action images until a pack pose
adapter accepts them. Current pack `poses` are conditional portraits;
combat and sleep also use fixed cast mappings. A focused schema and renderer
slice must support the generated pack cast: strike maps to attack, brace to
guard, then hit and sleep; happy and sad use authored expression conditions.
Its validation covers every generated character in play. Generated assets
join the same private storage and immutable release manifest as imports.

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
