# Measure generation-window responsiveness

Run `node v2/scripts/smoke-card-generation-profile.mjs` for issue #2007.
This uses a local static server, synthetic saves, and intercepted dialogue.
Requests to any other origin are blocked. It never loads an owner's save or
calls a paid provider. The smoke's own changes select it in the PR fast check.

Each 1440px and 390px run starts from the same seeded fresh or 120-play fixture.
Success, delayed success, repeated failure, retry, and transport timeout use
real Talk, menu-click, and Escape handlers. Delayed replies wait for both input
probes. Other cases measure post-commit interaction. Same-turn recovery retains
the committed turn and item custody. Failure must finish as a silent beat.

`output/generation-profile/report.json` records the tested Git commit,
Chromium version, fixture size and log count, fixture response delays, Long Tasks,
50ms heartbeat gaps, CDP round trips, synchronous storage writes, and the
largest sampled JavaScript self times. Each case also writes a `.cpuprofile`
that Chrome DevTools can import. Fast check retains these files for seven days.

Use `COSYWORLD_SMOKE_WIDTHS=390` or `COSYWORLD_PROFILE_MODES=success,delayed`
for focused runs. `CHROMIUM_PATH` optionally selects an installed Chromium.
Browser sockets and a local HTTP listener must be permitted by the executor.

Timing is observational; sampling adds overhead. Compare identical fixtures,
browser versions and hardware. JSON stubs and reduced motion do not test SSE,
ordinary animation, provider latency or shared-server work. One sample does
not prove the owner's five-second stall is fixed. PR Fast runs the merge ref;
read the recorded commit and live `/meta.commit` before claiming deployed proof.
