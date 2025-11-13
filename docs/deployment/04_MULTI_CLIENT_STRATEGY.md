# Report 04 - Multi-Client Deployment Strategy

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Prerequisites:** Reports 01-03 (Single client deployment working)  
**Estimated Implementation Time:** 2-4 days  
**Related Reports:** [00 - Overview](./00_AWS_DEPLOYMENT_OVERVIEW.md)

---

## Overview

Strategy for deploying and managing multiple independent CosyWorld instances for different clients using Terraform workspaces and isolated AWS resources.

### Multi-Client Requirements

**Isolation:**
- ✅ Separate infrastructure per client (VPC, ECS, Redis)
- ✅ Independent databases (MongoDB Atlas clusters)
- ✅ Isolated secrets (AWS Secrets Manager)
- ✅ Separate cost tracking and billing

**Efficiency:**
- ✅ Shared CI/CD pipeline (single GitHub Actions workflow)
- ✅ Shared Docker images (same codebase, different config)
- ✅ Reusable Terraform modules
- ✅ Centralized monitoring dashboard

---

## Architecture Models

### Option 1: Terraform Workspaces (Recommended)

**Single AWS account, isolated resources via Terraform workspaces:**

```
AWS Account
├── Terraform Workspace: client1-prod
│   ├── VPC (10.0.0.0/16)
│   ├── ECS Cluster
│   ├── Redis Cluster
│   └── Secrets Manager
│
├── Terraform Workspace: client2-prod
│   ├── VPC (10.1.0.0/16)
│   ├── ECS Cluster
│   ├── Redis Cluster
│   └── Secrets Manager
│
└── Terraform Workspace: client3-prod
    ├── VPC (10.2.0.0/16)
    ├── ECS Cluster
    ├── Redis Cluster
    └── Secrets Manager
```

**Pros:**
- ✅ Simple management (single AWS account)
- ✅ Shared resource quotas
- ✅ Easy cost tracking with tags
- ✅ Fast to provision new clients

**Cons:**
- ⚠️ All clients in same AWS account (shared blast radius)
- ⚠️ Need careful IAM permissions
- ⚠️ Higher risk of accidental cross-client access

**Best for:** 5-20 clients, trusted relationships

---

### Option 2: Separate AWS Accounts (Enterprise)

**AWS Organizations with separate accounts per client:**

```
AWS Organization
├── Management Account
├── Shared Services Account (ECR, CI/CD)
│   └── ECR Repository (shared Docker images)
│
├── Client1 Account
│   ├── VPC
│   ├── ECS Cluster
│   └── Redis Cluster
│
├── Client2 Account
│   ├── VPC
│   ├── ECS Cluster
│   └── Redis Cluster
│
└── Client3 Account
    ├── VPC
    ├── ECS Cluster
    └── Redis Cluster
```

**Pros:**
- ✅ Complete isolation (separate billing, IAM, limits)
- ✅ Compliance-friendly (data sovereignty)
- ✅ Independent security boundaries
- ✅ Per-client AWS Support plans

**Cons:**
- ⚠️ Complex cross-account permissions
- ⚠️ Higher management overhead
- ⚠️ Need AWS Organizations setup
- ⚠️ More expensive (NAT gateways, etc. duplicated)

**Best for:** 20+ clients, regulated industries, white-label SaaS

---

## Implementation: Terraform Workspaces

### Directory Structure

```
infra/terraform-app/
├── main.tf                    # Root module
├── variables.tf               # Input variables
├── outputs.tf                 # Output values
├── backend.tf                 # S3 backend config
├── environments/
│   ├── client1-prod.tfvars   # Client 1 configuration
│   ├── client2-prod.tfvars   # Client 2 configuration
│   └── client3-prod.tfvars   # Client 3 configuration
└── modules/
    ├── vpc/
    ├── ecs/
    ├── alb/
    └── redis/
```

### Workspace Naming Convention

```
Format: {client_name}-{environment}

Examples:
- client1-dev
- client1-staging
- client1-prod
- client2-prod
- acmecorp-prod
```

### Client Configuration Files

**Client 1: `environments/client1-prod.tfvars`**

```hcl
# Client identification
client_name    = "client1"
environment    = "prod"
project_name   = "cosyworld"

# Network (unique CIDR per client)
vpc_cidr       = "10.0.0.0/16"

# ECS configuration
task_cpu       = "512"
task_memory    = "1024"
desired_count  = 2
min_capacity   = 2
max_capacity   = 10

# Redis
redis_node_type = "cache.r6g.large"
redis_num_nodes = 3  # Multi-AZ

# Database
mongo_uri      = "mongodb+srv://client1:${var.client1_mongo_password}@client1-cluster.mongodb.net/cosyworld"
mongo_db_name  = "cosyworld_client1"

# Feature flags (client-specific)
enable_buybot  = true
enable_stories = true
```

**Client 2: `environments/client2-prod.tfvars`**

