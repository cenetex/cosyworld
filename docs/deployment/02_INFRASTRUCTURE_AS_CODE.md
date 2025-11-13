# Report 02 - Infrastructure as Code (Terraform)

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Prerequisites:** Report 01 (Docker container working locally)  
**Estimated Implementation Time:** 3-5 days  
**Related Reports:** [00 - Overview](./00_AWS_DEPLOYMENT_OVERVIEW.md) | [01 - Containerization](./01_CONTAINERIZATION_GUIDE.md)

---

## Overview

This report provides complete Terraform modules to deploy CosyWorld infrastructure on AWS. Due to the comprehensive nature of Terraform configuration, this document focuses on the **root module orchestration** and **key configuration patterns**. Complete module code is available in the `infra/terraform-app/` directory.

### What We're Building

```
AWS Infrastructure (per client)
├── VPC with public/private subnets (2 AZs)
├── Application Load Balancer (ALB)
├── ECS Fargate cluster with auto-scaling
├── ElastiCache Redis cluster (multi-AZ)
├── ECR repository for Docker images
├── Secrets Manager for credentials
├── CloudWatch for monitoring
└── Security groups and IAM roles
```

---

## Quick Start

### 1. Directory Structure

```bash
mkdir -p infra/terraform-app/modules/{vpc,ecs,alb,redis,security}
cd infra/terraform-app
```

### 2. Root Module (`main.tf`)

```hcl
# infra/terraform-app/main.tf
terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "cosyworld-terraform-state"
    key            = "clients/${terraform.workspace}/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cosyworld-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Client      = terraform.workspace
    }
  }
}

# ============================================================================
# Data Sources
# ============================================================================
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# ============================================================================
# Local Variables
# ============================================================================
locals {
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
  
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    Client      = var.client_name
  }
}

# ============================================================================
# VPC Module
# ============================================================================
module "vpc" {
  source = "./modules/vpc"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = local.azs
  enable_vpc_flow_logs = var.enable_vpc_flow_logs
  
  tags = local.common_tags
}

# ============================================================================
# Security Module
# ============================================================================
module "security" {
  source = "./modules/security"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  vpc_cidr     = module.vpc.vpc_cidr
  
  tags = local.common_tags
}

# ============================================================================
# Application Load Balancer Module
# ============================================================================
module "alb" {
  source = "./modules/alb"

  project_name          = var.project_name
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  public_subnet_ids     = module.vpc.public_subnet_ids
  alb_security_group_id = module.security.alb_security_group_id
  certificate_arn       = var.certificate_arn
  health_check_path     = "/api/health/ready"
  
  tags = local.common_tags
}

# ============================================================================
# ElastiCache Redis Module
# ============================================================================
module "redis" {
  source = "./modules/redis"

  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.vpc.vpc_id
  private_subnet_ids      = module.vpc.private_subnet_ids
  redis_security_group_id = module.security.redis_security_group_id
  node_type               = var.redis_node_type
  num_cache_nodes         = var.redis_num_nodes
  
  tags = local.common_tags
}

# ============================================================================
# ECR Repository
# ============================================================================
resource "aws_ecr_repository" "app" {
  name                 = "${var.project_name}-${var.environment}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# ============================================================================
# Secrets Manager
# ============================================================================
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "${var.project_name}/${var.environment}/app-secrets"
  description = "Application secrets for CosyWorld ${var.environment}"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    DISCORD_BOT_TOKEN   = var.discord_bot_token
    DISCORD_CLIENT_ID   = var.discord_client_id
    OPENROUTER_API_KEY  = var.openrouter_api_key
    ENCRYPTION_KEY      = var.encryption_key
    MONGO_URI           = var.mongo_uri
    GOOGLE_AI_API_KEY   = var.google_ai_api_key
    HELIUS_API_KEY      = var.helius_api_key
    TELEGRAM_BOT_TOKEN  = var.telegram_bot_token
  })
}

# ============================================================================
# ECS Module
# ============================================================================
module "ecs" {
  source = "./modules/ecs"

  project_name           = var.project_name
  environment            = var.environment
  aws_region             = var.aws_region
  private_subnet_ids     = module.vpc.private_subnet_ids
  ecs_security_group_id  = module.security.ecs_security_group_id
  target_group_arn       = module.alb.target_group_arn
  alb_listener_arn       = module.alb.https_listener_arn
  
  container_image        = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
  container_port         = 3000
  task_cpu               = var.task_cpu
  task_memory            = var.task_memory
  desired_count          = var.desired_count
  min_capacity           = var.min_capacity
  max_capacity           = var.max_capacity
  
  mongo_db_name          = var.mongo_db_name
  
  secrets = [
    { name = "DISCORD_BOT_TOKEN",  arn = "${aws_secretsmanager_secret.app_secrets.arn}:DISCORD_BOT_TOKEN::" },
    { name = "DISCORD_CLIENT_ID",  arn = "${aws_secretsmanager_secret.app_secrets.arn}:DISCORD_CLIENT_ID::" },
    { name = "OPENROUTER_API_KEY", arn = "${aws_secretsmanager_secret.app_secrets.arn}:OPENROUTER_API_KEY::" },
    { name = "ENCRYPTION_KEY",     arn = "${aws_secretsmanager_secret.app_secrets.arn}:ENCRYPTION_KEY::" },
    { name = "MONGO_URI",          arn = "${aws_secretsmanager_secret.app_secrets.arn}:MONGO_URI::" },
    { name = "REDIS_URL",          arn = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/${var.environment}/redis-url" },
  ]
  
  secrets_arns = [
    aws_secretsmanager_secret.app_secrets.arn,
    "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/*"
  ]
  
  s3_bucket_arn       = "arn:aws:s3:::${var.s3_bucket_name}"
  dynamodb_table_arns = var.dynamodb_table_arns
  
  tags = local.common_tags
  
  depends_on = [module.alb, module.redis]
}

# ============================================================================
# SSM Parameter: Redis URL
# ============================================================================
resource "aws_ssm_parameter" "redis_url" {
  name  = "/${var.project_name}/${var.environment}/redis-url"
  type  = "String"
  value = "redis://${module.redis.primary_endpoint_address}:6379"

  tags = local.common_tags
}
```

