# Full avatar artwork in authoring cards

Dino's supplied portrait is a wide PNG. The card's cover fit cropped its face
and tail. The authoring tree now fits the complete image inside the existing
avatar card. Portraits keep their aspect ratio, source bytes and transparency.

The shared renderer sets the existing art element's `data-kind` to the card's
kind. This style applies while that element belongs to an avatar in the
authoring tree:

```css
#settings-screen[data-layout="tree"] .art[data-kind="avatar"] img {
  object-fit: contain;
}
```

The exact rule is recorded in `v2/card-game/ui-styles.json` for owner review.

| View | Before | After |
| --- | --- | --- |
| Desktop, 1440 | [Before](assets/authoring-dino-framing/before-1440.png) | [After](assets/authoring-dino-framing/after-1440.png) |
| Phone, 390 | [Before](assets/authoring-dino-framing/before-390.png) | [After](assets/authoring-dino-framing/after-390.png) |
| Small phone, 320 | [Before](assets/authoring-dino-framing/before-320.png) | [After](assets/authoring-dino-framing/after-320.png) |

These captures combine Dino `2c3442e23`, collections `334682fc2` and the
approved crisp controls `96e7b7696` in a temporary checkout. The after images
add only the fit rule and avatar marker above. The entry browser check also
decodes the original Dino PNG and checks its complete-image fit at each width.