```hcl
client_name    = "client2"
environment    = "prod"
project_name   = "cosyworld"

vpc_cidr       = "10.1.0.0/16"  # Different CIDR

task_cpu       = "1024"  # Larger instance
task_memory    = "2048"
desired_count  = 4       # More capacity
min_capacity   = 4
max_capacity   = 20

redis_node_type = "cache.r6g.xlarge"  # Bigger Redis
redis_num_nodes = 3

mongo_uri      = "mongodb+srv://client2:${var.client2_mongo_password}@client2-cluster.mongodb.net/cosyworld"
mongo_db_name  = "cosyworld_client2"

enable_buybot  = false  # Client doesn't want NFT features
enable_stories = true
```

### Deployment Workflow

#### 1. Create New Client

```bash
cd infra/terraform-app

# Create workspace
terraform workspace new client1-prod

# Initialize
terraform init

# Plan deployment
terraform plan -var-file=environments/client1-prod.tfvars

# Apply
terraform apply -var-file=environments/client1-prod.tfvars

# Output important values
terraform output
```

#### 2. Update Existing Client

```bash
# Switch to client workspace
terraform workspace select client1-prod

# Apply changes
terraform apply -var-file=environments/client1-prod.tfvars
```

#### 3. List All Clients

```bash
# List workspaces
terraform workspace list

# Output:
#   default
#   client1-dev
#   client1-prod
# * client2-prod
#   client3-prod
```

---

## Secrets Management Per Client

### AWS Secrets Manager Structure

```
Secrets Manager
├── cosyworld/client1-prod/app-secrets
│   ├── DISCORD_BOT_TOKEN
│   ├── DISCORD_CLIENT_ID
│   ├── OPENROUTER_API_KEY
│   ├── ENCRYPTION_KEY
│   └── MONGO_URI
│
├── cosyworld/client2-prod/app-secrets
│   ├── DISCORD_BOT_TOKEN  (different Discord bot)
│   ├── DISCORD_CLIENT_ID
│   ├── OPENROUTER_API_KEY
│   ├── ENCRYPTION_KEY
│   └── MONGO_URI
│
└── cosyworld/client3-prod/app-secrets
    └── ...
```

### Terraform Secrets Configuration

```hcl
# main.tf - Secrets per workspace
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "${var.project_name}/${terraform.workspace}/app-secrets"
  description = "Application secrets for ${terraform.workspace}"

  tags = {
    Client      = var.client_name
    Environment = var.environment
    Workspace   = terraform.workspace
  }
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    DISCORD_BOT_TOKEN  = var.discord_bot_token
    DISCORD_CLIENT_ID  = var.discord_client_id
    OPENROUTER_API_KEY = var.openrouter_api_key
    ENCRYPTION_KEY     = var.encryption_key
    MONGO_URI          = var.mongo_uri
    REDIS_URL          = "redis://${module.redis.primary_endpoint_address}:6379"
  })
}
```

### GitHub Actions Secret Management

**Per-environment secrets in GitHub:**

```
GitHub Repository Settings → Environments

Environment: client1-prod
- DISCORD_BOT_TOKEN_CLIENT1
- DISCORD_CLIENT_ID_CLIENT1
- MONGO_URI_CLIENT1
- ENCRYPTION_KEY_CLIENT1

Environment: client2-prod
- DISCORD_BOT_TOKEN_CLIENT2
- DISCORD_CLIENT_ID_CLIENT2
- MONGO_URI_CLIENT2
- ENCRYPTION_KEY_CLIENT2
```

**GitHub Actions workflow:**

```yaml
# .github/workflows/deploy-client.yml
name: Deploy Client

on:
  workflow_dispatch:
    inputs:
      client:
        description: 'Client to deploy'
        required: true
        type: choice
        options:
          - client1-prod
          - client2-prod
          - client3-prod

jobs:
  deploy:
    name: Deploy to ${{ github.event.inputs.client }}
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.client }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
      
      - name: Terraform Init
        working-directory: infra/terraform-app
        run: terraform init
      
      - name: Select Workspace
        working-directory: infra/terraform-app
        run: terraform workspace select ${{ github.event.inputs.client }}
      
      - name: Terraform Apply
        working-directory: infra/terraform-app
        env:
          TF_VAR_discord_bot_token: ${{ secrets.DISCORD_BOT_TOKEN }}
          TF_VAR_discord_client_id: ${{ secrets.DISCORD_CLIENT_ID }}
          TF_VAR_openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          TF_VAR_encryption_key: ${{ secrets.ENCRYPTION_KEY }}
          TF_VAR_mongo_uri: ${{ secrets.MONGO_URI }}
        run: |
          terraform apply \
            -var-file=environments/${{ github.event.inputs.client }}.tfvars \
            -auto-approve
```

---

## Cost Tracking & Monitoring

### AWS Cost Allocation Tags

```hcl
# Terraform provider default tags
provider "aws" {
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Client      = var.client_name
      ManagedBy   = "Terraform"
      Workspace   = terraform.workspace
      CostCenter  = var.client_name  # For cost allocation
    }
  }
}
```

### Cost Explorer Query

```bash
# Get monthly costs per client
aws ce get-cost-and-usage \
  --time-period Start=2025-11-01,End=2025-11-30 \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=TAG,Key=Client \
  --filter file://filter.json

# filter.json
{
  "Tags": {
    "Key": "Project",
    "Values": ["cosyworld"]
  }
}
```

