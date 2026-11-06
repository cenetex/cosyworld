# Make a world by playing with its cards

Design study, 2026-11-06. This refines the [authoring system](world-authoring-system.md)
around the owner's phone feedback. It proposes the next product iteration.
The current editor is the starting point; the journeys below are proposed.

## The first minute

Open an illustrated, editable sample called **Lantern Shore**. It contains
three locations, two avatars, three items and one working opening quest.
The first view shows its World card and scene. The descriptor offers **Try world**.
Tapping World opens exactly **Items**, **Avatars** and **Locations**.
The descriptor now offers **Enter world seed**. Every category has real contents.

The sample starts at the shore. Vale carries the lantern. The keeper waits
beside a closed garden path. Returning the keeper's bell opens the garden;
the return path stays available. The third item is a blue scarf.
Use the game's existing paintings and working quest grammar for this example.
A separately named **First Voyage** example can teach Charybdis and cargo.

Existing drafts reopen where the author left them. A first edit of a sample
creates an independent local draft. A missing explicit draft link offers
recovery or a new sample through the descriptor. Sample changes use Undo.

The intended first success takes about a minute: open World, choose Avatars,
choose Vale, edit a description, confirm it, then try the world as Vale.
This is a usability target to test, rather than a measured result.

## What the screenshot reveals

Main and the live `.dev` site were checked at `81817694a`, version `1.2.125`.
`authoring-entry.mjs` starts a fresh draft with `pack:null` and opens Source.
`authoring-designer.mjs` gives every tool and maintenance action World as its
parent. `authoring-tree.mjs` projects source fields into the same tree.
Fallback artwork gives these cards the same wooden face. This makes tools
the first content a new author encounters.

The next view should give priority to authored things. The existing source
tree remains the detailed view over the same pack, bridge and launch record.
Category membership and physical placement are separate relationships: an
avatar appears in Avatars and through a location's Contents as the same entity.

## Research and its application

The source observations below are separate from our proposed use of them.

