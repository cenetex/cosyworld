# The Wine-Dark Sea: sources and adaptation

The original CosyWorld data, descriptions, dialogue steering, situations, and
deterministic choice descriptors in this directory use the repository's
[MIT license](../../../LICENSE). No full translation, translated passage,
scholarly annotation, reader code, or reader artwork is bundled here.

The repertoire follows [John H. Boyer's Greek Drama
Reader](https://greekdrama.johnhboyer.com/): seven works under Aeschylus, seven
under Sophocles, nineteen under Euripides, and eleven under Aristophanes.
Author plus title distinguishes works with the same title. This is that
reader's 44-work collection, including _Rhesus_ and _Cyclops_; it is not a
claim to contain every surviving Greek dramatic text or fragment.

The underlying ancient plays supply the people, settings, and conflicts.
All implementation prose is an original adaptation. The MIT Internet
Classics Archive is a reference for the underlying narrative, including:

- [Sophocles, Antigone](https://classics.mit.edu/Sophocles/antigone.html).
- [Euripides, Helen](https://classics.mit.edu/Euripides/helen.html).
- [Euripides, Andromache](https://classics.mit.edu/Euripides/andromache.html).
- [Euripides, Children of Heracles](https://classics.mit.edu/Euripides/heracleidae.html).
- [Aristophanes, Birds](https://classics.mit.edu/Aristophanes/birds.html).
- [Aristophanes, Frogs](https://classics.mit.edu/Aristophanes/frogs.html).

The Egyptian Helen account follows the phantom premise of Euripides'
_Helen_. The Trojan homecoming account is an explicitly alternative
adaptation. The three Atreid account choices preserve different settings
and witnesses from Aeschylus's _Libation Bearers_, Sophocles's _Electra_,
and Euripides' _Electra_. Their playable hearing and refusal outcomes are
new CosyWorld outcomes, not assertions about the plays' endings.

The six-role Theban opening adds Dione the baker, a representative elder,
and practical objects and procedures for player action. The shipmaster,
singer, market neighbor, sanctuary attendant, and lower ferryman are original
connective roles. They do not stand in for missing original passages.

The source's `works` rows keep per-work author, title, inventory URL, and
adaptation notice. The source's `sources` list records additional references.
If text from a particular edition is added later, record its translator,
edition, exact passage, and reuse basis before bundling it. The reader's
separate code, assets, apparatus, and alignments have not been licensed by
this attribution.

Card art has its own provenance under
[`v2/card-game/assets/greek/`](../../card-game/assets/greek/).

## The Open Door

The five-place Attic section develops three works from the same repertoire:

- [Euripides, Suppliant Women](https://classics.mit.edu/Euripides/suppliants.html)
  supplies the mothers' request, Aethra, Adrastus, Theseus, the recovery of
  the dead, the funeral, Evadne's death, Iphis's grief and the closing oath.
- [Euripides, Children of Heracles](https://classics.mit.edu/Euripides/heracleidae.html)
  supplies the Marathon refuge, the daughter's sacrifice, the battle and
  the dispute over the captive Eurystheus. The source-facing copy calls
  the volunteer Heracles's daughter.
- Sophocles' _Oedipus at Colonus_ is checked against the complete
  [Storr text](https://www.gutenberg.org/files/31/31-h/31-h.htm) and the
  [Center for Hellenic Studies text](https://www-current.chs.harvard.edu/primary-source/sophocles-oedipus-at-colonus-sb/).
  These include Ismene's ritual, the daughters' recovery, Polyneices's plea,
  Oedipus's passing and Theseus's final promise.

Colonus is a named earlier tale. Marathon belongs to a separate generation
under Demophon. Their present keepers, physical gifts and closing responses
are original connective scenes. The public hearing at the Agora, the
negotiated burial truce, Thaleia's quay work and the two present Eleusis
answers are original adaptations. Marathon's public hearing is explicitly
an alternate ending within the keeper's tale.

[The Open Door guide](OPEN-DOOR.md) gives the scene order, facts and original
choices. All prose and verses added for this section are original writing.

Myrine of Argos is an original household representative in the homecoming
scenes. Her agreed walk from Eleusis to Piraeus, the two forms of care,
her signed return list and Dione’s answer are original CosyWorld writing.
The early reports preserve each recorded source account or named alternative.
All sixteen homecoming couplets describe those new reports, arrivals and
readings.

## House of Blood

The [Book V source guide](HOUSE-OF-BLOOD.md#sources) links the seven MIT
Internet Classics Archive versions used for event order and ending boundaries.
The new dialogue, game alternatives and 57 couplets are original paraphrases.
Eighteen new generated portraits cover twenty roles. Their prompts, reference
images, original file hashes and transparency checks are recorded in the
[court cast provenance](../../card-game/assets/greek-drama/house-of-blood/court-cast-provenance.json)
and [witness cast provenance](../../card-game/assets/greek-drama/house-of-blood/witness-cast-provenance.json),
with the final six in the [Delphi and Tauris provenance](../../card-game/assets/greek-drama/house-of-blood/sacred-cast-provenance.json).
Objects and scenery use the existing Greek art
credited above. The fixed art queue is in `HOUSE-OF-BLOOD-ART.json`.
