# Authored relationship context

Mara's relationship reply receives two pieces of evidence: the committed
relationship beat and her own desire to recover Rowan's key. The `reply_prompt`
field keeps its schema and now carries first-person context. It explains what
Mara wants, why the failed lamps matter, and how the traveler can earn her trust.

The speech spine labels these inputs `RELATIONSHIP BEAT` and
`MY RELATIONSHIP CONTEXT`. The shared scene-grounding paragraph and publication
gate continue to govern generated speech.

## Runtime guarantees

| Concern | Source of authority |
| --- | --- |
| Request reaches the player | `create_bond` commits the exact authored `first_beat` in a `relationship.beat` event. The browser renders that saved event. |
| Reply belongs to this beat | The observation and reply carry `relationship_event_seq`; publication records the same cause and delivery status in one Journal record. |
| Delivery after a restart | Recovery finds the previously committed reply by its cause and records delivery once. |
| Trust is earned | `deepen_authored_relationship_from_gift` matches the configured item ID before advancing the bond. |
| Item and Orb effects | Server action handlers and Journal mutations apply these effects. A delivered reply leaves the forming bond, key ownership, and Orb balance intact. |

The publication gate checks specific speech properties, including scene
anchors and supported action intent. The audit in
[the speech comparison](speech-contract-evaluation.md) records the scope of
those checks. Authored context supplies Mara's intended meaning; saved events
and action handlers establish the relationship's state.

Validation covers the actual provider request envelope, one delivered reply,
the saved request, unchanged key ownership and Orb balance, unavailable
dialogue, duplicate recovery, the required gift, and replay. Both affected
compositions preserve compatibility with their prior bundle hashes.
