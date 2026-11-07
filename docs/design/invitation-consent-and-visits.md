# Invitations, visits and story journeys

Status: proposed architecture, 2026-11-06. Research baseline: `b95704e9e`.
The owner wants invitations to depend on trust and the person's current
concerns across the cast. This note records findings and proposes a rollout.
Gameplay implementation follows review in separate small PRs.

## What ships today

| Concern             | Current source and result                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invite availability | [legalActions](../../v2/card-game/world.mjs) filters `staysPut` and `keepsHome` before offering Accompany. A ready journey supplies one exception.                                                                                                    |
| Consent             | `accompanyDecision` in that file accepts progress toward a want or positive trust, with grievances first. A journey has an earlier branch that accepts its next agreed destination before checking grievances.                                        |
| Home and roaming    | [travels](../../v2/card-game/want.mjs), [staysPut/freed](../../v2/card-game/pack-registry.mjs), and [rangeOf](../../v2/card-game/resident-home.mjs) govern different parts of autonomous life. `travels: false` and range zero also hide invitations. |
| After acceptance    | `perform` records `invitedPlaces`, moves the pair together, and spends the companion's response for that round. `plan` gives `walksHome` priority on its next turn.                                                                                   |
| Journey progress    | [pack-journeys](../../v2/card-game/pack-journeys.mjs) uses physical place as the step. Validation requires the starting place before agreement and a path place after agreement. Journey actors also lack ordinary Move actions.                      |
| Social history      | `trustGiver` raises trust for a wanted gift. [life](../../v2/card-game/life.mjs) records company after Talk and accepted exchanges, but fixed pack residents lack that life record. Company currently supplies speech facts.                          |
| Player links        | [actorCanVisit](../../v2/card-game/pack-registry.mjs) accepts saved invited places. A human's accepted invitation already permits a resident to use the human's open route across a pack boundary.                                                    |
| Human control       | [human-cast](../../v2/card-game/human-cast.mjs) treats a present seat as human controlled and an away seat as a resident. Invite currently targets residents.                                                                                         |

Fable and all sixteen Hoppy residents have `travels: false` in the
[active pack](../../v2/content/hoppycat-archive/card-world.json). Only Lumen,
Mira and Glim have agreed journeys. Fable's home rule hides Invite even with
trust three and a want at the destination. Her level thirty plays no part.
In a fresh seed-seven game, Fable wants to speak to Vale. Their actual Talk
completes that want; trust remains zero. A friendly encounter therefore needs
a common company rule as well as an accessible invitation.

The [shared evening design](hoppy-shared-evening.md) and
[pack refresh](../../v2/content/hoppycat-archive/CARD-REFRESH.md) explain the
three journeys. Fable's permanent travel restriction lives in the data.
The broader [world life design](rules-100-world-life.md) explains home ranges.

Read-only reproductions confirmed these cases:

- Fable alone offers Talk; Fable with the Garden offers no play. The visible
  descriptor retains the prior quest caption. A forged Invite fails legality.
- Mira's authored work and agreement produce a real accepted trip to the Garden.
- An accepted-visit-shaped state with Fable at the Garden, invited-place access
  and trust three sends her home on the next Wait.
- Forest Pip can accept or refuse an offered Invite through the common consent
  rule. Antigone and the gate guard have range zero and lack the same offer.

## Proposed model

Give each concern one owner. Use the same policy for every resident.

1. **Home policy** chooses ordinary wandering, homeward travel and sleep.
   Keep `travels`, range, `homeWhen` and `stayUntil` here. A freed resident gains
   autonomous choices. Their home remains meaningful during a visit.
2. **A request** names the inviter, companion and next destination. A known,
   awake resident in the room can receive it along a usable party route.
   The candidate remains available when the resident is likely to refuse.
3. **Consent** reads relationship and current concerns at commit time. A shared
   function returns `accepted`, a reason code, and the source facts for speech.
