# Hoppy Cat: February Third, card refresh

The current card game mounts this world's `card-world.json` through
`v2/worlds/hoppycat-archive/card-bridge.json`. The red thread from Black pond
into the Halfway Tea Garden is retired. Ships for the Signal Jetty leave
Piraeus only with a Hoppy Cat thing aboard. The Red-Thread Spool starts lying
at the empty station, so a player can carry it aboard. It shows there only
while the station holds no oil (the flask resting there or carried by someone
present). If oil arrives while the spool lies there, the spool is hidden until
the oil leaves. A held spool never vanishes: once picked up it is a normal
thing everywhere, and it is gated again only when set down at the station. The
archive may stay out of reach while the oil sits at the station; there is no
fallback. Every other object starts inside the archive. The thread from the garden still leads home to the pond.
A pack landing starts with the spool on the garden table.

Open `/?pack=hoppycat-archive` to start a fresh garden game. The host
`hoppy.lonelyforest.com` selects that same opening through
`v2/card-game/pack-landings.json`. Pack links have their own local save slot.
Shared links follow the shared world's saved place. DNS and certificates are
managed separately from this browser setting.

## What returns

All 10 places, 16 residents, and 10 objects use their existing `cards.json`
IDs. The 36 generated WebP images are copied byte for byte into
`v2/card-game/assets/hoppycat-archive/`. The card game uses 26 new transparent
PNG cutouts for its characters and objects. Each cutout comes from its original
portrait or item image through the built-in image generator. The exact prompts
and file paths are in `cutout-prompts.json`. Fable now works beside Mira in the
Atelier. Residents keep their homes so every story step has a steady host.
The card game uses the authored voices through its shared dialogue service.

The card pack starts at revision 1. The earlier numeric IDs, classic journals,
model bindings, source index, and compiled classic packs retain their existing
contracts. The new card catalog enters shared play under rules version 18.
Versions 15 and 16 remain available for earlier journal records. Existing card saves
receive the new pack through the normal pack installer.

## Stories

- **February Third:** keep a correction, plant a memory seed, choose a facet,
  trace a reflection, hear Nix's pause, tie the thread, and fit the clapper.
- **The shared evening:** share the cup, paint a playbill, credit the performers,
  and stage a new forest play.
- **The invitation:** rehearse a second attempt, fill in a return card, and send
  an invitation after the bell and the performance.

Carry each tool to the person who uses it. Each story step records a saved
receipt. Later steps read those receipts. The seed, spool, clapper, and launch
card stay where the player places them. The performer credits include Piper
on flute and drums.

## Research checked on 28 October 2026

Three research agents covered the public lore, places and objects, and the
existing pack's path into the current game.

| Public source                                                                 | Finding used in this refresh                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Bubble Tea Cat](https://bubbleteacat.com/)                                   | Tea house, studio rooms, shared making, and community                                    |
| [Cathedral](https://bubbleteacat.com/what-is-cathedral)                       | Private archive, public Discoball exhibits, Not Affiliated band, and Piper's instruments |
| [About](https://bubbleteacat.com/about)                                       | Teacat name, tools, and credited work                                                    |
| [Discoball](https://github.com/HoppyCat/discoball)                            | Curated exhibits and the public Observatory                                              |
| [Discoball vision](https://github.com/HoppyCat/discoball/blob/main/VISION.md) | Reflections keep a link to the surface that produced them                                |
| [The play](https://github.com/HoppyCat/discoball/blob/main/play/wtldwis.md)   | Open chair, cooling tea, memory, and shared attention                                    |
| [Teacat](https://github.com/HoppyCat/teacat-agent)                            | Current project name and source location                                                 |

The old forest map, its animal residents, the February Third bell, and every
new quest scene are CosyWorld fiction. The existing user-designated avatar
roster remains the cast. The real public projects provide themes and credits.
The Cathedral room is a fictional public exhibit hall. Its shelves hold the
public material selected for this story.

All new scene text is original. Visuals use the project's existing generated
art and the cutouts made from it. Source branding and artwork follow the [site terms](https://bubbleteacat.com/terms).
The earlier source attribution remains in `ATTRIBUTION.md`.
