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

Use the next version tag, replacing `vX.Y.Z` with the release tag being cut:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow deploys both Fly apps, then creates GitHub release notes.

## Lonely Forest operations

Provisioning, data authority, DNS cutover, and rollback are documented in
[`deployment/lonelyforest-fly.md`](deployment/lonelyforest-fly.md).
