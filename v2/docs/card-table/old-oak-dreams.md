# The Old Oak's tree of dreams

Status: Later. Design folded from
[#1468](https://github.com/cenetex/cosyworld/issues/1468) on 2026-11-01. A
layered dream chain at the Old Oak in the Lonely Forest: Mandarin → French →
English. It builds on #1467 (inner life as "I'm", "I'm becoming", "I dream")
and lands after #1467's rule-made dreams and one-call reflection.

## The owner's words

> i actually want this in the oak too - an inner "tree of dreams" an "old oak tree avatar" and skull, whiskerwind, rati should be its own avatars taking the dreams of the tree in french of dreams via the dreams of the old oak in mandarin and the actions of the avatars in english

Their example of the Tree of Dreams speaking French:

> Les rêves de l'Arbre des Rêves... (je murmure à voix basse) Les souvenirs de mes millénaires de présence ici sont une réserve illimitée de secrets et d'énigmes… Mon dernier rêve… Je vis moi-même être planté ici… un loup gris apparut… 'La vérité est dans les racines'… Votre tour maintenant, cher voyageur... Quels secrets voulez-vous dévoiler ?

Refinement (2026-10-30):

> but they shouldn't talk to the oak or the tree lets say only rati whiskerwind and skull can eg oak card only appears when one+ is at the old oak and tree of dreams requires all 3 in the roots (a new location)

**Decided:** the Old Oak's Mandarin and the Tree's French are never
translated. They are a mystery to decipher. Players do not talk to the Old Oak
or the Tree of Dreams. Only RATi, Whiskerwind and Skull can. The three avatars
carry the dreams up into English deeds and speech, and that is the only way
the player learns of them. In the room transcript the Oak's and the Tree's
lines appear untranslated; the player may overhear, not converse.

## Layers

| Layer | Avatar | Place | Dreams in | Who can engage it |
|---|---|---|---|---|
| Deepest | Old Oak | Old Oak Tree (`forest-oak`) | Mandarin | RATi, Whiskerwind, Skull; its card shows only when at least one of them is at the Oak |
| Middle | Tree of Dreams (new) | the Roots (new place beneath the Oak) | French, re-dreaming the Oak's dream | RATi, Whiskerwind, Skull; it appears only when all three are in the Roots |
| Surface | RATi, Skull, Whiskerwind | cottage, trail, garden, the Oak and the Roots | the Tree's French dream; deeds and speech in English | the player, as today |

## Today

- `rati`, `skull`, `whiskerwind` and `oak` are pack avatars in
  `v2/content/lonely-forest/card-world.json`, all `travels: false`. Skull's
  expression is `movement` and Whiskerwind's is `emoji`. Oak is
  `presentation: backdrop` and its persona already calls it "the waking body
  of the Tree of Dreams", with Root, Ring, Leaf and Hollow as rooted voices.
- There is no Roots place, no Tree of Dreams entity, no condition that tests
  where an avatar is, and no avatar reads another avatar's dreams.
- There is no language support: no language field on profiles, pack avatars
  or `voices.json`, and every prompt is English. `voices.json` has no Lonely
  Forest voices.

## Proposed model

1. **Pack data.** Rename `oak` to Old Oak (keep the id). Add the avatar
   `tree-of-dreams` at a new place `forest-roots` beneath the Oak, with art.
   Set the three walkers to `travels: true` with the dusk return already in
   the receipts ("walk back to [the oak] at dusk").
2. **Reaching the Roots.** A crossing `forest-oak ↔ forest-roots`, closed
   until a condition holds (owner call: the three have each visited the Oak,
   Hollow has repeated a line from each, or the dusk return). Proposed: the
   player may enter as a witness.
3. **Presence-gated cards (generic).** A new condition
   `{kind: "avatars_present", avatars, minimum, place}` and avatar fields
   `appearsWhen` (out of the cast when false) and `speaksWith` (who may Talk;
   the player excluded). Old Oak uses `minimum: 1` at `forest-oak`; the Tree
   uses `minimum: 3` at `forest-roots`. Rules version and engine rebuild.
4. **Dream flow.** `dreamsFrom` adds the latest dream of a named avatar as a
   seed source, taken only when the dreamer last shared a place with it:
   `tree-of-dreams: ["oak"]`, the three walkers `["tree-of-dreams"]`. Rules
   copy words, never translations; the English "I'm becoming" call turns the
   French fragments into English meaning. Deterministic and journaled like
   #1467's dreams.
5. **Language as data.** `dreamLanguage` and `speechLanguage` (BCP-47,
   default `en`): Oak `zh`, Tree `fr`, the walkers speak `en`. A small
   authored `dreamWords` lexicon per pack in `zh` and `fr`. Model lines get a
   cue in the language (`老橡树，我正在成为：`, `L'Arbre des Rêves, je deviens :`)
   and a guard rejects an English reply to a `zh` or `fr` cue.
6. **Voices.** Lonely Forest voices for the Old Oak (Mandarin), the Tree
   (French) and RATi, with a per-voice `language` in the cache key.

## Build order

1. Presence-gated cards, generic, no Lonely Forest content.
2. The Roots and the Tree of Dreams (content, art, save upgrade).
3. Language as data.
4. Dream chain (`dreamsFrom`, lexicon, replay and client/server agreement
   tests). Needs #1467's rule-made dreams.
5. Voices.
6. Card guide and Lonely Forest guide updates.

Walking residents need a reason to go to the Oak, so this also touches the
quest model (possibly a starter quest for Skull and Whiskerwind).

## Open questions for the owner

1. How is the Roots reached, and can the player enter it and witness the Tree?
2. Does the player see the untranslated lines when the three talk to the Oak
   or the Tree, or only the English aftermath?
3. Do Whiskerwind (emoji) and Skull (movement) stay as they are, or does
   Whiskerwind gain words?
4. Do Root, Ring, Leaf and Hollow stay (now in Mandarin), merge into one Old
   Oak voice, or move into the Tree of Dreams? Does Hollow leak the Oak's
   dream to the three?
5. Is the walk to the Oak and the Roots a daily rhythm, a quest, or
   player-led?
6. Can a player who controls one of the three talk to the Oak or the Tree?
7. In "I dream", are the three's fragments shown in French, or only their
   English "I'm becoming"?
8. Authored zh/fr dream words (deterministic), or a model-written dream at
   larger tiers (#1467 open question 1)?
