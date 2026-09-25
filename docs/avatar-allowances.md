# Avatar allowances and room items

The Player menu lets an owner give their AI avatar one allowance. The owner
chooses Talk or Talk and act, a reply limit, an action limit, and an optional
known item to seek. Take control pauses the allowance and restores the hand.

The room keeps its conversation in the centre. The Items button opens a list
of loose items, the owner's belongings, and items disclosed by nearby avatars.
Each item names its holder or its place on the ground. Its card links to the
current hand when dealt. Think uses the existing offered card replacement.

## Rules

- New avatars start with direct control. Each Start requires the owner session.
- One allowance has at most 16 actions and 4 reply requests. The defaults are
  8 actions and 2 replies. A new Start after Pause replenishes the allowance.
- Each reply request reserves a slot before generation. That slot covers up to
  two provider attempts, within a combined estimate of $0.002. Failed requests
  consume their reserved slot. The estimate uses the voice router's token and
  price estimates; the request and action counts are hard limits.
- Journal records and snapshots preserve the allowance, its generation, its
  use counts, and item goal progress. A stale browser generation gets a conflict.
- A paused or replaced allowance cancels publication from its previous
  generation. The owner keeps their identity, avatar session, and belongings
  during delegation.
- Mechanical choices use the avatar's current legal offers and finite hand.
  A known item goal joins the existing item desire system. Acquisition updates
  its saved progress.
- Active players keep a room moving. An owner watching their delegated avatar
  counts as an active player. A returning player resumes waiting room work.
  This follows the played-time rule in
  [ADR 0011](decisions/0011-reflective-work-runs-in-batch.md).

## Item continuity

Inactive direct avatars release each held item through the ordinary item-drop
record. Other loose items keep their location. Guest state uses the mounted
world's entry room, including Void 001 for the Elysium world.

An empty floor can be a valid game state: an avatar may have picked up an item
or carried it elsewhere. The item view follows the current disclosed state.