| Primary source | Observed pattern | Application here |
| --- | --- | --- |
| [Dreams templates](https://docs.indreams.me/en/create/resources/mm-creator-content/templates) and [Tren](https://docs.indreams.me/en-US/create/resources/mm-creator-content/templates/tren/info/contents) | Editable examples and small task-specific collections teach creation. | A complete small world offers a first edit and an immediate result. |
| [Dreams Tweak](https://docs.indreams.me/en/create/resources/edit-mode-guide/assembly/tools#tweak) and [Tabletop Simulator](https://kb.tabletopsimulator.com/player-guides/context-menu/) | Select an object to reach its properties and relevant actions. | Choose an avatar, place or item before revealing its configuration cards. |
| [Spore Creature Creator](https://www.spore.com/creatureCreator) | Build, Paint and Play are separate activities; Play shows poses and emotions. | Keep description, portrait approval and pose review as clear stages of one card. |
| [Super Mario Maker 2](https://www.nintendo.com/au/games/nintendo-switch/super-mario-maker-2/) | A work-in-progress course can be played during creation. | Try world starts a fresh preview and returns to the same editing card. |
| [Magic Booster Draft](https://magic.wizards.com/en/formats/booster-draft) | Choices from a current pack build a growing collection. | A small candidate hand feeds the world collection. Six is our product limit. |
| [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Important choices come first; specialized choices appear when needed. | World opens three categories; each selected entity reveals its local tools. |
| [Recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/) | Familiar content, clear labels and contextual guidance support recognition. | Show artwork, names and concrete effects; explain the next action beside its card. |
| [Apple generative AI guidance](https://developer.apple.com/design/human-interface-guidelines/generative-ai) | People need feedback and control over refining, retrying and reverting output. | Keep the accepted image visible during a roll and review its replacement before adoption. |

The playful qualities to keep are a visible object, a clear next action,
an immediate consequence and a reliable way back. Fast tapping matters more
than a long onboarding tour. Animation follows the existing card movement
and reduced-motion settings. A paid roll always has an explicit action.

## One card grammar

Tap a category to open its hand. Tap an entity to inspect it and reveal its
local stack. Tap an operation card to choose a verb. The existing context
action applies that verb. The descriptor names the exact result beforehand.
Parent cards stay in reach, and tapping one returns to that collection.

| Selected entity | Local cards | Example context action |
| --- | --- | --- |
| Avatar | Description, Image, Poses, Inventory, Quests, Starting place | Give the lantern to Vale |
| Location | Description, Image, Scene variants, Contents, Paths, Quests | Open this path when the bell is returned |
| Item | Description, Image, States, Holder, Uses | Place the bell beside the keeper |
| World | Items, Avatars, Locations | Enter world seed |

Names, abilities and descriptions use the descriptor's writing state. An
avatar face shows its name; selection shows **Name // Special ability**.
An ability is descriptive until a supported rule has been chosen and tested.
The same distinction applies to an item's suggested use.

The existing header controls provide World and Tools. Tools opens cards for
Import, Undo, Save status, Reload, Export and Publish. Import opens its source
choices. Each operation keeps its existing capabilities. Saved status lives
in the descriptor. Explicitly confirmed edits save automatically; Undo returns
to the previous accepted output. The manual Save path supports recovery.

On phones, one active hand and its ancestor cards share the screen with the
descriptor. A two-row hand can hold six proposals; readable labels decide
whether it uses two or three columns. Typing keeps the current card and main
action visible above the keyboard. Selecting a new field preserves pending text.

## Seed to a hand of candidates

**Enter world seed → Find avatars → choose candidates → Roll images.**

The seed can be a short idea, pasted text, or a link to a `.txt` or `.md` file.
A link is fetched as bounded text with a timeout, safe redirect handling and
public-address checks. Text is treated as story material throughout extraction.
Long text is divided into up to six source sections. A bounded random passage
is sampled within each section. Existing sampling and alias deduplication
provide the foundation; the output must remain supported by the sampled text.

The candidate hand contains up to six names and abilities. Fewer candidates
are valid when the source supports fewer distinct characters. One tap selects
a card; the descriptor shows its description. Selected cards stay selected
while the author reviews another. **Roll images for 2 avatars** states the batch.

**Find more** replaces unselected proposals. **Keep** moves a text proposal into
the world's avatar collection. Kept cards and their images survive later draws.
Deduplication uses normalized names and aliases across candidates and kept cards.
Ideas added by the model are identified as suggestions for the author to accept.

Items and locations use the same seed and candidate rhythm. Their second lines
describe purpose or atmosphere. Location relations and item owners remain
suggested placements until the author confirms them with the normal card action.
An author can return to any category while a generation request runs.

## Design, image and confirmation

| Stage | Card and descriptor | Main action |
| --- | --- | --- |
| Candidate selected | Name, ability and editable description | Roll image |
| Image running | Current accepted card; generation state | Cancel roll |
| Image ready | Proposed image beside the kept image in the same card stack | Confirm image |
| Change description | Editable description in the bar | Apply description |
| Edit image | Accepted or selected image plus temporary instruction | Roll changes |
| Reroll image | Same accepted description and style | Roll again |
| Portrait confirmed | Accepted image and pose readiness | Roll poses |
| Pose review | Named pose cards, each with its result | Keep pose set |

Confirm, Edit description, Edit image and Roll again are local operation cards.
Choosing one gives the existing context button its action. The chosen entity
stays visible. This keeps one action target while allowing free movement
between description and image review.

Describe the desired result in ordinary language: “Give Vale a raincoat” or
“Keep the old stone bridge; make it winter.” Internal prompt templates and
provider settings remain service configuration. The author edits the result
description and supplies image changes through this deliberate writing state.

Selecting an image only previews it. Confirming it saves the output. A fresh
roll preserves the accepted version until a replacement is confirmed. Each
accepted version has an Undo path. Saving the accepted card is distinct from
approving a charge for generation.

## Poses and other visual states

For avatars, the proposed first set is **Happy, Sad, Strike, Brace, Hit, Sleep**.
The confirmed portrait is the reference for every output. Individual files
allow one failed or unwanted pose to be rerolled while accepted poses remain.
A contact sheet is a review view assembled from those files.

The authored pose names require explicit runtime mapping: Strike maps to
attack, Brace to guard, Hit to hit, Sleep to the sleep portrait, and Happy/Sad
need supported expression states. Current `avatar.poses` holds conditional
stage portraits; combat portraits use a separate resolver. Each role must
be wired and tested before the editor calls a set ready for play.

Locations offer chosen variants such as Day, Night or Storm. Items offer
meaningful states such as Lit/Unlit or Open/Closed. Authors choose the variants
their world uses. The card previews its actual scene, transparent cutout or
state art. State changes that affect play require a linked condition or action.

Each confirmed portrait has an entity ID, visual revision and asset SHA.
Each pose refers to that portrait SHA and its role. Applying a new visual
description marks the image for review. Confirming a changed portrait marks
older poses for review; the accepted old set remains available through Undo.
An unchanged portrait keeps its existing poses. Names and prose edits that
preserve appearance keep the visual revision.

## Playing the changes

Try world starts a fresh instance from accepted draft outputs and launch state.
Walking, giving items and completing a quest reveal the effect of edits.
Return to editing restores the chosen card, branch and scroll position.
Runtime inventory, flags and quest progress belong to the preview instance.
“Use this scene as the start” is an explicit authoring command.

Location Contents retains the existing move/link gestures. Location Quests
shows each approach and its requirements. Avatar Quests shows starter wants
and authored choice chains. Rich imported conditions, alternative routes,
ordered steps, rewards and receipts keep their source identity and order.

Charybdis appears once as a location with Crew, Cargo, Docks and Lanes. Port
cards are references to canonical places. Its `transport.at` remains the
Greek harbor; the first listed dock remains the pond. Starting aboard changes
the launch record. A lane edit preserves free returns, boarding signals,
`item_at` versus `item_present`, cargo spending and the Willows crossing.

## Save outputs; keep generation input temporary

Persist accepted card names, descriptions, runtime briefs, rules, image bytes,
pose/state roles, asset hashes and the selected launch state. These outputs
are enough to edit or play a saved world. A later draw starts with a newly
supplied seed. A later image edit uses the saved image and a new instruction.

Generation input lives in request/session memory: original seed, fetched text,
sampled passages, extraction evidence, image-edit instructions, hidden templates
and provider-revised prompts. Logs, analytics, exports, browser storage and
durable job queues share this boundary. Operational receipts hold IDs, status,
usage and hashes; they carry only the metadata needed for ownership and billing.

Current `draft.document` persists Source text. New generation uses separate
session state and writes `document:""`. Current `avatar.seed` is a short runtime
character brief and belongs to the accepted character output. Imported pack
provenance remains in `sources`; input book passages remain temporary.
Existing drafts keep a clear export/clear-source choice during migration.

Generated assets need one guarded transaction for output JSON and verified
bytes. Capture draft key, entity ID, visual revision and request ID at dispatch.
An outdated response stays a temporary result and never replaces newer work.
Preserve successful outputs after a partial batch failure. Repeating an
ambiguous timed-out paid request needs a visible retry choice.

The application storage promise and provider retention are separate. Verify
the selected provider endpoint and account policy before offering a stronger
retention promise. OpenAI's current [data controls](https://developers.openai.com/api/docs/guides/your-data)
and OpenRouter's [ZDR settings](https://openrouter.ai/docs/guides/features/zdr)
describe that separate boundary. `zdr:true` alone needs an account-policy check.

## Provider and implementation plan

The current official catalogues list [GPT Image 2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)
and [OpenRouter's Flare route](https://openrouter.ai/openai/gpt-image-2.6-flare).
Verify account access, reference inputs and output settings at implementation.
The [image guide](https://developers.openai.com/api/docs/guides/image-generation)
describes reference fidelity and layout limits. The proposed individual-pose
workflow includes visual approval, alpha, dimensions and framing checks.

1. Ship the sample, category projection and useful entity art. Resolve default
   portrait variants through the existing scene selector. Reuse cards, stacks,
   descriptor and action button. Keep source fields in a detailed collection.
2. Add the temporary seed session and text candidate hand. Connect Haiku through
   the existing server gateway with a bounded, validated extraction contract.
3. Add private asset storage and one-card image generation/edit/confirmation.
   Expose reference support and output options in the existing Images gateway.
4. Add pose/state batches, per-output review and runtime mappings. Show the
   number of images and a price estimate before a paid batch. Limit concurrency.
5. Add the fresh preview adapter, private passkey Create and Store publication
   handoff. Keep Store ownership with the author of PR #2129.

## Evidence needed before calling the next editor complete

- A fresh visit shows the illustrated sample; World opens exactly three categories.
- Every sample entity has a usable image, description and concrete next action.
- Seed extraction, Keep, Find more and aliases produce at most six distinct proposals.
- Unselected rerolls preserve kept cards and accepted artwork.
- Description, image edit, confirm and pose review work at 1440, 390 and 320 pixels.
- Keyboard, touch, focus, long names and long descriptions keep the action reachable.
- Late responses, cancellation, partial failure and retries preserve newer edits.
- A seed/prompt canary stays absent from persisted state, request logs and exports.
- Saved outputs reopen with their images and play without the generation seed.
- Quest and Charybdis journeys match before and after an unrelated visual edit.
- Try world returns to the same authoring card with accepted draft data intact.
- Three short observed sessions reach a first edit and preview; record trouble
  points and completion times before adding more tools to the first hand.

This study uses primary documentation and code inspection. The proposed flow
still needs the observed sessions above. Existing art in the interaction study
illustrates state changes; image generation itself is a later implementation.
