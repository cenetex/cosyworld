# Release Process

Deployments are handled by `.github/workflows/deploy.yml`.

## Continuous deploys

Pushes to `main` run the production gate and deploy only the primary
`cosyworld` Fly app. Tags matching `v*` rerun the production gate, deploy both
the primary app and `cosyworld-lonelyforest` from the tagged commit, and create
a GitHub release only after both deployments succeed.

The workflow requires these app-scoped GitHub secrets:

- `FLY_API_TOKEN` for the primary app
- `FLY_LONELYFOREST_API_TOKEN` for Lonely Forest

The workflow deploys `fly.toml` to the primary app and
`fly.lonelyforest.toml` to Lonely Forest in separate jobs. The two apps run the
same committed release with independent volumes and WebAuthn relying-party
domains.

## Volume headroom

Both Fly data volumes extend automatically at 80% usage in 1 GB increments,
up to a 5 GB ceiling. The deploy workflow still refuses to deploy at 85% so a
failed or exhausted auto-extension cannot be hidden by a release.

`.github/workflows/volume-headroom.yml` checks both volumes every 15 minutes
and fails its app-specific job at 70% usage. Operators should subscribe to
GitHub Actions failure notifications for the `Volume headroom` workflow. A
failure at 70% is an alert to inspect SQLite and generated-asset growth before
the 80% automatic extension is needed; reaching the 5 GB limit requires a
retention or capacity decision rather than another automatic increase.

## Lonely Forest infrastructure

Application releases no longer build ECR images or update ECS. AWS remains the
authority for the `lonelyforest.com` Route 53 zone and the static
`lonelyforestlibrary.com` S3/CloudFront site. Its dormant ECS/EFS/ALB resources
are kept only for the documented rollback window.

The Terraform state remains stored in:

- S3 bucket: `cosyworld-lonely-forest-terraform-state-022118847419`
- Key: `lonely-forest/terraform.tfstate`
- Lock table: `cosyworld-lonely-forest-terraform-locks`

## Cutting a Release

The package and Rust crate versions must already match the final release version.
`v2/content-engine-version.txt` is a separate compatibility contract; change it
only when pack engine compatibility actually changes.
For a major or otherwise high-risk release, deploy an immutable release candidate
from the exact commit first:

```sh
git tag vX.Y.Z-rc.1
git push origin vX.Y.Z-rc.1
```

Wait for the production gate, both deploy jobs, live `/meta` checks, and the
candidate GitHub release to succeed. Observe the candidate in production before
promoting that same commit. Do not rebuild or amend it between candidate and
promotion.

Promote the observed commit with the final version tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow deploys both Fly apps, then creates GitHub release notes.

## Upgrade and recovery

Keep the existing SQLite and generated-asset volumes attached during an upgrade.
The runtime restores the latest accepted checkpoint, replays the retained journal
suffix, and refuses incompatible world-pack or generated-descendant state rather
than silently replacing it. A normal release must report zero checkpoint
rejections in `/meta` after deployment.

Recovery captures are compatibility evidence for an exact live bundle and
tenant, not generic seed data. Use a capture only through the guarded workflow
input documented in [`deployment/07-deployment.md`](deployment/07-deployment.md),
and verify the resulting bundle hash and journal cursor before cutting the next
tag. Prefer a forward fix over rolling an active persistent world back across a
schema or world-pack boundary.

## Lonely Forest operations

Provisioning, data authority, DNS cutover, and rollback are documented in
[`deployment/lonelyforest-fly.md`](deployment/lonelyforest-fly.md).
