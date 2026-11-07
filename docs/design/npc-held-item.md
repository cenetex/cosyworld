# One item in an avatar's hand

Each avatar saves one `heldItem` ID or `null`. The item must be directly
carried and available. Custody, carried capacity, quest conditions, and item
history retain their existing meaning.

Each committed play compares its incoming items with its previous custody.
A newly received item becomes the hand choice. Both recipients of a Trade
choose their received item. A refused transfer keeps the existing choice.
Later actions preserve it while available; loss, consumption, or disabling
its pack chooses another carried item. Empty hands use `null`. Older saves
choose the first available directly carried item in stable ID order.

The next UI slice uses this choice for resident card and scene stickers and
their visible item card. The player's own inventory keeps its current flow.
Speech can read `heldItem(world, actor)` beside the full custody record.
