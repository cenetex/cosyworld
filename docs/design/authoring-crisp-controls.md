# Crisp authoring controls

The owner asked for rounded corners on cards and crisp edges around them.
While the authoring tree is open, the existing header controls, descriptor,
message panel and context action use straight corners. The physical cards
keep their 13px corners, existing artwork, focus cues and touch targets.

The CSS rule is scoped to the open authoring tree. The World collections and
sample world are separate PRs. The captures here use the current source state.

| View        | Before                                           | After                                           |
| ----------- | ------------------------------------------------ | ----------------------------------------------- |
| Phone       | [390px](assets/authoring-crisp/before-390.png)   | [390px](assets/authoring-crisp/after-390.png)   |
| Small phone | [320px](assets/authoring-crisp/before-320.png)   | [320px](assets/authoring-crisp/after-320.png)   |
| Desktop     | [1440px](assets/authoring-crisp/before-1440.png) | [1440px](assets/authoring-crisp/after-1440.png) |

The browser review checked straight control corners, rounded card corners,
writing-to-action keyboard focus, and viewport width at all three sizes.
The existing authoring journey passed source editing, save, folder import,
scene art and exact reload at all three sizes.