### 3. Variables (`variables.tf`)

```hcl
# infra/terraform-app/variables.tf

# ============================================================================
# Core Configuration
# ============================================================================
variable "project_name" {
  description = "Project name"
  type        = string
  default     = "cosyworld"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "client_name" {
  description = "Client name for multi-tenant deployments"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# ============================================================================
# Network Configuration
# ============================================================================
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "enable_vpc_flow_logs" {
  description = "Enable VPC flow logs"
  type        = bool
  default     = false
}

# ============================================================================
# ECS Configuration
# ============================================================================
variable "image_tag" {
  description = "Docker image tag"
  type        = string
  default     = "latest"
}

variable "task_cpu" {
  description = "ECS task CPU units"
  type        = string
  default     = "512"
}

variable "task_memory" {
  description = "ECS task memory (MB)"
  type        = string
  default     = "1024"
}

variable "desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "min_capacity" {
  description = "Minimum number of ECS tasks"
  type        = number
  default     = 2
}

variable "max_capacity" {
  description = "Maximum number of ECS tasks"
  type        = number
  default     = 10
}

# ============================================================================
# Redis Configuration
# ============================================================================
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_num_nodes" {
  description = "Number of Redis nodes"
  type        = number
  default     = 1
}

# ============================================================================
# Application Secrets (from environment or CI/CD)
# ============================================================================
variable "discord_bot_token" {
  description = "Discord bot token"
  type        = string
  sensitive   = true
}

variable "discord_client_id" {
  description = "Discord client ID"
  type        = string
  sensitive   = true
}

variable "openrouter_api_key" {
  description = "OpenRouter API key"
  type        = string
  sensitive   = true
}

variable "encryption_key" {
  description = "Application encryption key"
  type        = string
  sensitive   = true
}

variable "mongo_uri" {
  description = "MongoDB connection URI"
  type        = string
  sensitive   = true
}

variable "mongo_db_name" {
  description = "MongoDB database name"
  type        = string
  default     = "cosyworld8"
}

variable "google_ai_api_key" {
  description = "Google AI API key (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "helius_api_key" {
  description = "Helius API key (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "telegram_bot_token" {
  description = "Telegram bot token (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

# ============================================================================
# SSL/TLS
# ============================================================================
variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}

# ============================================================================
# S3 and DynamoDB
# ============================================================================
variable "s3_bucket_name" {
  description = "S3 bucket name"
  type        = string
  default     = ""
}

variable "dynamodb_table_arns" {
  description = "List of DynamoDB table ARNs"
  type        = list(string)
  default     = []
}
```

### 4. Outputs (`outputs.tf`)

```hcl
# infra/terraform-app/outputs.tf

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.alb.alb_dns_name
}

output "alb_url" {
  description = "Application URL"
  value       = "https://${module.alb.alb_dns_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = module.redis.primary_endpoint_address
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name"
  value       = module.ecs.log_group_name
}
```

---

## Deployment Procedure

### Step 1: Prerequisites

```bash
# Install Terraform
brew install terraform  # macOS
# OR
wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip

# Configure AWS CLI
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output format (json)

# Verify AWS access
aws sts get-caller-identity
```

### Step 2: Create S3 Backend (one-time setup)

```bash
# Create S3 bucket for Terraform state
aws s3 mb s3://cosyworld-terraform-state --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket cosyworld-terraform-state \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket cosyworld-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name cosyworld-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### Step 3: Create Environment File

Create `terraform.tfvars` (gitignored):

```hcl
# infra/terraform-app/terraform.tfvars

environment    = "dev"
client_name    = "client1"
aws_region     = "us-east-1"

# Network
vpc_cidr       = "10.0.0.0/16"

