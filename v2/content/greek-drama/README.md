# The Wine-Dark Sea

A reusable card-world pack for the Greek Drama Reader's 44-work collection.
The traveler reaches it from Black Pond and returns with the same identity,
carried objects, memories, and saved decisions.

## Source and runtime

`card-world.json` is the canonical authored source. It contains 49 places,
21 resident definitions, 13 objects, 78 typed choices, and all 44 work records.
Eleven residents are initially active, including the six-role Theban cast.
Ten additional resident definitions are conditional embodiments of Helen,
Menelaus, Electra, and Orestes. An account commitment activates only its own
embodiments. No initial scene has more than two active residents alongside
the traveler.

The external
[`card-bridge.json`](../../worlds/greek-drama/card-bridge.json) owns the
Black Pond–harbor topology. At the quiet pond, cover and uncover the fueled,
lit Lamp twice with the Black cloth. The second uncovering summons the ship.
Lighting the lamp alone does not open this crossing.
The Greek ship location variant and the boarding card share that predicate.
The harbor keeps its return route even if the entry lamp has gone out.
The reusable source never names
Black Pond or another world. The build script combines source and bridge into
[`greek-drama.mjs`](../../card-game/packs/greek-drama.mjs), which the card
registry loads. Do not hand-edit that generated module.

```sh
node v2/scripts/build-card-worldpacks.mjs
node v2/scripts/build-card-worldpacks.mjs --check
```

The check validates entity identities, references, typed conditions and
effects, media files, connected geography, reciprocal travel, account
alternatives, scene cast bounds, and the exact 7/7/19/11 repertoire. The
runtime independently validates the executable pack contract and saved
choice receipts.

This release runs in the browser's existing deterministic card table and
localStorage save. Its `packs` state is part of that same save, not a second
game or a launch link. It does not mount a new shared classic-world registry,
write to the server journal, or provide multiplayer persistence. A future
shared-world implementation must port these general choice descriptors
through the C kernel and journal with parity and replay evidence. No classic
manifest or spatial-only projection pretends to provide those rules now.

## What is playable

**Before the Burial** is a material Theban episode. A player can return a
water jar, hear a decree, arrange a witness, supply a burial, petition for a
public exception, decline, or report the intended action. Custody and saved
choice state decide which later actions are available. A public exception
also opens a lawful version of the burial action.

**Helen's accounts** form a branching quest. Myrto offers the Egyptian
phantom account or the Trojan homecoming account at the harbor. Committing
to one opens its destination and activates its Helen, Menelaus, and witness
tablet. After hearing Helen, the player can provision an agreed return
passage or record a request for continued protection. These actions do not
falsely claim that a voyage has already happened.

**The Atreid accounts** form a second branching quest. The singer at the
Argolid crossroads offers the tomb account of Aeschylus, the palace account
of Sophocles, or the farmhouse account of Euripides. Each choice opens a
different place with its own Electra, Orestes, and evidence. The player can
commit the testimony to a hearing or refuse a revenge commitment. A hearing
is promised, not silently held; no murder, recognition, or verdict is created
by generated dialogue.

The branches are content-driven choices in the ordinary action system.
They are not error messages, world resets, or a menu that discards the current
save. The source defines the alternatives; general rules enforce the saved
commitment. The selected account, evidence custody, follow-up response, and
return path survive a visit back to Black Pond.

## Coverage boundaries

The repertoire records five works as the basis of current episodes:
*Antigone*, *Helen*, *Libation Bearers*, and the two *Electras*. The other
39 works have real locations and executable, saved inquiry hooks. An inquiry
records that a question was opened; it does not execute the reported play's
events. These are **situated hooks**, not 39 completed dramatic adaptations.

Every work preserves author, title, original premise, an era label, place
references, source provenance, and coverage status. The two *Suppliant Women*
remain separate records. The corpus includes the reader's *Rhesus* and
*Cyclops*. Different translations are not counted as different adventures.

Era labels describe the repertoire. They do not falsely claim that a live
generational timeline, automatic phase change, resurrecting cast, or all
ancient supernatural powers are implemented. Saved events govern the live
world. Other accounts remain reports until their own rules and conditions
are authored. The proposed bird city remains a proposal at the Hoopoe's
thicket rather than an already-built empire.

## Opening route

At quiet Black Pond, play **Black cloth + Lamp** to cover the lit lamp,
then **Black cloth** to uncover it. Repeat once. The second uncovering
reveals a Greek ship and the **Wine-Dark Harbor** boarding card together.
Board it, then travel to **Theban Courtyard**. Progress survives reload;
leaving, extinguishing the lamp, or nearby bells cancels the signal.
The courtyard reaches the market well, gate, and sanctuary. The well reaches
the palace; the gate reaches the battlefield.

| Action | Material requirements | Saved result |
| --- | --- | --- |
| Return the water jar | Carry the jar from the well to the courtyard | Jar rests at the table; the reserved loaf becomes available. |
| Hear the burial order | Speak to the guard at the gate | The decree's prohibition becomes known. |
| Ask for a public witness | Hear the decree, then visit the elder at the well | The elder agrees to witness a petition. |
| Prepare the burial ground | Carry the shovel to the battlefield | Shovel remains there; the ground is prepared. |
| Perform the burial | Prepared ground; cloth and oil carried to the battlefield | Both supplies remain there; the burial is recorded despite the prohibition. |
| Petition for burial | Witness support; decree and household token at the palace | A public exception is granted; the decree stays at the palace. |
| Complete the permitted burial | Exception; prepared ground; cloth and oil | A burial occurs under the exception. |
| Decline or report | Hear the decree, then choose at the gate | A refusal or warning is recorded without an invented punishment. |

The three-item carrying rule is unchanged. Supplies can be staged through
the preparation action, and the traveler can put possessions down and return
for them. Known routes remain ordinary travel actions. An incomplete request
never removes the way back to the harbor or Black Pond.

## Authoring contract

Places, people, and objects use stable `greek-` IDs. Conditional cast members
carry a `canonicalPerson` identity for validation, and their `requires`
conditions select mutually exclusive account embodiments. Every displayed
person has a concise voice profile restricted to current, witnessed facts.
The model writes expression; it does not choose an account or alter a rule.
The same account conditions guard destinations, incoming routes, residents,
and evidence. A desire can have its own conditions; Antigone's request for
burial materials ends when the traveler commits to a response.

Character art uses fifteen transparent PNG portraits generated with
`image_gen` in the user-directed “chthonic Greek” style. The twenty-one
resident embodiments share portraits only within their own character
identity; each connective resident has distinct art. Original generated
pixels and alpha are retained. The five scenery SVGs and nine object SVGs
remain in use, and the seven legacy figure SVGs are retained. See the
[art provenance](../../card-game/assets/greek/PROVENANCE.md) for generation
details and prompts.

Conditions are closed descriptors: an established account, an uncommitted
choice, a flag, current custody, or a recorded meeting. Effects select an
account, set a flag, or place a currently carried item in the current place.
An effect cannot invent a person, kill a character, spend server currency,
teleport a companion, or mutate another world.

Changing a visible name does not change an entity's identity. A new revision
needs a deliberate saved-state migration; do not drop saved commitments to
force a revised pack to load. Keep new account branches and new source works
in the authored JSON, and keep general rule changes in the engine.

See [ATTRIBUTION.md](ATTRIBUTION.md) for source and licensing boundaries.
