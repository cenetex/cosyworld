# Quest journeys

An avatar with `roamingQuest: "latest-completion"` follows the latest meaningful
quest completion. The bard uses this capability. His new home is the harbor.
Existing saves keep his recorded position. An untouched older spawn can take
its authored path from Argolid Road to the harbor on a resolved turn.

The destination comes from the completion receipt's saved location and sequence.
Human, AI, avatar-held, item-held and place-held quests all use that ledger.
The receipt keeps the site even when an actor or item later moves. Same-turn
completions have distinct sequence numbers. An unknown old site stays unknown;
an unknown author stays unnamed.

The avatar holds an ordinary shared journey card. Each resolved world turn
allows one legal travel action, including while the avatar is away from the
player. The route uses the same doors, item conditions and transport state as
player movement. A ship completes its current crossing when a newer quest
changes the destination. Arrival completes the journey card; the avatar stays
at that site until a later meaningful completion.

## Routes and help

Saved route knowledge starts with the avatar's home region. Visible exits and
witnessed travel add edges. A route edge records knowledge of a path; its current
travel conditions determine whether that path is open. When a destination lies
beyond the known map, the avatar can explore a known frontier one step at a time.

A blocked edge produces a shared passage card at that place. Missing directions
produce a card held by the traveler. The same cause and edge reuse one card.
The rules let people join these cards with the `join-quest` action. Residents
choose it themselves. The player has no Help control: people at the same place
hear about the card in Talk context ("Help needed here"), and the player helps
through ordinary plays. A present helper can share known routes, carry an object
that opens a door, or bring a vessel through the ordinary travel rules. Eligible
AI helpers use the same legal choices. The card's saved
cause links it to the original completion.

## Retention and replay

A new destination supersedes the older unfinished journey and its help cards.
Other quests keep their focus and progress. Superseded cards keep their identity.
The shared registry retains cards joined by other people. Its transient-history
API keeps the latest 32 finished owner-only cards and removes their references
together when it prunes them. A separate 32-entry journey index keeps the recent
names and outcomes. These limits leave room for future journeys.

Journey and help completions retain their causal family. The destination query
excludes that family, including helper completions. This keeps arrival and help
from creating another destination by themselves.

Shared rules version 7 adds this behavior. Versions 2 through 6 retain their own
bundles for journal replay. Recorded upgrades use their recorded target reducer.
After historical replay, the current upgrade installs the journey state and
route knowledge while preserving items, claims, quest records and conversation.
Checkpoints and seed-only journal replay follow the same path.

The song continues to use earned authored verses. Known human and AI authors
keep their names; unknown authors use “an earlier traveler.” The complete poem
and its newest lines provide context for the bard’s own voice.

## Invited company

A human can invite an available resident through the human's current open route.
The resident keeps their own agreement or refusal. An agreed trip moves the
party together and applies the crossing and boat effects once. Carried keys
therefore travel with the inviter after the whole party passes the route check.

Each successful invitation records the destination in the companion's saved
visited places. This allows their saved position in that region after reload.
Later movement still uses the current doors, tokens, transport and room rules.
Refused and stale invitations keep positions and visited-place memory intact.

## Later: company that stays

Planning, not built. These keep the invite rules above: a resident moves with
a human only through an agreed Accompany, never by following uninvited.

- **A companion whose want is met (pack data, small engine change).** A
  resident with nothing left to want can agree to a standing invite: it keeps
  saying yes to the inviter's next trips until it or the inviter ends it. It
  warns about the place ahead from its own visited places and facts, and
  reacts in Talk to the inviter's deeds it witnessed. Following without an
  invite does not fit: it would move a resident by someone else's play. The
  lasting invite needs one engine field on the companion (who it travels
  with) and one Accompany answer; warnings and reactions are dialogue from
  facts. Witnessed reputation, built separately as an engine change, supplies
  the deeds.
- **Shared XP (engine, a later rules batch).** A companion present when its
  inviter meets a want earns a share of that want's XP. XP still only goes up
  and still comes only from wants met.
- **Marriage (pack data on the same field).** A want aimed at a person, met
  by a lasting invite with them. Either side can end the invite; nothing is
  lost when it ends and nothing decays while apart.
