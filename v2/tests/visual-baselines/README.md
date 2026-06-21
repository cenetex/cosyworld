# Visual Baselines

These PNGs are the committed browser-smoke baselines for the CosyWorld v2 MUD shell.

`node v2/scripts/smoke-browser.mjs` captures fresh mobile and desktop screenshots into `v2/orchestrator-rust/.runtime/visual-smoke/` and compares them against this directory with a 3% maximum pixel mismatch ratio.

After an intentional UI change, refresh the fixtures with:

```sh
COSYWORLD_UPDATE_VISUAL_BASELINES=1 node v2/scripts/smoke-browser.mjs
```