# ECS
image_tag      = "latest"
task_cpu       = "512"
task_memory    = "1024"
desired_count  = 2
min_capacity   = 2
max_capacity   = 10

# Redis
redis_node_type = "cache.t4g.micro"
redis_num_nodes = 1

# Secrets (use environment variables in production)
discord_bot_token  = "your_discord_token_here"
discord_client_id  = "your_discord_client_id_here"
openrouter_api_key = "your_openrouter_key_here"
encryption_key     = "your_base64_encryption_key_here"
mongo_uri          = "mongodb+srv://user:pass@cluster.mongodb.net/cosyworld8"
mongo_db_name      = "cosyworld8"
```

### Step 4: Initialize and Deploy

```bash
cd infra/terraform-app

# Initialize Terraform
terraform init

# Create workspace for client
terraform workspace new client1-dev
# OR select existing workspace
terraform workspace select client1-dev

# Preview changes
terraform plan

# Apply infrastructure
terraform apply

# Expected output:
# Apply complete! Resources: 45 added, 0 changed, 0 destroyed.
#
# Outputs:
# alb_url = "https://cosyworld-dev-alb-123456789.us-east-1.elb.amazonaws.com"
# ecr_repository_url = "123456789.dkr.ecr.us-east-1.amazonaws.com/cosyworld-dev"
# ecs_cluster_name = "cosyworld-dev-cluster"
# redis_endpoint = "cosyworld-dev-redis.abc123.0001.use1.cache.amazonaws.com"
```

### Step 5: Push Docker Image to ECR

```bash
# Get ECR login credentials
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(terraform output -raw ecr_repository_url | cut -d/ -f1)

# Build and tag image
docker build -t cosyworld:latest .
docker tag cosyworld:latest $(terraform output -raw ecr_repository_url):latest

# Push to ECR
docker push $(terraform output -raw ecr_repository_url):latest
```

### Step 6: Force ECS Deployment

```bash
# Update ECS service to use new image
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_service_name) \
  --force-new-deployment \
  --region us-east-1

# Watch deployment
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw ecs_service_name) \
  --region us-east-1 \
  --query 'services[0].deployments'
```

### Step 7: Verify Deployment

```bash
# Get ALB URL
ALB_URL=$(terraform output -raw alb_url)

# Test health endpoint
curl $ALB_URL/api/health/live
# Expected: {"status":"ok","timestamp":"...","uptime":123}

curl $ALB_URL/api/health/ready
# Expected: {"status":"ready","checks":{...}}

# Access web UI
open $ALB_URL
```

---

## Cost Controls

### Development Environment

```hcl
# terraform.tfvars (dev)
environment     = "dev"
task_cpu        = "256"      # Minimal CPU
task_memory     = "512"      # Minimal memory
desired_count   = 1          # Single task
min_capacity    = 1
max_capacity    = 2
redis_node_type = "cache.t4g.micro"  # $13/month
redis_num_nodes = 1          # No multi-AZ
enable_vpc_flow_logs = false # Save $5/month
```

**Monthly Cost:** ~$150-200

### Production Environment

```hcl
# terraform.tfvars (prod)
environment     = "prod"
task_cpu        = "512"
task_memory     = "1024"
desired_count   = 2          # High availability
min_capacity    = 2
max_capacity    = 10
redis_node_type = "cache.r6g.large"  # $133/month per node
redis_num_nodes = 3          # Multi-AZ with failover
enable_vpc_flow_logs = true  # Security monitoring
```

**Monthly Cost:** ~$800-1200

### Cost Optimization Tips

1. **Use Fargate Spot** (save 70%):
```hcl
capacity_provider_strategy {
  capacity_provider = "FARGATE_SPOT"
  weight           = 70
  base             = 0
}
```

2. **Reserved ElastiCache Nodes** (save 30-40%):
```bash
# Purchase 1-year reserved node
aws elasticache purchase-reserved-cache-nodes-offering \
  --reserved-cache-nodes-offering-id <offering-id>
```

3. **NAT Gateway Optimization**:
```hcl
# Use single NAT gateway for dev (not HA)
resource "aws_nat_gateway" "main" {
  count = var.environment == "prod" ? 2 : 1
  # ...
}
```

4. **Auto-scaling Aggressive Scale-In**:
```hcl
scale_in_cooldown = 180  # 3 minutes (vs 5 minutes default)
```

---

## Summary

### What We Built
- ✅ Complete Terraform modules for AWS infrastructure
- ✅ VPC with public/private subnets and NAT gateways
- ✅ ECS Fargate cluster with auto-scaling
- ✅ Application Load Balancer with health checks
- ✅ ElastiCache Redis cluster (multi-AZ for prod)
- ✅ ECR repository for Docker images
- ✅ Secrets Manager integration
- ✅ CloudWatch monitoring and logging

### Next Steps
Proceed to **[Report 03 - CI/CD Pipeline](./03_CICD_PIPELINE.md)** to automate deployment via GitHub Actions.

---

*Infrastructure Guide Version: 1.0*  
*Last Updated: November 13, 2025*
