# Worldpack design

Status: tentative public design reference.

A CosyWorld worldpack is a bounded world with its own promises, places,
characters, factions, items, rules context, and durable consequences. The pack
authors the facts and constraints that make the world itself. Runtime
simulation may combine those facts into new situations, and reviewed
generators may propose bounded connective content, but neither can silently
rewrite the pack's authority.

Start here:

- [How to Design a Worldpack](how-to-design-a-worldpack.md) is the reusable
  design method and authoring checklist.
- [Location Classes, Development Projects, and Buildings](../location-development.md)
  defines the shared Cairn, class, typed-slot, project-level, and civic-agency
  contract that developable places must follow.
- [ADR 0007: Model Bindings and Item Devices](../decisions/0007-model-bindings-and-item-devices.md)
  defines when an exact model embodies an actor and when it powers a portable,
  equipped, or installed item device.
- [Construction, Place Development, and Route Discovery](construction-and-routing-discovery.md)
  distinguishes that accepted direction from the generated-place behavior
  currently shipped.
- [Project 89 Systems Study](project-89-systems-study.md) applies the method to
  the proposed three-ring Project 89 world.
- [Project 89 Content Review](project-89-content-review.md) reviews the story,
  avatars, residents, factions, items, locations, maps, relationships, and
  remaining design risks as one playable whole.
- [Worldpack Machine Contract](https://github.com/cenetex/cosyworld/blob/main/v2/docs/worldpacks.md)
  documents the current manifest, compiler, registry, generation, and runtime
  authority boundary.
- [Project 89 Worldpack Design](https://github.com/cenetex/cosyworld/blob/main/v2/docs/project-89-worldpack.md)
  records the source research, Proxim8 integration, authored inner loop, and
  item list.
- [Project 89 Three-Ring Map](https://github.com/cenetex/cosyworld/blob/main/v2/docs/project-89-world-map.md)
  records the proposed topology and unlock contract.

These pages deliberately distinguish **canon**, **proposal**, and **open
question**. A useful early design can be specific without pretending that
unapproved names or mechanics are settled.
