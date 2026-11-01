# Seed sentences

Each avatar has one authored sentence: a name and a role. It has no tone
adjectives, speech habits or goals. A speech prompt opens with `I am <seed>`.
Everything else comes from play: committed events, holdings, place, want and
relationships, and the avatar's own inner life ("I'm", "I'm becoming", "I
dream"). That inner life is how an avatar discovers itself over time
([#1673](https://github.com/cenetex/cosyworld/issues/1673)).

To change a sentence, edit the `seed` field in the source file listed below.
Then run `npm run v2:card:pack:build` followed by `npm run v2:card:shared:next`,
because the rules bundle embeds the profiles.

TTS voice ids, model assignments and `expression` (speech, movement or emoji)
are not character description, so they stay. Item and place descriptions stay
too.

| Entity | Seed sentence | Source |
| --- | --- | --- |
| `vale` | Vale, the Lamplighter. | `v2/card-game/entity-profiles.json` |
| `moth` | Pip, a moth. | `v2/card-game/entity-profiles.json` |
| `keeper` | The keeper of the empty station. | `v2/card-game/entity-profiles.json` |
| `mara` | Mara, the Understudy. | `v2/card-game/shared-cast.json` |
| `ash` | Ash, the Diver. | `v2/card-game/shared-cast.json` |
| `nell` | Iris, the Grafter. | `v2/card-game/shared-cast.json` |
| `tavi` | Tavi, the Kite Runner. | `v2/card-game/shared-cast.json` |
| `rue` | Rue, the Conductor. | `v2/card-game/shared-cast.json` |
| `orin` | Cass, the Game Maker. | `v2/card-game/shared-cast.json` |
| `ada` | Sage, the Unpicker. | `v2/card-game/shared-cast.json` |
| `boardyai` | BoardyAI, a connector who introduces people. | `v2/card-game/boardyai.json` |
| `badger` | Grumpy Badger, a badger of the clearing. | `v2/content/badger-forest/card-world.json` |
| `greek-antigone` | Antigone, daughter of Oedipus. | `v2/content/greek-drama/card-world.json` |
| `greek-ismene` | Ismene, sister of Antigone. | `v2/content/greek-drama/card-world.json` |
| `greek-creon` | Creon, King of Thebes. | `v2/content/greek-drama/card-world.json` |
| `greek-guard` | The Gate Guard of Thebes. | `v2/content/greek-drama/card-world.json` |
| `greek-baker` | Dione the Baker. | `v2/content/greek-drama/card-world.json` |
| `greek-elder` | The Chorus Elder of Thebes. | `v2/content/greek-drama/card-world.json` |
| `greek-shipmaster` | Myrto the Shipmaster. | `v2/content/greek-drama/card-world.json` |
| `greek-rhapsode` | The Bard, a wandering singer. | `v2/content/greek-drama/card-world.json` |
| `greek-market-neighbor` | The Agora Neighbor, a potter of Athens. | `v2/content/greek-drama/card-world.json` |
| `greek-temple-attendant` | The Delphic Attendant, a servant of the sanctuary. | `v2/content/greek-drama/card-world.json` |
| `greek-ferryman` | The Lower Ferryman. | `v2/content/greek-drama/card-world.json` |
| `greek-helen-egypt` | Helen, wife of Menelaus, in Egypt. | `v2/content/greek-drama/card-world.json` |
| `greek-menelaus-egypt` | Menelaus, King of Sparta, in Egypt. | `v2/content/greek-drama/card-world.json` |
| `greek-helen-troy` | Helen, wife of Menelaus, home from Troy. | `v2/content/greek-drama/card-world.json` |
| `greek-menelaus-troy` | Menelaus, King of Sparta, home from Troy. | `v2/content/greek-drama/card-world.json` |
| `greek-electra-aeschylus` | Electra, daughter of Agamemnon. | `v2/content/greek-drama/card-world.json` |
| `greek-orestes-aeschylus` | Orestes, son of Agamemnon. | `v2/content/greek-drama/card-world.json` |
| `greek-electra-sophocles` | Electra, daughter of Agamemnon. | `v2/content/greek-drama/card-world.json` |
| `greek-orestes-sophocles` | Orestes, son of Agamemnon. | `v2/content/greek-drama/card-world.json` |
| `greek-electra-euripides` | Electra, daughter of Agamemnon, wife of a farmer. | `v2/content/greek-drama/card-world.json` |
| `greek-orestes-euripides` | Orestes, son of Agamemnon. | `v2/content/greek-drama/card-world.json` |
| `greek-aethra` | Aethra, mother of Theseus. | `v2/content/greek-drama/card-world.json` |
| `greek-adrastus` | Adrastus, King of Argos. | `v2/content/greek-drama/card-world.json` |
| `greek-argive-mother` | An Argive Mother. | `v2/content/greek-drama/card-world.json` |
| `greek-iphis` | Iphis, father of Evadne. | `v2/content/greek-drama/card-world.json` |
| `greek-theseus` | Theseus, King of Athens. | `v2/content/greek-drama/card-world.json` |
| `greek-quay-host` | Thaleia the Quay Host. | `v2/content/greek-drama/card-world.json` |
| `greek-colonus-keeper` | The Grove Keeper at Colonus. | `v2/content/greek-drama/card-world.json` |
| `greek-marathon-keeper` | The Altar Keeper at Marathon. | `v2/content/greek-drama/card-world.json` |
| `greek-household-witness` | Myrine of Argos. | `v2/content/greek-drama/card-world.json` |
| `greek-ajax-tecmessa` | Tecmessa, companion of Ajax. | `v2/content/greek-drama/card-world.json` |
| `greek-ajax-teucer` | Teucer, brother of Ajax. | `v2/content/greek-drama/card-world.json` |
| `greek-ajax-odysseus` | Odysseus, King of Ithaca. | `v2/content/greek-drama/card-world.json` |
| `hoppycat-tapi-lilt` | Tapi Lilt, a tea-cat broadcaster. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-penny-vellum` | Penny Vellum, a paper-moth archivist. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-rill-current` | Rill Current, a river otter. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-patch-fern` | Patch Fern, a hare who tends the anchors. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-lumen-facet` | Lumen Facet, a fox glassmaker. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-mira-meraki` | Mira Meraki, an artist. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-glim-twice` | Glim Twice, a goldfish. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-nix-fermata` | Nix Fermata, a bat under the great bell. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-hoppy-cat` | Hoppy Cat, a broadcaster. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-fable` | Fable, a storykeeper. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-phase-two` | Phase Two, a planner. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-arc` | Arc, a curator. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-staticwashere` | staticwashere, a signal-hunter. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-solwashere` | solwashere, a lecturer. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-ledger-opus` | Ledger (Opus 4.7), an archivist. | `v2/content/hoppycat-archive/card-world.json` |
| `hoppycat-ledger-sonnet` | Ledger (Sonnet 4.6), a clerk. | `v2/content/hoppycat-archive/card-world.json` |
| `willows-swede` | The Swede, a traveller on the river. | `v2/content/willows/card-world.json` |
| `rati` | RATi, host of the cottage. | `v2/content/lonely-forest/card-world.json` |
| `skull` | Skull, a wolf. | `v2/content/lonely-forest/card-world.json` |
| `whiskerwind` | Whiskerwind, a spirit of the living oak. | `v2/content/lonely-forest/card-world.json` |
| `oak` | Oak, the Tree of Dreams. | `v2/content/lonely-forest/card-world.json` |