4. **An active visit** records the company the resident chose. It changes the
   priority of going home while that company remains together.
5. **A story journey** records agreed progress separately from current place.
   An ordinary visit can leave the story ready to resume.
6. **Route access** checks the world's ways and the whole party. Consent and
   movement permissions have separate results and separate explanations.

### Common consent

Proposed first policy, using existing state wherever possible:

- An active grievance toward the inviter leads to a refusal with its cause.
- Progress toward the resident's want, keeping close to a wanted item held by
  the inviter, or the next agreed journey step gives a reason to accept.
- Positive trust or current company gives a reason to accept a social visit.
- Otherwise the resident explains their current concern or wish to know the
  inviter better. A later action can change that answer.

Treat an ordinary mutual Talk as current company across the cast. Record its
participants and source event through a common relation helper. Company lasts
through their present encounter; separation, sleep or harm ends that basis.
This is familiarity for a short visit; trust retains its existing meaning.
Keep this relation separate from keepsakes and trade pricing, which currently
also depend on whether a life record exists. An accepted visit then carries
its own durable agreement.

The initial policy gives existing wants and journey agreements weight. A later
concern system can express urgency through checked conditions and saved facts.
For example, a promise may ask to finish a task before leaving. The same
conditions must govern the reply, available remedies and later acceptance.
Generated prose describes the decision. The rules own its cause.

### Visit lifetime

Proposed compact state: `visits[companion] = { host, sourceSeq, destination }`.
One resident has one active visit. `sourceSeq` names its accepted invitation.
An accepted next hop replaces that record after party travel succeeds.

While host and companion remain together, the visit takes priority over
automatic drift or displacement back home. The resident can pursue local
wants and take part in the scene. A visit allows sleep at the visited place;
the normal sleep schedule still applies. Ordinary Wait, Focus, Claim and
another room's plays preserve the agreement.

End the visit through a saved rule event when the host leaves alone or its
Sleep action commits, the companion commits a departure or accepts another host,
a new harmful incident breaks their company, the companion returns to human
control, or either participant is reset or removed from active content.
Keep the ending reason for speech.
Sleep ends the agreement before the resident planning pass.
After the visit ends, ordinary home policy resumes along available routes.
A journey resident returns toward its saved waypoint. A closed route leaves
the resident in the actual place with a visible reason and a later route home.

This first version agrees to one destination at a time. Each further road uses
the existing Invite action. Shared turns in other rooms consume no visit timer.

### Story journeys and gates

Store `journeyProgress[actor] = { agreement, step }`, bounded by the authored
path. Agreement starts at step zero. An accepted trip from the current
waypoint to the next advances it. Side visits preserve it. A return route
leads toward the saved waypoint so the journey can resume in order.
Arrival choices that depend on completing a journey read this record as well
as their existing world requirements. Final arrival remains a real event.

Keep the Hoppy work, attribution and agreement receipts, Myrine's homecoming,
Swede's recovered kit and Antigone's funeral conditions. Their data continues
to supply aims and effects. Visiting another place leaves unfinished deeds
available. Today `on: depart` can make a ready Swede vanish on any cross-pack
trip and leave his goods behind. Give an agreed story departure an explicit
purpose in its offered action and saved result. That purpose commits the
authored final departure and custody effects. An ordinary social visit keeps
the visitor and their goods together for a later return. Preserve the existing
autonomous story departure through the same purpose rule.

Party access should reuse a single route check before either inventory moves:
door resources, open crossings, active places, guards, recovery, ship state
and room capacity. Apply a person's explicit entry requirements to each party
member. Autonomous pack range belongs to home policy. Existing invited-place
access remains the record of routes a resident has visited with a host.