### CloudWatch Dashboard Per Client

```hcl
# Terraform: monitoring.tf
resource "aws_cloudwatch_dashboard" "client" {
  dashboard_name = "${var.project_name}-${terraform.workspace}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title   = "ECS Service - Running Tasks"
          metrics = [
            ["AWS/ECS", "CPUUtilization", { stat = "Average" }],
            [".", "MemoryUtilization", { stat = "Average" }]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type = "metric"
        properties = {
          title   = "ALB - Request Count"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum" }]
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title   = "Redis - Cache Hit Rate"
          metrics = [
            ["AWS/ElastiCache", "CacheHitRate", { stat = "Average" }]
          ]
        }
      }
    ]
  })
}
```

---

## Client Onboarding Procedure

### Checklist

**1. Pre-Deployment (Client Side)**
- [ ] Discord bot created and configured
- [ ] MongoDB Atlas cluster provisioned
- [ ] OpenRouter API key obtained
- [ ] Domain name purchased (optional)
- [ ] SSL certificate requested in ACM (if using custom domain)

**2. Configuration (DevOps Side)**
- [ ] Create client configuration file: `environments/{client}-prod.tfvars`
- [ ] Add GitHub environment with secrets
- [ ] Create Terraform workspace: `terraform workspace new {client}-prod`
- [ ] Update cost allocation tags

**3. Deployment**
- [ ] Run Terraform apply
- [ ] Verify infrastructure created
- [ ] Push Docker image to ECR
- [ ] Deploy ECS service
- [ ] Verify health checks passing

**4. Post-Deployment**
- [ ] Configure DNS (Route 53 or external)
- [ ] Test Discord bot connectivity
- [ ] Set up CloudWatch alarms
- [ ] Add to monitoring dashboard
- [ ] Document client-specific configuration

**5. Handoff**
- [ ] Provide ALB URL to client
- [ ] Share CloudWatch dashboard link
- [ ] Document any custom configurations
- [ ] Schedule initial check-in

### Automation Script

```bash
#!/bin/bash
# scripts/onboard-client.sh

set -e

CLIENT_NAME=$1
ENVIRONMENT=${2:-prod}
WORKSPACE="${CLIENT_NAME}-${ENVIRONMENT}"

if [ -z "$CLIENT_NAME" ]; then
  echo "Usage: ./scripts/onboard-client.sh <client_name> [environment]"
  exit 1
fi

echo "🚀 Onboarding client: $CLIENT_NAME"

# 1. Create configuration file
echo "📝 Creating configuration file..."
cat > infra/terraform-app/environments/${WORKSPACE}.tfvars <<EOF
client_name    = "$CLIENT_NAME"
environment    = "$ENVIRONMENT"
project_name   = "cosyworld"
vpc_cidr       = "10.X.0.0/16"  # TODO: Assign unique CIDR
task_cpu       = "512"
task_memory    = "1024"
desired_count  = 2
min_capacity   = 2
max_capacity   = 10
redis_node_type = "cache.r6g.large"
redis_num_nodes = 3
EOF

echo "✏️  Edit infra/terraform-app/environments/${WORKSPACE}.tfvars and update:"
echo "   - vpc_cidr (unique CIDR block)"
echo "   - mongo_uri"
echo "   - Any client-specific settings"
read -p "Press Enter when ready to continue..."

# 2. Create Terraform workspace
echo "🏗️  Creating Terraform workspace..."
cd infra/terraform-app
terraform workspace new $WORKSPACE || terraform workspace select $WORKSPACE

# 3. Plan deployment
echo "📋 Planning deployment..."
terraform plan -var-file=environments/${WORKSPACE}.tfvars

read -p "Review plan. Continue with apply? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  terraform apply -var-file=environments/${WORKSPACE}.tfvars
  
  echo "✅ Client onboarded successfully!"
  echo ""
  echo "Next steps:"
  echo "1. Configure GitHub environment: $WORKSPACE"
  echo "2. Add secrets to GitHub environment"
  echo "3. Run deployment: workflow_dispatch with client=$WORKSPACE"
  echo "4. Configure DNS (if needed)"
  echo "5. Test application: $(terraform output -raw alb_url)"
fi
```

---

## Summary

### What We Built
- ✅ Multi-client deployment strategy using Terraform workspaces
- ✅ Isolated infrastructure per client
- ✅ Per-client secrets management
- ✅ Cost tracking with tags
- ✅ Automated client onboarding procedure
- ✅ Shared CI/CD pipeline with environment selection

### Key Benefits
- **Scalable:** Onboard new clients in < 1 hour
- **Isolated:** Complete resource separation per client
- **Cost-Efficient:** Shared Docker images, single CI/CD pipeline
- **Auditable:** Clear cost allocation and monitoring per client

### Next Steps
Proceed to **[Report 05 - Migration Plan](./05_MIGRATION_PLAN.md)** for the phased rollout from Replit to AWS.

---

*Multi-Client Strategy Version: 1.0*  
*Last Updated: November 13, 2025*
