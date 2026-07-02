# Release Process

Deployments are handled by `.github/workflows/deploy.yml`.

## Continuous Deploys

Every branch push deploys the current repository state to Fly using `fly.toml`.
The workflow requires this GitHub secret:

- `FLY_API_TOKEN`

Fly is the always-on deploy target for normal pushes and tagged releases.

## Tagged AWS Releases

Version tags matching `v*` also deploy to AWS after the Fly deploy succeeds.
The AWS job:

1. Assumes `arn:aws:iam::022118847419:role/lonely-forest-github-actions-deployer`
   via GitHub Actions OIDC. The role trust is restricted to `v*` tag refs
   from `cenetex/cosyworld`.
2. Builds the root `Dockerfile` for `linux/arm64`.
3. Pushes both `${tag}` and `latest` images to ECR.
4. Runs Terraform from `infra/aws-lonely-forest` with
   `-var="image_tag=${tag}"`.

The AWS Terraform state is stored in:

- S3 bucket: `cosyworld-lonely-forest-terraform-state-022118847419`
- Key: `lonely-forest/terraform.tfstate`
- Lock table: `cosyworld-lonely-forest-terraform-locks`

## Cutting a Release

Use a version tag:

```sh
git tag v0.0.13
git push origin v0.0.13
```

The workflow deploys Fly first, then AWS, then creates GitHub release notes.

## Production AWS Profile

AWS currently deploys with `deploy_profile = "local"` in
`infra/aws-lonely-forest/deployment.auto.tfvars` because the production
Secrets Manager entries do not exist yet. To switch AWS to strict production:

1. Create the required Secrets Manager secrets.
2. Set these Terraform variables to their ARNs:
   - `ruby_high_wallet_cards_bearer_secret_arn`
   - `moderation_token_secret_arn`
3. Change `deploy_profile` to `"production"`.
4. Push a new `v*` tag.
