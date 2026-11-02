# The Open Door

Dione's table opens the stories of five places: the Athenian Agora, Piraeus
Quays, Colonus Grove, Eleusinian Sanctuary and Marathon Altar. Piraeus Quays
lies outside the section: a ship with the Travel Provisions aboard reaches it
from the Wine-Dark Harbor in any save, but its roads inland and Thaleia's
work wait for the invitation. Athens has three districts of at most four
places each: the countryside (Eleusis, Colonus, Marathon and the Attic Farm,
with Acharnae Market within it), the city (the Agora, Assembly Hill, the
Acropolis and the Thinkery, with the House of Demos and the Women's Festival
within) and the harbour (Piraeus, which took in Athens Harbor). Places in a
district link directly. Two gate roads join the districts. The Sacred Way
leads from Eleusis into the city once the mothers' petition is at Eleusis
or in the Agora. The Long Walls lead from the Agora to Piraeus once the
herald's truce is in the Agora. A gate stays open once opened, for everyone
in that world, even after its thing moves away. It blocks only the way out:
the way back is always open. These
routes share Dione’s lasting invitation. Waiting at a port lets the empty ship complete its circuit.

The opening invitation follows the public account of any of the four
Theban responses: burial, permission, refusal or warning. Accepting the
invitation records `greek-open-door-open`. The choice and its reason remain
part of the saved history. The region remains open for later visits.

## The five places

| Place    | People                                             | Work in this release                                                                                   |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Agora    | Theseus; the existing Agora neighbor               | Receive the mothers' petition, choose a civic response, then hear the report.                          |
| Piraeus  | Thaleia, an original quay host                     | Prepare supplies, carry cloth to Eleusis, receive the families' return list and reserve a berth.       |
| Eleusis  | Aethra, Adrastus, an original chorus mother, Iphis | Hear the plea, prepare the funeral, place the ashes and choose the care carried forward.               |
| Colonus  | An original grove keeper                           | Hear an earlier named tale, bring water and honey, then place a tablet for the grove's present custom. |
| Marathon | An original altar keeper                           | Hear a separate generation's tale, bring a blanket and choose which ending the keeper tells.           |

Residents stay in their authored places. The mother joins the visible scene
after the recovery report. Iphis joins after the pyre account. Each introduced
person remains available, with their earlier conversations intact.

## The mothers' road

The central episode adapts Euripides' _Suppliant Women_. It takes place after
the attack on Thebes. The traveler's earlier action for Antigone remains true.
Greek revision 15 plays it without story buttons: meeting someone tells
their part, Waiting beside the right things does a deed, and giving
someone a thing is the gift the story needs.

1. At Eleusis, meeting Aethra tells the mothers' request, and Adrastus owns
   his failed expedition at the next play. Take their petition.
2. At the Agora, give Theseus the petition. The city takes up the claim, and
   the herald's truce (`greek-olive-branch`, which keeps the branch's ID)
   appears in the Agora. The next play there hears the herald's return: the
   remains reached Eleusis under witness.
3. At Piraeus, meet Thaleia. Wait at the quay with the basket there. Carry
   the clean cloths to Eleusis.
4. At Eleusis, Wait with the cloths there. The attendants perform the
   funeral and the urn appears. Give the urn to the Argive mother. Aethra
   writes the Pyre Account and the households' return list.
5. The next play hears the further loss at the pyre. Evadne died despite
   Iphis's plea. The children carry ashes and speak of vengeance. Aethra
   also names the source play's closing oath and Athena's promise of
   another war.
6. Give Thaleia the return list at Piraeus, with the basket resting at the
   quay. She reserves the berth for the listed households.

The plea records `greek-open-door-recovery=truce` and the berth
`greek-open-door-berth=family`. The armed recovery, the Eleusis pledge and
the open berth were attitude forks; they are gone (the redesign's owner
decision 2 lets a fork return as an item quest).

The original adaptation moves the public hearing to the Agora. Thaleia,
the quay work, the traveler's petition, the negotiated truce and the closing
care choices are original connective scenes. The play supplies the mothers,
Aethra, Adrastus, Theseus, the recovery dispute, Evadne, Iphis, the funeral,
the children and the closing oath.

## The earlier tale at Colonus

The keeper names the time before beginning: this is Sophocles'
_Oedipus at Colonus_, before the Theban brothers' deaths.

- **Arrival:** Oedipus reaches the grove with Antigone. Theseus grants refuge.
- **Offering:** the traveler places a real cup of water and pot of honey
  at the present grove. The keeper recalls the rite performed by Ismene.
- **The daughters and son:** the keeper tells of Creon's seizure of the
  daughters, Theseus's recovery of them, and Polyneices's failed appeal.
- **The ending:** Oedipus entrusts his final place to Theseus. The daughters
  mourn and seek their return to Thebes. The king keeps his promise.
- **A present custom:** carry the refuge tablet from the Agora and Wait at
  the grove with it. The keeper records the grove's welcome on it.

Meeting the keeper tells each part of the tale; Waiting beside the cup and
honey is the offering. The player's gift and tablet are current deeds. The keeper's account is a named
memory. The ending preserves the resting place entrusted to Theseus alone.

