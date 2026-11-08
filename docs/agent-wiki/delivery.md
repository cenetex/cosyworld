# Delivery and evidence

[Wiki home](README.md) · [Contribution policy](../../.github/AGENT.md) ·
[Release operations](../release.md)

## Work with other agents

- One coherent change per branch. The hand-written change budget is 400 added plus
  deleted lines against main's merge base; use the repository checker, not a raw
  diff count. Generated and media exemptions are defined in the policy.
- Inspect current PR heads before editing. Do not overwrite another owner's work
  or force-push to solve a generated-file conflict. Coordinate ownership explicitly.
- Dependent PRs normally wait for their prerequisite to land; the policy says not
  to stack PRs. Regenerate against actual main instead of keeping a reserved number.
- Open a draft early. Report exact commands, observed results, compatibility and
  generated-file changes. A blocked check is not a pass.
- Link an issue with `Closes` only when all its current acceptance is satisfied.
  Otherwise identify the remaining scope and use a non-closing reference.

## Choose checks by changed authority

The policy's required-check table is authoritative. Common entry points:

| Change                          | Evidence to collect                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Documentation                   | Working links/commands, `npm run docs:check`, `npm run check:version`, `git diff --check`              |
| Card presentation               | `npm run check:ui`, unit tests, desktop and phone changed-path play, repeated/interrupted interactions |
| Rule or persistent state        | Source/compiled agreement, migration and journal replay at the real server boundary                    |
| Pack content                    | Owning compiler, valid authored/compiled data, reachable journey and existing-save behavior            |
| Browser/HTTP/shared persistence | `npm run v2:check` and focused server/browser evidence                                                 |
| Runtime or release              | Relevant native checks and the release guide's gates                                                   |

Do not update snapshots to make a failure disappear. Confirm the requested
behavior and preserve unrelated coverage. Core UI restyles or new UI systems
need the owner's review; a snapshot update is not that approval.

## What a green check proves

- Record the source head, tested merge ref/tree, workflow run and jobs selected.
  Pull-request workflows can test a synthetic merge ref rather than the source SHA.
- A path-selected Fast run may skip unrelated native modules. Read its job plan.
- Static/local browser smokes do not prove live shared-server or streamed-provider
  behavior. A skipped smoke is not a passed gameplay journey.
- Synthetic saves, mocked dialogue and seeded inventory are useful controlled
  evidence. State these limits; also test the real route when claiming playability.
- Re-run affected checks after rebasing, regenerating or changing the test harness.

## Main, .dev and production are different states

1. Merge only reviewed, validated work under the current policy. Land small batches
   and wait for main's Fast result before the next batch.
2. A merge itself does not deploy. The scheduled `.dev` train snapshots a main
   commit, deploys it, then runs its production gates. Main may have moved since.
3. Read the site's `/meta.commit`, rules/content identity and asset metadata. Package
   versions stay at the last release between tags, so equal versions prove little.
4. Verify the completed deployment and post-rollout gates, not just workflow color.
   A superseded run may succeed without deploying; a post-deploy gate may fail
   after the rollout has already happened.
5. Production is a separate owner-authorized release from the intended tested
   commit. Follow [cutting a release](../release.md#cutting-a-release), not memory.

## Send a useful test handoff

Give the exact URL, served commit and rules version; what changed; a short legal
player route; expected custody/state/dialogue; reload/rejoin checks; and what is
not yet included. Verify the pack is mounted before inviting a player to test it.
Record failures with build, save type, viewport and reproduction. Do not request
production release merely because main or a local test is green.
