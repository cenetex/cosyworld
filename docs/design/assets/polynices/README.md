# Polynices burial art design

Design studies for [issue #2290](https://github.com/cenetex/cosyworld/issues/2290).
The owner asked for a cohesive burial set and then chose a single perfectly
formed raven feather for the shroud and grave on 2026-11-04.

## The shared direction

The sequence is a visible act of care: fallen, anointed, veiled, and buried.
Four states give the oil its own clear effect. Each card shares one high camera,
one body position, the same helmet, shield, stones, and light direction.

Polynices is a young adult with black curls and features close to Antigone.
His bronze armour has a small leaf decoration and two round shoulder fittings.
His muted red cloak, helmet with a dark crest, and open resting hand establish
his identity. The standing shade carries that same face and costume.

The bent olive, sheltered shelf, right-hand path, and distant Thebes anchor the
Hollow. The lower middle stays open for the separate cast. Day uses amber and
earth umber; night uses blue-grey moonlight. The grave's night version will add
one small clay lamp.

## Current design studies

![The four burial states](states-review.png)

| Step | Main visual change | Selected study |
| --- | --- | --- |
| Fallen | Dust-dulled armour, closed eyes, open hand, crow on shield | [Fallen](fallen-card-study.png) |
| Anointed | Clean face and hands, plain linen, armour set beside him, empty oil jug | [Anointed](anointed-card-study.png) |
| Veiled | Full bone-white shroud with a careful face fold and one raven feather | [Veiled](veiled-feather-study.png) |
| Buried | Low long mound, helmet marker, small cup, the same raven feather | [Buried](grave-feather-study.png) |

The feather is complete and neatly formed, deep black with a soft blue-green
sheen. It lies on the chest in the veiled card and over the same part of the
grave. This is the owner's chosen symbol of care. The bent olive remains part
of the place.

The removed armour and folded cloak stay beside the shield through the later
states. The existing oil jug is reused, with its stopper beside it. A future
white-ground flask should replace that same vessel consistently across the set
if selected.

![The Hollow, shade and phone crop](place-shade-review.png)

- [Hollow day](hollow-day-refined-study.png): the selected master study.
- [Hollow night](hollow-night-study.png): an edit of that daytime master.
- [Polynices' shade](shade-study.png): a gentle pleading face, open hand,
  pale moonlit colour, faded rose cloak, and fading feet.
- [Prompts](prompts.json) and [file checks](validation.json): full source records.

## Production plan

Use the selected day view as the master for the four Hollow states. Make every
night view from its matching day state. Keep the body on its shelf and the
standing space in the lower middle. The helmet is the grave marker throughout.
Use the card studies as the references for each change of body state.

| Group | Final files | Target |
| --- | --- | --- |
| Hollow | fallen, anointed, veiled, grave; each day and night | 8 opaque WebPs, 1672 × 941, quality 94 |
| Body cards | fallen, anointed, veiled, grave | 4 RGBA WebPs, 1024 × 1536, full painted vignette |
| Shade | polynices-shade.png | 1 RGBA PNG, 1024 × 1536 |
| Optional vessel | oil-lekythos.png | 1254 × 1254 RGBA PNG |

The wheat sack remains the separate immediate asset in #2290. Patroclus is in
[PR #2289](https://github.com/cenetex/cosyworld/pull/2289).

## Review and finishing

The four card states, day/night views, and shade overlay were reviewed together.
The phone study uses a proposed horizontal focus of 28% so the body and helmet
stay within the crop. Live placement still needs the game viewport review.

The generated shade has clear background alpha and a fade through its feet.
Its face and torso samples are near opaque (253/255). The review places that
source at 65% opacity to show the intended translucent look. Production needs
to put that see-through treatment into the final asset or its existing figure
rendering. The full alpha measurements are in the file checks.

These are design studies. Production finishing covers the remaining six Hollow
state views, close registration between state edits, the shade's body opacity,
final exports, and game asset registration. The generated edits preserve the
composition visually; fine texture varies between images.

The source PNGs are preserved byte for byte. All generation used the built-in
image tool. Earlier olive-sprig studies and the first day study remain as source
history. The selected versions above carry the owner's raven-feather change.

Checks: PNG sizes and hashes, shade alpha samples, visual full-width and phone
reviews, `git diff --check`, and `npm run check:version`.