The full Storr text and the Center for Hellenic Studies text support the
closing scenes. The MIT web page ends during the earlier action.

## A separate generation at Marathon

The keeper names Euripides' _Children of Heracles_, after Heracles's death,
under Demophon, son of Theseus. This frame keeps the rulers and the children
in their own generation.

- **The claim:** Iolaus and the children seek sanctuary. The herald uses
  force. Demophon upholds their protection.
- **Present care:** carry the blanket from Piraeus. Place it at the altar
  for people who seek shelter there today.
- **The daughter's voice:** hear the oracle's demand, Demophon's refusal
  to compel a household, and the daughter's own reasons for offering her
  life. The source-facing copy calls her Heracles's daughter.
- **The battle:** hear the sacrifice, the victory and the capture of
  Eurystheus. The messenger separates his sight of the battle from the
  reported wonder of Iolaus's renewed youth.
- **The prisoner:** hear Alcmene's claim, the city's rule for a captive
  taken alive, and Eurystheus's reply.
  The keeper tells the source ending with it: Alcmene orders the captive
  away to die. The Marathon Record appears at the altar.

Meeting the keeper tells each part; Waiting with the blanket at the altar is
the present care. The blanket is a present object with its actual holder and
placement.

## Return and verse

Each branch ending earns a short authored couplet. The Bard's saved recital
records the traveler and the event order. The poem distinguishes a gift
from a report, a prepared berth from an arrival, and a heard tale from a
present deed. [`lore/bard-couplets.json`](lore/bard-couplets.json) keeps
every exact couplet as lore; the Bard's prompt does not carry them.

Each story ends with an outcome item: the herald's truce, the Funeral
Account, Myrine's signed return list, the refuge tablet and the Marathon
Record. Giving one to Dione is that story's report; it stays on her table and
earns its couplet. With all five on her table, the next play there shares the
full Open Door account. Its couplet is:

> I brought those names beside her bread.  
> We made room for the words they carried.

The six quest families are `story-quest-greek-open-door-eleusis`,
`-agora`, `-piraeus`, `-colonus`, `-marathon` and `-return`.

## Myrine’s journey and answer

Myrine of Argos is an original household representative. She helped the
mothers at Eleusis. She speaks for her own household and the care she sees.
She appears after the ashes are in the mothers' care.

Once a berth has been reserved, meeting her at Eleusis is her agreement to
walk with a traveler to Piraeus. One ordinary **Accompany** action takes them along
the shore path. Myrine’s position is saved. Another traveler from the same
company can take up the agreed journey. She waits for company before
leaving and remains at the quay after arriving.

At the quay, give Myrine the basket. With it in her hands and the return
list at Piraeus, she receives her household's reserved care. The arrival
records `greek-homecoming-arrived`. Myrine signs the return list with her
account of that care. A list carried away early can be returned to the quay
before the arrival.

Give Dione the signed list. It stays on her table. Myrine remains at the
quay; the carried list supplies her voice at the table.

These scenes add three story families: `story-quest-greek-homecoming-return`,
`-household` and `-witness`. Each early return keeps its own local story
record. The original full Open Door return remains a separate gathering
of the whole account.

Myrine, her agreed walk, her care and her signed reply are original
CosyWorld scenes. The play’s recovery, funeral and difficult ending remain
the source events described above. Only Myrine’s own arrival is recorded
in this follow-through; she represents the household whose care she claims.

## Saved facts and object care

Every story step fires from a fixed verb: `on: "meet"`, `on: "wait"` or
`on: "give"`. The meetings are Talk in the redesign; each becomes
`on: "talk"` when that trigger lands (#1611). `choose` records a branch,
`set_flag` records a deed or heard report, and a gift places the thing at
the named place. Choice receipts
make each step repeatable through replay and unique within the history.

Eleven authored objects support the routes: the mothers' petition, clean
cloths, quay basket, funeral urn, return list, grove cup, grove honey,
shelter blanket, refuge tablet, Pyre Account and Marathon Record. Source
reports introduce the urn after the funeral and the return list after the
ashes. Myrine’s
arrival adds her signature to that same list. Its holder stays part of the
world through the journey to Dione.

The old source IDs remain available for earlier histories. The three works'
current entry lists name the finished actions in this release. Shared and
local saves keep their existing Theban choices, residents, possessions,
receipts and poem. Older full-scope worlds retain their travel access.

## Sources

- [Euripides, Suppliant Women](https://classics.mit.edu/Euripides/suppliants.html).
- [Euripides, Children of Heracles](https://classics.mit.edu/Euripides/heracleidae.html).
- [Sophocles, Oedipus at Colonus, Storr translation](https://www.gutenberg.org/files/31/31-h/31-h.htm).
- [Sophocles, Oedipus at Colonus, Center for Hellenic Studies](https://www-current.chs.harvard.edu/primary-source/sophocles-oedipus-at-colonus-sb/).

All game descriptions, action text and verses are original CosyWorld
writing. [Attribution](ATTRIBUTION.md) records the wider repertoire.
