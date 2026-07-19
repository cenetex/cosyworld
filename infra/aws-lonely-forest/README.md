# Lonely Forest AWS Hosting

This module hosts the live V2 orchestrator at `lonelyforest.com` and a static
archive/library site at `lonelyforestlibrary.com`.

## What It Creates

- ECR repository for the root `Dockerfile` image.
- ECS Fargate service behind an HTTPS Application Load Balancer.
- EFS access point mounted at `/data` for SQLite snapshots, event store, and generated assets.
- WebAuthn/passkey relying-party configuration for the application domain and optional `www` origin.
- ACM certificate for `lonelyforest.com`, `www.lonelyforest.com`,
  `lonelyforestlibrary.com`, and `www.lonelyforestlibrary.com`.
- Route 53 alias records for both domains.
- S3 private bucket plus CloudFront distribution for the archive site in
  `sites/lonelyforestlibrary`.

The ECS service is intentionally `desired_count = 1`. Shared journal fencing,
cross-process routing, projection/presence convergence, invite rendezvous, and
the pinned two-process harness are implemented, but ECS still lacks an exact
per-task owner route and the #130 hot-room migration/failover gate. Do not
increase it to obtain horizontal write capacity. Multi-process production must
pass the remaining gates in
[`../../v2/docs/canonical-world.md`](../../v2/docs/canonical-world.md).

`COSYWORLD_PROCESS_ID` labels this ECS capacity process in `/meta`.
`COSYWORLD_V2_SHARD_ID` is emitted with the same value as a legacy alias. Set
the Terraform `process_id` input for new deployments; the older `shard_id`
input remains the fallback. Neither label is the official world id or a valid
persistent-state namespace.

The task definition intentionally leaves `COSYWORLD_CANONICAL_ROUTE_URL` and
`COSYWORLD_CANONICAL_ROUTER_TOKEN` unset. A normal ALB origin is not an exact
task route and must not be placed in the process route registry.

`deployment.auto.tfvars` captures the current deployed shape:

- `create_hosted_zones = true` because these domains are delegated to the
  hosted zones managed by this module.
- `deploy_profile = "local"` because the production bearer/moderation secrets
  do not exist in this AWS account yet.

Switch to `deploy_profile = "production"` only after creating the required
Secrets Manager entries and setting their ARN variables.

## Prerequisites

1. AWS SSO or credentials with access to ECS, ECR, EFS, ELB, ACM, Route 53, S3,
   CloudFront, IAM, and CloudWatch Logs.
2. Existing public Route 53 hosted zones for both domains, or set:

   ```sh
   -var='create_hosted_zones=true'
   ```

   If Terraform creates the zones, copy the output name servers to the domain
   registrar before expecting DNS validation or public traffic to work.

3. Production secrets in AWS Secrets Manager:

   - `COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER`
   - `COSYWORLD_MODERATION_TOKEN`
   - `OPENROUTER_API_KEY`

   Optional media and Box burn secrets:

   - `REPLICATE_API_TOKEN`
   - `COSYWORLD_BOX_BURN_SOLANA_RPC_URL`
   - `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`

## Deploy

From the repo root:

```sh
AWS_PROFILE=default \
TF_VAR_ruby_high_wallet_cards_bearer_secret_arn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:... \
TF_VAR_moderation_token_secret_arn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:... \
TF_VAR_openrouter_api_key_secret_arn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:... \
TF_VAR_replicate_api_token_secret_arn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:... \
./scripts/deploy-lonely-forest-aws.sh
```

The script bootstraps the ECR repo with Terraform, builds and pushes the image,
then applies the full stack using the pushed tag.

Useful overrides:

```sh
IMAGE_TAG=$(git rev-parse --short HEAD)
DOCKER_PLATFORM=linux/arm64
TF_VAR_create_hosted_zones=true
TF_VAR_cpu_architecture=ARM64
```

For an amd64 image, use:

```sh
DOCKER_PLATFORM=linux/amd64 TF_VAR_cpu_architecture=X86_64 ./scripts/deploy-lonely-forest-aws.sh
```

## Manual Flow

```sh
cd infra/aws-lonely-forest
terraform init
terraform apply -target=aws_ecr_repository.app
ECR_REPOSITORY_URL=$(aws ecr describe-repositories --region us-east-1 --repository-names lonely-forest-app --query 'repositories[0].repositoryUri' --output text)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "${ECR_REPOSITORY_URL%%/*}"
docker buildx build --platform linux/arm64 -t "${ECR_REPOSITORY_URL}:latest" --push ../..
terraform apply
```

After apply:

```sh
curl -i https://lonelyforest.com/health
curl -i https://lonelyforestlibrary.com/
```
