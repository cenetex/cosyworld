# Respond contract evaluation

This audit follows #933. The old ten-clause `system_contract` has already been
replaced by a first-person awakening. This pass tests the remaining shared
truth paragraph against a shorter statement of viewpoint.

| Current clause | Role and code evidence | Treatment |
| --- | --- | --- |
| Authored name, title, description, and voice | Speaker viewpoint; active reviewed content supplies system identity | Keep |
| Presence of dreams and memories | Viewpoint; the text stays in authorized user context | Keep |
| Heard words belong to this world | Viewpoint; evidence authorization and system placement keep their own boundaries | Keep in shorter form |
| Memory follows the solid scene | Partial overlap with `voice_anchor_missing`; its lexical anchor check has a narrower scope | Measure removal |
| Desire cannot create possessions or finished deeds | Partial overlap with `voice_proposed_action_claim` and `voice_unbacked_action_intent` | Measure removal |
| Direct control and native identity | Viewpoint; `voice_fallback_identity` checks numeric fallback names and has a narrower scope | Keep |
| Speaker, recipient, output shape, word budget, observation and fresh turn | Output envelope and viewpoint; speaker, mode, length and anomaly gates enforce their own checks | Keep |

The deterministic gate checks particular speech properties. The comparison also includes a manual read
for invented facts, speaker continuity, and fresh-turn retention.

## Method fixed before provider sampling

Four public, authored fixtures cover Oak, Fern, Professor, and Mara Wick. Each
receives a fixed directed turn from a synthetic visitor named Aster. Each arm
has three repetitions per fixture, giving twelve samples per arm. The baseline
is the exact current truth paragraph. The candidate is:

> I speak from immediate attention, desire, preference, and hesitation. What I
> hear belongs to the scene around me.

Use the configured production prose model, temperature 0.7, and at most 224
completion tokens. Each sample can use three candidate rounds. Every reply
passes through `certify_speech`; retries receive the production feedback from
`request_with_retry_feedback`. Store provider model, token use, cost, latency,
finish reason, text, and the gate checks. The fixtures contain authored public
content and synthetic turns.

Set a total provider budget of $0.50. Check current model prices before each
request and reserve its upper estimate against that budget. A failed transport
call ends the batch for inspection.

The candidate passes this small comparison when accepted-sample count falls by
at most one of twelve, mean rounds per accepted sample rises by at most 0.25,
and manual review finds zero new invented actions, rewards, or speaker swaps.
Report rejection counts by gate code and show all final lines. This is a bounded
regression check; broader production traffic remains a separate evidence source.

The ordinary fixture test checks identical user evidence and retention of the
fresh turn in a small context window. The ignored
`speech_contract_provider_evaluation` test exports requests and scores saved
responses. It reads saved provider replies locally. Its inputs are
`COSYWORLD_SPEECH_EVAL_DIR` and `COSYWORLD_SPEECH_EVAL_MODEL`.

## Result

On 2026-09-05, the first baseline request reached OpenRouter through the primary
production credential and received HTTP 402, `limit_source: openrouter_credits`.
The batch stopped with zero completed samples. The fixed first-round request
estimate was $0.025480; the evaluation requires renewed provider credit.

The production paragraph is retained while this comparison awaits samples.
The fixture checks pass, including fresh-turn retention in a 2,048-token window.

The transport command is:

```sh
python3 v2/scripts/run-speech-contract-evaluation.py "$COSYWORLD_SPEECH_EVAL_DIR" \
  --app cosyworld --model "$COSYWORLD_SPEECH_EVAL_MODEL"
```

The default run checks pricing and the budget. Add `--execute` for provider
sampling. The runner stops on provider errors and saves a pending request for
inspection. Run the ignored Rust evaluation again to score replies and export
only the next required rounds. The total cap is $0.50 across all saved responses.
