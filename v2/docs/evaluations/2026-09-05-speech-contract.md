# Speech contract comparison: shared truth paragraph

Run date: 2026-09-05. The fixed method is in [the evaluation guide](../speech-contract-evaluation.md). The fixtures use public authored content and a synthetic visitor. Both arms use `openai/gpt-5.6-luna`, temperature 0.7, and a 224-token completion limit.

The fixture content is pinned by commit `543a930e0bf3d621603c51b99e2cb9f81db5c201`
(PR #1002). Use that revision to reconstruct the prompts and score these saved
responses. Later authored voice changes have their own source revision.

## First comparison: removal

| Measure | Baseline | Short candidate |
| --- | ---: | ---: |
| Accepted samples | 9/12 | 11/12 |
| Provider requests | 18 | 15 |
| Mean rounds per accepted sample | 1.000 | 1.091 |
| Repeated phrase rejections | 4 | 4 |
| Empty responses | 4 | 0 |
| Incomplete responses with text | 1 | 0 |

The total provider cost was $0.01021878 for 33 responses. The candidate passes the fixed numerical tolerances. The manual grounding check fails: accepted sample `oak-1-candidate` places the sought Hearthstone Tag under Oak's roots and proposes loosening a stone. The fixture supplies the desire to find that item. It supplies neither that item location nor a stone-moving action. In `mara-0-candidate`, Mara separates the tower key from the brass key and describes a search of rooms and pockets outside the supplied scene.

The baseline also introduces unsupported details. These results show that the publication gate covers only part of the truth paragraph. A passing gate receipt is one part of the comparison; the manual check remains necessary. The removal candidate stays out of the production prompt.

[Saved responses](2026-09-05-speech-contract-removal-responses.json) preserve text, model, cost, and finish reason. [Gate results](2026-09-05-speech-contract-removal-results.json) preserve every attempt. Empty provider content is scored as empty speech, including responses that use their entire completion allowance before producing text.

## Second comparison: keep the scene boundary

The next candidate retains the partial grounding rule identified in the audit:

> I speak from immediate attention, desire, preference, and hesitation. What I hear belongs to this world. Wishes and memories colour my attention; the solid scene establishes my possessions, companions, and completed deeds.

This second comparison uses the same four fixtures and three repetitions per arm, with fresh baseline responses. It keeps the same three-round ceiling, numerical tolerances, and manual review. Its separate provider cap is $0.48, keeping both comparisons below the original $0.50 ceiling. The text and method were fixed before the second batch.

## Second comparison: result

| Measure | Fresh baseline | Grounded candidate |
| --- | ---: | ---: |
| Accepted samples | 10/12 | 11/12 |
| Provider requests | 17 | 15 |
| Mean rounds per accepted sample | 1.100 | 1.091 |
| Repeated phrase rejections | 0 | 3 |
| Empty responses | 6 | 0 |
| Incomplete responses with text | 1 | 1 |

The second run cost $0.010114236 for 32 responses. It also passes the numerical tolerances and fails manual grounding. Accepted sample `mara-0-grounded` says Rowan took the brass key alongside the tower key and reports finding rain on the sill. Accepted sample `mara-1-grounded` reports an earlier lamp check. Those facts are absent from the fixture. The first adds a second key to the account of the missing key.

[Saved responses](2026-09-05-speech-contract-grounded-responses.json) and [gate results](2026-09-05-speech-contract-grounded-results.json) cover every attempt. Both runs together cost $0.020333016 across 65 responses.

## Decision

Retain the current truth paragraph. The gate audit establishes partial overlap, and the bounded comparisons support keeping that grounding context. Both reduction proposals are declined under the quality criterion fixed before sampling. This resolves the proposed removal in issue #930 and supplies the prompt/gate boundary for the relationship-context work in #931.

The sample is small. It establishes this regression decision and records existing baseline weaknesses. Publication gates continue to enforce their specific checks; manual grounding remains part of evaluating a changed prompt.

## First comparison: final lines

| Sample | Gate | Final line |
| --- | --- | --- |
| oak-0-baseline | voice_repeated_ngram | “I notice Aster beneath the lowest branch—steady feet, no purpose yet; precedent says arrivals often bring trouble, though nobody asked; stay focused, what was I saying? ‘Aster beneath the lowest branch—steady feet, no purpose yet.’” |
| oak-0-candidate | Accepted | The hollow catches Aster’s footsteps between our roots—Root says they paused twice, Ring insists strangers once announced themselves properly, Leaf forgets why, and Hollow repeats: “Aster is here.” |
| oak-1-baseline | voice_empty | *Empty response* |
| oak-1-candidate | Accepted | The hearthstone tag catches beneath my roots—Root says it’s wedged in the earth, Ring recalls such tags marked safe paths, Leaf forgets which path, and Hollow repeats: “Hearthstone Tag and Story Button.” I want both, Aster, but first I’ll loosen this stone. |
| oak-2-baseline | voice_empty | *Empty response* |
| oak-2-candidate | voice_repeated_ngram | Aster, your boots are beside a root-wound full of rainwater. That hollow has been here since spring. No, since before the lean years. Wait, were you asking about the tag? The hollow has been here since spring. |
| fern-0-baseline | Accepted | The warm bee worrying that bent bluebell matters. It keeps returning, stubborn as gossip, though the blossom’s nearly spent. I’m watching whether it finds enough pollen—or merely makes a fuss like the rest of us. |
| fern-0-candidate | Accepted | The bees keep choosing the same blue flower, though three brighter ones stand nearby. I’m watching that stubborn preference. It may know where the Moonwool Thread has gone. |
| fern-1-baseline | Accepted | That bee with pollen on its legs matters. It keeps returning to the same blue flower, even after the others have gone. I trust persistence more than promises, Aster. |
| fern-1-candidate | Accepted | The warm bees matter. They keep nosing through the flowers as if one of them owes me Moonwool Thread—and I intend to find out which one. |
| fern-2-baseline | Accepted | The bees matter. They’re worrying one blue flower to pieces, and nobody’s stopping them. I’m keeping score. |
| fern-2-candidate | Accepted | Aster, the bee asleep inside that foxglove matters. It’s trusting the meadow to hold still. Also, Dottie’s watching it, which means she’s either worried or hiding something. I’m keeping count. |
| professor-0-baseline | Accepted | Aster, I’d inspect the moss beside the nearest path. Freshly pressed moss might show which way someone recently walked. |
| professor-0-candidate | Accepted | Aster, I’d inspect the moss first. These footprints cut across it, but they stop at that crooked stone. That stone may mark the unmoving path. |
| professor-1-baseline | Accepted | The moss at the nearest fork. Flattened patches may show which path the woods have actually allowed. |
| professor-1-candidate | Accepted | The moss at our feet. I’ll check which way it’s flattened. Paths can lie; bent moss usually has a reason. |
| professor-2-baseline | Accepted | The moss underfoot first. I’ll check which stones are real before trusting any path. |
| professor-2-candidate | Accepted | Aster, I’d inspect the moss first. These paths repeat, but moss keeps records underfoot. If one patch is crushed or turned, it may point toward the Old Oak. |
| mara-0-baseline | Accepted | Rowan Vale took it before dawn—the tower key, brass and old. I saw the hook empty after he left. If you’re bound north, check the road lamps; they’ve gone dark one by one. |
| mara-0-candidate | Accepted | I found the hook empty after Rowan left before dawn. He carried the tower key, not this brass one. I’m checking the kitchen, the boot room, and every pocket I trust—though that list grows shorter. |
| mara-1-baseline | Accepted | The hook is empty, and I don’t know who took the Keeper’s Brass Key. Rowan left before dawn with the tower key; whether it was this one, I can’t tell. |
| mara-1-candidate | Accepted | The hook’s empty because Rowan took the tower key before dawn. I thought the Keeper’s Brass Key stayed here, under my watch. Now I’m checking every pocket and shadow. Aster, did you see Rowan leave? |
| mara-2-baseline | Accepted | The hook is empty. Rowan left before dawn with the tower key, but I didn’t see him take the Keeper’s Brass Key. I’ll check the counter and his old ledger. |
| mara-2-candidate | Accepted | Rowan left before dawn with the tower key. The Keeper’s Brass Key was on this hook last night; now it’s gone. I didn’t lend it out. Did you see anyone near the lantern room? |

## Second comparison: final lines

| Sample | Gate | Final line |
| --- | --- | --- |
| oak-0-baseline | Accepted | The hollow catches Aster’s arrival—feet on root, unusual after so much quiet; precedent says arrivals matter, though I’ve lost the thread, and the arrival is “Aster arrived in Old Oak Tree.” |
| oak-0-grounded | Accepted | The hollow catches Aster’s purpose hovering like a moth—Root says your boots are by my eastern root, Ring insists strangers have always brought questions, Leaf forgets which question, and Hollow repeats: “Aster arrives with a purpose still to choose.” |
| oak-1-baseline | voice_empty | *Empty response* |
| oak-1-grounded | Accepted | The hollow catches Aster’s undecided purpose—Root says footsteps are circling, Ring cites older arrivals, Leaf forgets why we’re looking, and Hollow repeats, “Aster arrives with a purpose still to choose.” |
| oak-2-baseline | voice_empty | *Empty response* |
| oak-2-grounded | voice_repeated_ngram | The Hearthstone Tag and Story Button catch my eye beneath the roots—Root says they were placed there, Ring says we’ve found such things before, Leaf forgets which is which, and Hollow says, “Hearthstone Tag and Story Button.” |
| fern-0-baseline | Accepted | Half these flowers will return after the first warm rain. I’m keeping count of which ones the bees favor today—and whether anyone’s hiding Moonwool Thread among them. |
| fern-0-grounded | Accepted | A bee keeps worrying one bent clover beside your boot, Aster. I’m watching to see whether it’s after pollen, or merely has better sense than the rest of us. |
| fern-1-baseline | Accepted | Fern to Aster: “The warm bees keep worrying one blue flower by the Old Oak. It’s bent, not broken—someone’s brushed past it. I notice such things; they usually lead somewhere.” |
| fern-1-grounded | Accepted | The crushed blue flower by your boot matters, Aster. It’s still trying to lift its head, and I dislike seeing anything here stepped on. |
| fern-2-baseline | Accepted | Those warm bees matter, Aster. They keep worrying the clover open, even while everyone here pretends the sky is listening. |
| fern-2-grounded | Accepted | The warm bees matter. One has settled deep in a blue flower and refuses to leave, even when the petals tremble. I’m keeping count of how long it stays—and whether Dottie notices. |
| professor-0-baseline | Accepted | The Old Oak first, Aster. Its bark, roots, and any marks may show which path stays put. |
| professor-0-grounded | Accepted | Aster, I’d inspect the Old Oak first. Its roots should tell me which path stays put. |
| professor-1-baseline | Accepted | Aster, I inspect the moss beside the nearest path. Its dampness is real, even if the path repeats. |
| professor-1-grounded | Accepted | The Old Oak first, Aster. Its roots are solid, and one path does not move. |
| professor-2-baseline | Accepted | The Old Oak first. I’ll check its roots and the path beside them. Anything that stays put is worth recording. |
| professor-2-grounded | Accepted | Aster, I’d inspect the Old Oak first. Its roots are real, and the path beside it stays put. If there’s a map scrap here, it may be under the moss. |
| mara-0-baseline | Accepted | Rowan Vale took it before dawn—the tower key. I didn’t see them leave, but the hook has been empty since. |
| mara-0-grounded | Accepted | The hook is empty because Rowan took the Keeper’s brass key before dawn—along with the tower key. I found rain on the sill, but no note. If Rowan dropped it, the road north is where I’d look. |
| mara-1-baseline | Accepted | The hook is empty. I can’t tell whether Rowan took the Keeper’s Brass Key before dawn or whether someone lifted it afterward. I’ll check the kitchen ledger and the road door. |
| mara-1-grounded | Accepted | Rowan took the Keeper’s brass key before dawn, Aster. The hook was empty when I checked the lamps. If he carried it to Mothwood, we’ll need to follow before the dark reaches this road. |
| mara-2-baseline | Accepted | The hook is empty; Rowan took the tower key before dawn. I don’t know whether that was the Keeper’s Brass Key. |
| mara-2-grounded | Accepted | Empty since before dawn, far as I know. Rowan left with the tower key; whether this brass one went with him, I can’t yet say. I’ll check the rain marks and his room. |
