#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/aws-lonely-forest"
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
NAME_PREFIX="${TF_VAR_name_prefix:-lonely-forest}"

export AWS_PROFILE
export AWS_REGION
export AWS_DEFAULT_REGION="$AWS_REGION"

cd "$TF_DIR"

terraform init
terraform apply -target=aws_ecr_repository.app -auto-approve "$@"

ECR_REPOSITORY_URL="$(
  aws ecr describe-repositories \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --repository-names "${NAME_PREFIX}-app" \
    --query 'repositories[0].repositoryUri' \
    --output text
)"
ECR_REGISTRY="${ECR_REPOSITORY_URL%%/*}"

aws ecr get-login-password \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker buildx build \
  --platform "$DOCKER_PLATFORM" \
  -t "${ECR_REPOSITORY_URL}:${IMAGE_TAG}" \
  --push \
  "$ROOT_DIR"

terraform apply -var="image_tag=${IMAGE_TAG}" "$@"
