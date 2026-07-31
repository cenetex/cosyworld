::: {.chapter}

# Part IV: Notice and Discovery {#part-discovery}

![Travelers notice tracks, fibers, and bent reeds that point toward a hidden route](assets/illustrations/noticing-a-lead.jpg)

## 14. One Discovery Language {#one-discovery-language}

Items and locations should not use unrelated minigames. Both begin as bounded
hidden truth, become perceptible through Signs, produce a Lead, and then
separate revelation from access and custody.

![A fixed hidden truth progresses from latent to signed, Lead, revealed, accessible, and secured](assets/diagrams/discovery-cycle.svg)

- **Latent:** a bounded possibility exists in authoritative hidden state.
- **Signed:** a sensory tell makes it perceptible.
- **Lead:** there is a concrete opportunity to pursue or investigate it.
- **Revealed:** the result is known in shared player-visible state.
- **Accessible:** any Gate has been satisfied.
- **Secured:** the item has custody, the route has a reliable return, or the
  knowledge has a durable record.

Not every discovery uses every state. A loose apple begins revealed and
accessible. A distant observatory might move from rumor, to smoke, to a
followed trail, to a revealed entrance, through a Gate, and finally to a
mapped return route.

::: {.rule}
**CORE RULE - Versioned shared discovery.** `discovery-procedure-v2`
implements Focused Notice, Search, Study, and Scout as one slot-bound runtime
pipeline. Before projecting an offer it freezes the claim scope, stocked
result, receipt, and any Pressure consequence. The committed projection may
record a Lead or Reveal; it cannot Open, Travel, Take, equip, materialize, or
award the result.
:::

::: {.target}
**ACCEPTED TARGET - Complete discovery coverage.** Not every existing subject
or worldpack uses a versioned Discovery Slot yet. Broader materialization,
Gate and Hazard integration, and durable anchored traversal remain rollout
work.
:::

## 15. The Notice to Scout Procedure {#notice-to-scout}

### Scene Notice: show the decision {#scene-notice}

Obvious facts and danger tells are free when a player enters or the scene
materially changes.

- A tripwire catches the lantern light.
- Cold air leaks around a panel.
- Fresh prints leave the road.
- A green stain rings a chest's keyway.

Scene Notice does not reveal the whole mechanism. It shows enough truth to
investigate, proceed, withdraw, or choose another method. Never hide the
existence of a meaningful decision behind a secret passive roll.

### Focused Notice: choose a subject {#focused-notice}

Focused Notice costs one turn and examines an exact subject or frontier
direction for unresolved Signs.

- Listen at the pantry door.
- Watch the northern tree line.
- Check the chest for anything out of place.
- Look for where the prints leave the road.

It does not create treasure or topology. It exposes only Signs authorized by
the selected discovery source.

### Search: resolve a local place {#search}

Search is local and exhaustive. It answers whether a selected feature is
empty, safe, or contains its fixed result.

With time and no danger, Search is certain. "The drawer is empty" is useful
knowledge because the drawer is now resolved and cannot be rerolled. Under
pressure, Search still resolves the truth; a check determines whether the
avatar avoids delay, noise, tired, strain, harm, separation, or another named
consequence.

### Study: interpret evidence {#study}

Study operates on known evidence. It may reveal how a mechanism works, what a
Sign implies, an item's provenance, a Gate requirement, a safer method, or a
relationship between clues. It does not stock an item, add a route, or create
a location.

### Scout: pursue geography {#scout}

Scout follows an exact geographic Lead from an eligible Anchor and advances a
bounded frontier foray. Travel moves on a known accessible route. Scout does
not replace Travel, and Travel does not discover new topology.

## 16. Discovery Slots and Fixed Truth {#discovery-slots}

A **Discovery Slot** is a bounded place in the world schema where one hidden
subject may exist. It declares:

- subject type: item, route, location, resource, mechanism, resident, or lore;
- stocking table and version;
- deterministic seed or receipt key;
- compatible Signs and Leads;
- reveal procedure;
- any Gate, Hazard, or Pressure;
- what "secured" means; and
- fallback and recovery rules if it is required.

The stocking table selects once. Its receipt freezes before reveal. Returning,
reconnecting, or repeating Search cannot choose a better result.

A required discovery needs a finite Sign budget or deterministic fallback. A
critical route cannot remain absent forever because a random event failed to
show the right clue.

::: {.rule}
**CORE RULE - Discovery is not possession.** Finding a chest does not open it.
Opening it does not reveal or Take hidden contents. Revealing a doorway does
not unlock it. Finding a route does not move the avatar. Learning about a trap
does not disarm it. Seeing a relic does not bypass carrying capacity.
:::

## 17. A Complete Discovery Example {#discovery-example}

The gardener's box has one fixed hidden item, an exact key method, and a spring
needle Hazard.

1. **Scene Notice** reveals green stain around the keyway.
2. **Focused Notice** reveals a tiny puncture beside it.
3. **Study** identifies a spring needle and shows that the exact key bypasses
   it.
4. **Open** with the exact key satisfies the Gate without triggering the
   needle; hidden contents remain unrevealed.
5. **Search** the open box, freezing its stocking receipt and revealing the
   fixed item.
6. **Take** checks carrying capacity and transfers custody.
7. The target semantic **Journal** groups the certified events into one
   coherent discovery beat.

A pressured Study could advance an approaching patrol or cost time. It cannot
reroll the item or erase the needle.

The same pattern works for a location:

1. smoke is a free Sign;
2. Focused Notice reveals its direction;
3. Study distinguishes chimney smoke from wildfire;
4. the Sign becomes a Lead;
5. Scout reveals the authorized route and orchard lodge without moving the
   avatar;
6. its warded Gate is satisfied separately;
7. Travel crosses the revealed accessible route;
8. a cairn secures a reliable return.

This is the intended symmetry: one language for learning that something is
there, another for reaching it, and a final action for keeping or returning to
it.
:::
