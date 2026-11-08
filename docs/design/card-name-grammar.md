# Card names in action sentences

The screenshot trade joined an article, a possessive name, another owner,
and a title: “Vale trades the Creon's Writ for Creon’s The Burial Decree.”

Use one noun-phrase formatter in the action templates. Ordinary item names
keep “the”; names with a determiner or possessive do not gain another one.
Trade names both goods and the other actor without nesting a possessive:
“Vale trades Creon's Writ for the Burial Decree with Creon.”

The same formatter serves take, give, ask, carry, drop, yield, consume,
quest acquisition and handover facts. It changes neither card titles nor
character-generated dialogue. Refused trades remain offers, with unchanged
custody and the actual refusal suffix.

## Release boundary

These strings enter action records. Treat the change as shared-engine work,
not a browser-only copy fix. Keep released bundles unchanged and incorporate
this source patch into the next coordinated engine version. Rebuild its
narrator and public manifest then verify client/shared parity and replay.
Do not regenerate a released engine in place.

Tests cover the exact screenshot, the refused trade's custody and text, and
the related ask, give, drop and take templates. The receipt regression keeps
the ordinary-name trade covered.
