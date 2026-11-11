# The maker is the game table

Status: draft for the owner to edit, 2026-11-11. Nothing here is built and
nothing is decided. Issue:
[#2633](https://github.com/cenetex/cosyworld/issues/2633).

Owner, 2026-11-11: "A bigger maker change needs to happen aka we should make
it the same ui as the game, it would be less confusing, and we could show the
game being built smoothly transition to play etc"

Line numbers are for main at `302ab9261`. Counts say how they were made.

## The one idea

**Making a world is standing in it.** The maker shows what the game shows:
the place you stand in is the painting, and the hand holds the people, things
and ways out of that place. You raise one card or a pair and one button names
the play. The author holds a few tools, which are ordinary item cards. A tool
with a card is an author's play: draw, write, paint. Put the tools away and
the same table is the game, at the same place, with no page change.

## Prior art

| Where | What it settled | State |
| --- | --- | --- |
| [Authoring system](world-authoring-system.md), PRs #2329, #2330, #2340, #2341, #2366 | `/make` uses the game's card frames, descriptor and one context action; a branching tree of stacks; the writing field in the descriptor | Decided and built. The tree is what the owner now finds confusing |
| [Authoring play study](world-authoring-play.md), PR #2368 | "Try world starts a fresh preview and returns to the same editing card"; select the entity first; a candidate hand; image confirm | Proposed. Try world was never built: the only "Try world" text in the repo is that note (`grep -rl "Try world" docs v2`, before this one) |
| [Builder and summoning](builder-and-summoning.md), PR #1403, issues #1362, #1398–#1402 | Making **inside** play with a held card: "Unwritten card + a person → Talk", "no builder menu"; a faint card kept by playing it; `createRegistry(content)` as the content seam | Proposed, never approved (#1398 folded "awaits the owner's review"). No `createRegistry` on main (`grep` in `v2/card-game`) |
| [Wants and arcs](wants-and-arcs.md), slice 12 | Generated cards arrive locked and visible; code writes the lock, not the model | Agreed 2026-11-10, not built |
| #2623, PR #2626; #2631 | Generation is a server job that survives the tab; storage should be the user's | Jobs: server built, client moving. Storage: open design |

Not re-opened here: the card grammar, the descriptor writing field, the draft
contract, jobs, the Store (PR #2129), the three-card seed.

## What exists

### Author actions today

The maker is 35 `authoring-*.mjs` files, 6,915 lines (`cat | wc -l`), loaded
in place of `app.mjs` on the same `index.html` (`entry.mjs:18`, `:55`). Every
action is a **tool card** hung under a card; you select the tool card, then
press its button. A world of one place, one avatar and one item carries 16
tool cards (counted from the `tools()` lists of `authoring-seed-maker.mjs`,
`authoring-visual-tools.mjs` and `authoring-art-library-tools.mjs`).

| Action | Where | In | Out |
| --- | --- | --- | --- |
| Enter world seed, Create | `authoring-seed-maker.mjs:165-203` | seed text, at most 6,000 characters | `POST /card-game/authoring/generate/seed` (`:48`), three cards accepted at once (`:77`) |
| Uncover location, avatar, item | `:241-254` | kind, the cards already here | one card; a place gets plain exits to the entry (`authoring-seed-world.mjs:194-198`) |
| Regenerate | `:258-265` | the card | new name and text; "its place and links stay" |
| Discard | `:266-274` | the card | removed, links repaired (`authoring-seed-world.mjs:128-156`) |
| Starting quest, Discard quest | `:282-301` | the avatar | its `want` steps to the next card (`authoring-seed-world.mjs:118-126`) |
| Show details, field edits | `:226-239`; `authoring-designer.mjs:163-176` | a source field | one edit through the descriptor field |
| Generate avatar, Generate poses | `authoring-visual-tools.mjs:221-290` | a physical description; the portrait | image job; the press arms first (`confirm`, `:282`) |
| Confirm, Discard artwork | `:280`, `:296-306` | the preview | saved to the draft, or dropped |
| Artwork library, Use | `authoring-art-library-tools.mjs:107-131`, `:173-203` | a saved set | re-accepted with no new image |
| Import GitHub, folder, files | `authoring-import-tools.mjs:163-201` | a repository or files | a new draft |
| Save, Undo, Reload, Cancel | `authoring-designer.mjs:14`, `:140-156` | — | session commands |
| Sign in, Create passkey | `authoring-account-tools.mjs:79-83` | passkey | account |
| Create private world | `authoring-create-tools.mjs:85-104` | signed-in draft | upload; ends at "has a private saved copy" (`:95`) |

Gaps the review found, confirmed in code: only avatars get an image tool
(the loop at `authoring-visual-tools.mjs:221` is over `pack.avatars`), though
the server takes `location` and `item` (`card_authoring_image.rs:217`) and
`prepareAcceptedEntity` exists with no caller outside tests
(`authoring-accepted-entity.mjs:99`). The toolbar title is the pack name
(`authoring-entry.mjs:284-287`) and no card edits it. The two-press arm is in
the shared workspace (`settings-screen.mjs:192-200`).

### How the game table gets its world

- A world is `createWorld()` (`world/create.mjs:22`) or `createLandingWorld`
  for a pack (`pack-landing.mjs:15`). `app.mjs:251-256` picks one or a shared
  session.
- Packs are **compiled into the rules bundle**. `pack-registry.mjs:16`
  imports `packs.json` and builds module constants (`:104-116`). The shared
  bundle's content files include `packs.json` (the 9 keys of
  `card_shared/content.json`). There is no way to hand the rules a pack at
  run time.
- So a draft cannot be played today. `authoring-seed-world.mjs` builds a
  draft **pack** (`emptySeedWorld`, `:9`; `seedEdit`, `:91`), never a world.
  `GET /card-game/authoring/packs/{id}/launch` returns only
  `{revision, launch}` (`card_authoring.rs:270-277`); no client calls it.
  `pack-landing.mjs` and `/card-game/local` serve mounted packs and local
  saves only.
- Dialogue trusts only embedded profiles (`base_profiles`,
  `card_narrative.rs:180`), so a made resident cannot speak yet.

### Keep or replace

Presentation, replaceable: the designer, tree, tool projection and the seven
`*-tools` and `seed-maker` modules, 13 files, 2,804 lines. About half of the
tool modules is state worth keeping (busy, retry, sign-in return).

Logic, kept: session, Undo and accept (`authoring-session.mjs`), the local
store (`authoring-local-store.mjs`), draft contract, edits, seed world,
accepted art, images, art library, create transfer, import: 22 files, 4,111
lines, plus every server route. Their 34 test files stay.

### What the game client assumes

- Every play comes from `legalActions(world)` (`world.mjs:1196`,
  `app.mjs:2544`) and goes through the play queue (`app.mjs:709`), narration
  and a save (`app.mjs:571-574`).
- Two buttons are already client-only and play nothing: Look
  (`app.mjs:2612-2628`) and "Tap to open" on a closed box (`:2632-2656`).
  An author's play is the same kind of button.
- A closed box (not yet turned over in this browser) and a locked box (the
  rules keep it shut) already have two backs (`app.mjs:482-484`).
- The game already deals a second hand of cards for Settings
  (`installSettingsCards`, `app.mjs:6015`); the maker reuses that workspace
  (`settings-screen.mjs:141`).

## Three ways to fit "one selection, one button"

**A. Tools are things you hold.** The author's avatar carries a few item
cards. A tool paired with a card is the play. Pairs of world cards keep the
game's own meaning (item + person gives; item + place puts down).

**B. An author mode.** Same cards, no tools. The one button offers the
author's play for the selection.

**C. The workshop is a place.** A room in the hub whose boxes are the
candidates; making is ordinary plays in a live world.

| | A: held tools | B: author mode | C: workshop place |
| --- | --- | --- | --- |
| First two minutes | Tap Quill: "Write the seed", type. Tap Box + the empty place: "Draw". Three boxes land face down. Tap one: "Tap to open". The place turns over and its text is read; paint it and it is where you stand | Type the seed. Tap a box: "Uncover". Tap the open card: the button must pick one of paint, redraw, rename, cut | Walk to the workshop. Tap a box: "Take quest"? Its want must be met before it opens, which is play, not making |
| Many verbs on one card | One verb per tool; the card stays one card | Breaks. A kept card has five verbs and one button, so verbs return as cards under it: today's tree | Each verb needs a rule |
| In flight | A face-down box where the card will be; it turns when the job is done | Same | Same, but as a journal command |
| Keep or cut | Card + Box: "Put it back". Card + Dice: "Draw it again" | A button that changes with hidden state | Faint cards that fade (the summoning design) |
| Place and item art | Card + Brush; the painting arrives as a box behind the card | A tool card again | A rule per kind |
| Poses | Cards behind the avatar, as items sit behind a holder | Tool cards | Same as A |
| Text | Card + Quill opens the descriptor field | A field card | Talk; typed wishes were an open question |
| Phone | Tools fold behind the author's card; the hand is one place | Tree depth returns | One place |
| Cost | Client first | Client | Rules, journal, content seam |
| Weak point | A tool takes one of the two slots, so no tool play can name two world cards | Same card, same selection, different button by mode | Edits are not plays; invents a place |

**Recommendation: A**, with one rule borrowed from B: a card selected alone
gets the play its state implies ("Tap to open" for a face-down box, "Go" for
a way out). C is where A leads once a world can carry its own content; it is
the summoning design and stays parked.

Why A: it is the game's grammar, pairs make plays. It moves verbs out of 16
per-world tool cards into about five things in the hand. It answers "am I
playing or making" with something visible: are the tools in my hand. It
starts client-only.

### The tools

Names and art are the owner's (question 2). Each is an ordinary item card.

| Tool | With | Button | Does |
| --- | --- | --- | --- |
| Box | the place you stand in | Draw a card here | One text job. A face-down box appears here |
| Box | a card | Put it back | Today's Discard. Undo restores it |
| Dice | a card | Draw it again | Today's Regenerate. The new card lies on the old as a box; opened and kept, it replaces it |
| Quill | alone | Write the seed, then Name this world | Descriptor field |
| Quill | a card | Write | Name and text in the descriptor field |
| Brush | a place, person or thing | Paint | One image job. The painting arrives as a face-down box behind the card |
| A painting | its subject | Use this painting | Today's Confirm. Unused paintings stay behind the card; that is the library |
| Brush | a person with a portrait | Paint poses | Six pose cards behind the person |
| Key | a box | Change its lock | Steps what the lock names, as Starting quest steps today |

World cards paired with each other move things, as in play: thing + person,
thing + place, person + way out. No tool play needs three cards.

Blocked plays say why on the button: "Write a seed first", "Wait for the
image", "Sign in". Sign in, Import, Undo, Reload and the save state move to
the game's own menu hand; saving is automatic, as accepts are today.

### Boxes

This is "the game being built". Every draw puts a box on the table before
its words exist. The box turns over when the job finishes; jobs outlive the
tab, so a reload shows the same box. After the first place and avatar, each
new card carries a lock that names a card already in the world (slice 12).

While making, the author may open any box, and the descriptor tells its
lock. In play the rules keep it shut. The two backs that exist today carry
the difference: closed for the author, locked for the player.

### From making to play

The author's own card, selected alone, reads **Play this world**. On the
press:

1. The tools leave the hand.
2. A fresh world is made from the draft, with the traveler in the place the
   author stands in (the launch record, `authoring-seed-world.mjs:200`).
3. The table is re-dealt by the rules: locked boxes turn face down, people
   move, turns pass. The painting does not change.

The same card then reads **Return to making**. The tools come back at the
same place. The playtest world is thrown away; the draft is untouched.

A made world is saved to the author's account without a "Create" step, and
appears as a world in the ☰ menu. Its pack declares an entry to the Black
pond like any pack, so a traveler reaches it the way the opening teaches:
the attic, the lamp put out, the mirror. Sharing it with others is the Store
or a shared world, both later.

## What the rules do

**Making edits a draft pack, not a live world.** A rename, a cut or a new
link is not a play: it has no actor, no turn and no legal-action form. A
draft may be half-made, and a rules world must validate on every play
(`validateWorld`, `world.mjs:3200`). A journal replays on a frozen bundle
with `packs.json` inside it, so content that changes cannot be in a journal
today. While making, nothing ticks: the world holds still.

| Needs | What |
| --- | --- |
| Client only, current rules | The place view of a draft; Go between places; tools as hand cards; author buttons; boxes for jobs; text; place, item and avatar art; the menu hand |
| Pack data, authoring code | Locks on generated cards (slice 12); the entry to the Black pond; the launch place |
| Server | Dialogue for a made world's residents; saving without Create; listing private worlds. Maybe a private table address whose `packs.json` is the draft (not verified) |
| Rules, a batched bump | `createRegistry(content)`: a world built from a pack that is not in the bundle. Needed for Play this world and for any shared made world. Sealed items and seals on crossings are rules slices 9 and 10 of wants and arcs |

Play this world waits on the last two rows. Everything before it does not.

## Kept and deleted

Kept: 22 logic files, the server, the draft and job contracts, the tests.
Deleted at the end: `authoring-designer.mjs`, `authoring-tools.mjs`,
`authoring-collections.mjs`, the maker half of `card-tree-layout.mjs`, and
the `describe()` halves of the tool modules: about 1,300 lines. New: a place
view of the draft and the tool plays, about 1,200 to 1,800 lines over eight
to ten PRs. These are estimates from file sizes, not a plan.

## Slices

| # | Slice | Needs | One test |
| --- | --- | --- | --- |
| 1 | **Stand in the draft.** `/make?table=1` shows a seeded world as a place: its painting, its people, things and ways out. A way out alone reads "Go". Today's tool cards still sit behind each card | Client. Owner only if `check:ui` asks | On `.dev`, a person who has used `/make` opens both and says which is less confusing |
| 2 | Jobs as boxes: a draw shows a face-down box at once | Client, after the jobs client lands | Start a draw, reload: the box is there and turns over |
| 3 | Box and Dice replace Uncover, Discard, Regenerate | Client; owner for two card arts | A three-card world shows no draw tool cards; Box + place draws |
| 4 | Quill: seed, name, text, world name | Client | Rename the first place; the toolbar title follows |
| 5 | Brush for avatars, places and items; paintings and poses as cards behind | Client; owner for one card art | Paint a place: the backdrop changes when the painting is used |
| 6 | Locks on generated cards; Key | Authoring code, pack data; owner for one card art | A second place is a box whose lock names a card of the first |
| 7 | Menu hand: sign in, import, Undo, save state; remove Create | Client, server | A signed-in world is saved with no Create press |
| 8 | Play this world and back | Rules seam or server route; dialogue server | Make a locked way, press Play: it is locked; meet its lock: it opens; Return: the tools are back |
| 9 | Delete the tree maker; `/make` is the table | Client | `/make` has no World or Tools header |
| 10 | Poses on the stage in play | Client; maybe pack schema | A made resident sleeps in its sleep pose |

## Risks

- **Text and bulk work.** A card table is poor at long text and at changing
  twenty cards. Slice 4 shows the first; Import stays for the second.
- **Phones.** The tree jumped because it re-dealt. One place is one hand;
  slice 1 shows at 390 and 320 wide whether a place with five cards and five
  tools fits.
- **Paid plays in one tap.** A pair and a press is three taps and no arm
  step. The server already allows one running image and six a minute per
  owner, and a daily budget. Slice 5 shows whether that is enough.
- **Playing or making.** The tools are the only sign. If slice 3 testers
  cannot say which they are in, the answer is in question 3.
- **One tool, one target.** Locks and wants that name two cards cannot be a
  tool play. Slice 6 shows whether stepping with the Key is tolerable.
- **Play needs rules.** Slices 1 to 7 are worth having without it, but the
  owner's "transition to play" is slice 8.

## Ethos

1. *What can the author do differently?* Stand in a place they made and see
   what a traveler will see, then cut or keep by handling the cards.
2. *What will the world remember?* The draft remembers what was kept. A
   playtest is forgotten. Who made what is not remembered until making
   happens inside a live world (C).
3. *Why is this better?* One table to learn. Sixteen tool cards become five
   things in the hand. A made world can be walked into.

Human test, after slice 5: someone who has never seen `/make` makes a world
of two places on a phone, names the most memorable moment and the part they
would cut.

## Open questions for the owner

1. Is A the way: tools as held item cards?
2. Which tools, with what names and art? The draft says Box, Dice, Quill,
   Brush, Key. Dice could fold into Box.
3. What is the gesture from making to play: the author's own card reading
   "Play this world", or putting out the Lamp as the opening does?
4. Who is the author on the table: Vale, the avatar of the world slot, or no
   avatar until play?
5. Does the author choose the kind of each draw, or does the room rule
   choose it?
6. Does a draw deal one box, or several to keep one from?
7. May `createRegistry(content)` ride a rules bump so a draft can be played,
   or should a server route be tried first?
8. Does Paint run on one press of a pair, or keep an arm step because it
   costs money?
