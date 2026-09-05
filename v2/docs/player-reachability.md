# Player action reachability

Every playable projection exposes a legal dealt action, an avatar lifecycle
action, or a wait with a server turn deadline. The shared browser and
composition guard checks this contract on the actual server response.

| Server field | Client meaning |
| --- | --- |
| `primary_action.kind` | A lifecycle action or a named action backed by a current offer. `travel` names a `move` offer. |
| `primary_action.disabled` | The primary action is waiting. A scene with an empty hand needs a turn deadline. |
| `action_offers` | The authority for actions the player may submit. The client carries the chosen offer ID. |
| `action_hand.entries[].offer_ids` | The offers attached to each displayed noun card. Each ID exists in the server response. |
| `search_available`, exits, items, room features | Context for card labels and choices. A submitted action still needs its own dealt offer. |
| `character_identity.class_selection_ready` | The account can choose an available campaign class through `/avatar/class`. |
| `turn.seat_expires_at_ms` | The server deadline for a turn wait. |

An expired local session offers passkey recovery and a new-tale choice. That
choice clears the local credentials and opens avatar creation. Earlier avatars
keep their history in the world. A downed avatar retains its account rescue or
release path. The passkey gate proves recovery on a fresh device.

The production-router test follows entry, four dealt actions, session expiry,
knockout, and release. Browser checks cover the rendered lifecycle actions and
require a runnable dealt card in a playable scene. Composition checks apply
the same authority contract across the shipped world compositions.