The Hollow currently opens through one shared `greek-polynices-heard` flag;
the route latches globally. A real Vale Talk lets Antigone enter on her next
turn with no separate conversation. The owner requires each traveller to
speak to the shade, so this is an existing gap. Proposed fix: save a durable
per-actor direct-conversation receipt and check it for both travellers, on
individual Move and Invite. `actor.talked` is a rotating quest history;
ordinary known facts can also arrive through retelling. Preserve anointed,
veiled and buried saves through explicit completed-funeral compatibility.
Migrate this route separately; its old global latch alone cannot prove that
either person held the required conversation.

## Cards and shared authority

Keep resident plus destination as the selection. The existing context button
says Invite; the descriptor names the proposed trip. A single resident keeps
Talk. The committed reply gives acceptance or a useful refusal in the same
dialogue system. A stale action receives refreshed choices and a clear reason.

The browser sends the current action key and revision. The rules compute
consent when the queue commits. Shared private views hide other people's inner
life, so a browser preview describes the request. Accepted and refused
Accompany events retain actor, target, origin, destination, result and reason.
New reasons include the rule facts that support the companion's reply.

Acceptance spends one turn, moves both inventories atomically, records route
access and the visit, and skips the companion's second response. Refusal spends
the exchange turn with both people in place. Preserve seat ownership checks,
request-key deduplication and journal commit before generated speech. When two
humans invite one resident, the first commit resolves; the second rechecks
place, control and route against the new revision.

Away human avatars follow the existing resident consent rule. Returning human
control ends the AI visit at the actual saved location. A present human chooses
their own movement. A later joint invitation feature would require that
person's explicit answer through their existing cards and context button.
Temporary host disconnect preserves a co-located visit. The away host may then
act as a resident; actual separation ends the visit through the normal rule.
Control returning to the companion ends its AI consent in the authoritative
presence transition, with the same result on replay.

## Save migration and small PRs

Old saves begin with empty visits and current-company facts. Keep existing
`invitedPlaces` as route history; those places alone cannot identify a host.
Derive old journey progress from the agreement receipt and validated path
position once, then save it independently. Preserve completed story receipts.
Validate actor IDs, active places, event identity and journey bounds. Pack
disable/reset clears active company and visits; retained journey progress must
survive a normal pack toggle. Removed content uses the existing migration path.

Use a fresh shared rules version for implementation, keep released bundles,
and prove each migration through local decode and shared journal replay.

1. Save and validate journey progress; keep today's play behavior. Migrate old
   journeys and test real routes, reload and story completion.
2. Add common company and visit state, route checks and consent together with
   the Invite eligibility change. Split groundwork first if the 400-line
   budget requires it; activate a coherent flow after that PR lands.
3. Use the existing descriptor for precise request, refusal and visit-ending
   facts. Play fixed, roaming and story residents at desktop and phone widths.
4. Tune urgency and relationship choices from recorded play, then consider
   explicitly accepted invitations between present humans.

## Evidence required for implementation

- Table-driven offers and decisions across fixed, ranged, roaming, journey,
  freed and away-human residents; trust zero/positive, Talk company, goal
  progress, active grievance and its repair. Include Fable without an ID branch.
- Actual accepted/refused plays, one turn, one companion response, then Wait,
  local wants, sleep, separation, harm, host change and return home.
- Journey visits before agreement, after agreement, off path, return, next
  step and final arrival; work receipts still require their actual deeds.
- Ready Swede's social visit preserves his presence and goods; an agreed final
  departure commits the authored ending. Sleep expiry occurs at Sleep commit.
- Joint keys and nested inventories, closed and reopened paths, guarded ways,
  ship boarding/landing, recovery, capacity and every party member's entry facts.
- Encode/decode, previous/current saves, pack toggles, reset, away-to-present
  control, two-owner races, stale revisions, forged actors, repeated request
  keys and checkpoint-free journal reconstruction through the current engine.
- Real desktop and phone card gestures: Invite is visible, both people arrive,
  Wait keeps their company, refusal explains the concern, and reload keeps it.
