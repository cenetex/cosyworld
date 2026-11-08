# Committed craft outcomes

Each successful recipe records a typed `craft` narration after its source
action. The event keeps its maker (`actorId`), output (`itemId`), immediate
output holder (`holderId`), place, witnesses, and the exact `consumedIds`.
`sourceSeq` names the action that supplied the final input. The event's own
sequence number identifies this occurrence, including later crafts of the
same item.

These facts describe the completed recipe. Current custody may change after
that event. Input cards come from the committed consumed set; a tool that
remains in play keeps its own custody. Old plain narration stays valid.
Retained source actions must agree with their typed outcome; trimmed history
keeps its bounded source reference.

The following presentation slice uses this event identity to arrange the
input cards and open a transient result box through the existing reveal
system. Discovery remains saved. Shared polling and reload restore the final
outcome. Item speech can use the same event and output identity.
