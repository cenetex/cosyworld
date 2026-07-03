variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for ECS, ALB, Route 53 records, and the CloudFront ACM certificate."

  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "aws_region must remain us-east-1 because CloudFront requires its ACM certificate there."
  }
}

variable "name_prefix" {
  type        = string
  default     = "lonely-forest"
  description = "Name prefix for AWS resources."
}

variable "app_domain" {
  type        = string
  default     = "lonelyforest.com"
  description = "Primary public domain for the live orchestrator."
}

variable "archive_domain" {
  type        = string
  default     = "lonelyforestlibrary.com"
  description = "Primary public domain for the static archive/library site."
}

variable "enable_www_records" {
  type        = bool
  default     = true
  description = "Also create www records for both public domains."
}

variable "create_hosted_zones" {
  type        = bool
  default     = false
  description = "Create Route 53 public hosted zones instead of looking up existing zones."
}

variable "vpc_id" {
  type        = string
  default     = ""
  description = "Existing VPC ID. Leave empty to use the account default VPC."
}

variable "subnet_ids" {
  type        = list(string)
  default     = []
  description = "Public subnet IDs for the ALB, ECS tasks, and EFS mount targets. Leave empty to use default VPC subnets."
}

variable "default_subnet_limit" {
  type        = number
  default     = 2
  description = "Maximum number of default VPC subnets to use when subnet_ids is empty."

  validation {
    condition     = var.default_subnet_limit >= 2
    error_message = "default_subnet_limit must be at least 2 because the public ALB requires two subnets."
  }
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "ECR image tag to run in ECS."
}

variable "cpu_architecture" {
  type        = string
  default     = "ARM64"
  description = "Fargate task architecture. Use ARM64 for Apple Silicon buildx pushes or X86_64 for amd64 images."

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}

variable "task_cpu" {
  type        = number
  default     = 512
  description = "Fargate task CPU units."
}

variable "task_memory" {
  type        = number
  default     = 1024
  description = "Fargate task memory in MiB."
}

variable "desired_count" {
  type        = number
  default     = 1
  description = "Number of orchestrator tasks to run. Keep this at 1 while SQLite/EFS is the event store."
}

variable "deploy_profile" {
  type        = string
  default     = "production"
  description = "COSYWORLD_DEPLOY_PROFILE for the orchestrator."

  validation {
    condition     = contains(["local", "production"], var.deploy_profile)
    error_message = "deploy_profile must be local or production."
  }
}

variable "shard_id" {
  type        = string
  default     = "public-1"
  description = "COSYWORLD_V2_SHARD_ID for the public shard."
}

variable "ruby_high_wallet_cards_url" {
  type        = string
  default     = "https://ruby-high.ai/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards"
  description = "Trusted ownership feed URL used by the production orchestrator."
}

variable "ruby_high_wallet_cards_bearer_secret_arn" {
  type        = string
  default     = ""
  description = "Secrets Manager ARN containing COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER."
}

variable "moderation_token_secret_arn" {
  type        = string
  default     = ""
  description = "Secrets Manager ARN containing COSYWORLD_MODERATION_TOKEN."
}

variable "openrouter_api_key_secret_arn" {
  type        = string
  default     = ""
  description = "Optional Secrets Manager ARN containing OPENROUTER_API_KEY for resident AI."
}

variable "openrouter_chat_model" {
  type        = string
  default     = "openai/gpt-4.1-mini"
  description = "OPENROUTER_CHAT_MODEL to use when openrouter_api_key_secret_arn is set."
}

variable "replicate_api_token_secret_arn" {
  type        = string
  default     = ""
  description = "Optional Secrets Manager ARN containing REPLICATE_API_TOKEN for generated avatar/media art."
}

variable "box_burn_solana_rpc_url_secret_arn" {
  type        = string
  default     = ""
  description = "Optional Secrets Manager ARN containing COSYWORLD_BOX_BURN_SOLANA_RPC_URL."
}

variable "box_core_collection_address_secret_arn" {
  type        = string
  default     = ""
  description = "Optional Secrets Manager ARN containing COSYWORLD_BOX_CORE_COLLECTION_ADDRESS."
}

variable "archive_bucket_name" {
  type        = string
  default     = ""
  description = "Optional explicit bucket name for the archive site."
}

variable "archive_bucket_force_destroy" {
  type        = bool
  default     = false
  description = "Allow Terraform to delete non-empty archive buckets. Leave false for production."
}

variable "archive_site_dir" {
  type        = string
  default     = ""
  description = "Path to the static archive site directory. Defaults to sites/lonelyforestlibrary."
}

variable "github_repository" {
  type        = string
  default     = "cenetex/cosyworld"
  description = "GitHub owner/repo allowed to assume the AWS deployment role."
}

variable "create_github_oidc_provider" {
  type        = bool
  default     = true
  description = "Create the account-level GitHub Actions OIDC provider. Set false if the account already has one."
}

variable "github_oidc_thumbprint" {
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
  description = "Thumbprint for token.actions.githubusercontent.com."
}
