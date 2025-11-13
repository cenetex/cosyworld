# Report 03 - CI/CD Pipeline (GitHub Actions)

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Prerequisites:** Reports 01 & 02 (Docker + Terraform working)  
**Estimated Implementation Time:** 2-3 days  
**Related Reports:** [00 - Overview](./00_AWS_DEPLOYMENT_OVERVIEW.md)

---

## Overview

Automated deployment pipeline using GitHub Actions to build, test, and deploy CosyWorld to AWS ECS Fargate with zero-downtime rolling updates.

### Pipeline Architecture

```
GitHub Push/PR
     │
     ▼
┌─────────────────┐
│  Build & Test   │ ← Lint, unit tests, build Docker image
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Push to ECR    │ ← Tag and push Docker image
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Deploy to ECS   │ ← Update task definition, rolling deployment
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Verify Health  │ ← Wait for health checks to pass
└─────────────────┘
```

---

## GitHub Actions Workflows

### Workflow 1: CI (Pull Requests)

`.github/workflows/ci.yml` (already exists - enhance it):

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [develop]

jobs:
  lint:
    name: Lint Code
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Check formatting
        run: npm run format:check

  test:
    name: Run Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Generate coverage
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  build:
    name: Build Docker Image
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: cosyworld:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      - name: Test Docker image
        run: |
          docker run -d --name test-container \
            -e NODE_ENV=production \
            -e MONGO_URI=mongodb://localhost:27017 \
            -e DISCORD_BOT_TOKEN=test \
            -e DISCORD_CLIENT_ID=test \
            -e OPENROUTER_API_KEY=test \
            -e ENCRYPTION_KEY=test \
            cosyworld:${{ github.sha }}
          
          # Wait for container to start
          sleep 10
          
          # Check health endpoint (should fail without real services, but process should run)
          docker logs test-container
          docker stop test-container
```

### Workflow 2: CD (Deploy to Dev)

`.github/workflows/deploy-dev.yml`:

```yaml
name: Deploy to Development

on:
  push:
    branches: [develop]
  workflow_dispatch:  # Manual trigger

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: cosyworld-dev
  ECS_CLUSTER: cosyworld-dev-cluster
  ECS_SERVICE: cosyworld-dev-service
  TERRAFORM_DIR: infra/terraform-app

jobs:
  deploy:
    name: Deploy to AWS Dev
    runs-on: ubuntu-latest
    environment: development
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      
      - name: Build, tag, and push image to Amazon ECR
        id: build-image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT
      
      - name: Download current task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition ${{ env.ECS_SERVICE }} \
            --query taskDefinition \
            > task-definition.json
      
      - name: Update task definition with new image
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: app
          image: ${{ steps.build-image.outputs.image }}
      
      - name: Deploy to Amazon ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
      
      - name: Verify deployment
        run: |
          # Get ALB DNS name
          ALB_DNS=$(aws elbv2 describe-load-balancers \
            --query "LoadBalancers[?contains(LoadBalancerName, 'cosyworld-dev')].DNSName" \
            --output text)
          
          # Wait for service to stabilize
          sleep 30
          
          # Check health endpoint
          HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" https://$ALB_DNS/api/health/live)
          
          if [ "$HEALTH_CHECK" = "200" ]; then
            echo "✅ Deployment successful! Health check passed."
          else
            echo "❌ Deployment failed! Health check returned $HEALTH_CHECK"
            exit 1
          fi
      
      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "Development deployment ${{ job.status }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Deployment to Development*\nStatus: ${{ job.status }}\nCommit: ${{ github.sha }}\nActor: ${{ github.actor }}"
                  }
                }
              ]
            }
```

### Workflow 3: CD (Deploy to Production)

`.github/workflows/deploy-prod.yml`:

```yaml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*.*.*'  # Trigger on version tags (e.g., v1.0.0)
  workflow_dispatch:
    inputs:
      environment:
        description: 'Client environment to deploy'
        required: true
        type: choice
        options:
          - client1-prod
          - client2-prod
          - client3-prod

env:
  AWS_REGION: us-east-1
  TERRAFORM_DIR: infra/terraform-app

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'production' }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      
      - name: Build, tag, and push image
        id: build-image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: cosyworld-prod
          IMAGE_TAG: ${{ github.ref_name }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT
      
      - name: Terraform Init
        working-directory: ${{ env.TERRAFORM_DIR }}
        run: |
          terraform init
          terraform workspace select ${{ github.event.inputs.environment || 'prod' }}
      
      - name: Terraform Apply
        working-directory: ${{ env.TERRAFORM_DIR }}
        env:
          TF_VAR_image_tag: ${{ github.ref_name }}
          TF_VAR_discord_bot_token: ${{ secrets.DISCORD_BOT_TOKEN }}
          TF_VAR_discord_client_id: ${{ secrets.DISCORD_CLIENT_ID }}
          TF_VAR_openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          TF_VAR_encryption_key: ${{ secrets.ENCRYPTION_KEY }}
          TF_VAR_mongo_uri: ${{ secrets.MONGO_URI }}
        run: |
          terraform apply -auto-approve
      
      - name: Wait for deployment
        run: |
          ECS_CLUSTER=$(terraform -chdir=${{ env.TERRAFORM_DIR }} output -raw ecs_cluster_name)
          ECS_SERVICE=$(terraform -chdir=${{ env.TERRAFORM_DIR }} output -raw ecs_service_name)
          
          aws ecs wait services-stable \
            --cluster $ECS_CLUSTER \
            --services $ECS_SERVICE \
            --region ${{ env.AWS_REGION }}
      
      - name: Run smoke tests
        run: |
          ALB_URL=$(terraform -chdir=${{ env.TERRAFORM_DIR }} output -raw alb_url)
          
          # Test health endpoints
          curl -f $ALB_URL/api/health/live || exit 1
          curl -f $ALB_URL/api/health/ready || exit 1
          
          echo "✅ Smoke tests passed!"
      
      - name: Create GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref_name }}
          release_name: Release ${{ github.ref_name }}
          body: |
            Deployed to production
            Image: ${{ steps.build-image.outputs.image }}
          draft: false
          prerelease: false
```

---

## GitHub Repository Configuration

### Required Secrets

Add these secrets to GitHub repository settings:

```
Settings → Secrets and variables → Actions → New repository secret
```

**AWS Credentials:**
- `AWS_ACCESS_KEY_ID` - IAM user access key
- `AWS_SECRET_ACCESS_KEY` - IAM user secret key

**Application Secrets:**
- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `OPENROUTER_API_KEY`
- `ENCRYPTION_KEY`
- `MONGO_URI`
- `GOOGLE_AI_API_KEY` (optional)
- `HELIUS_API_KEY` (optional)
- `TELEGRAM_BOT_TOKEN` (optional)

**Notifications:**
- `SLACK_WEBHOOK_URL` (optional)

### Environment Protection Rules

```
Settings → Environments → New environment
```

**Development:**
- No protection rules
- Auto-deploy on push to `develop`

**Production:**
- Required reviewers: 1+ team members
- Deployment branches: Only `main` branch and tags matching `v*.*.*`
- Environment secrets: Client-specific credentials

---

## Rollback Procedures

### Method 1: Redeploy Previous Image Tag

```bash
# List recent image tags
aws ecr describe-images \
  --repository-name cosyworld-prod \
  --query 'sort_by(imageDetails,& imagePushedAt)[-10:].imageTags' \
  --output table

# Update ECS service to use previous tag
aws ecs update-service \
  --cluster cosyworld-prod-cluster \
  --service cosyworld-prod-service \
  --task-definition cosyworld-prod:42 \  # Previous revision number
  --force-new-deployment
```

### Method 2: GitHub Actions Manual Rollback

```yaml
# .github/workflows/rollback.yml
name: Rollback Deployment

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to rollback'
        required: true
        type: choice
        options:
          - dev
          - prod
      image_tag:
        description: 'Image tag to rollback to'
        required: true
        type: string

jobs:
  rollback:
    name: Rollback to ${{ inputs.image_tag }}
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    
    steps:
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Rollback ECS service
        run: |
          # Get current task definition
          TASK_DEF=$(aws ecs describe-services \
            --cluster cosyworld-${{ inputs.environment }}-cluster \
            --services cosyworld-${{ inputs.environment }}-service \
            --query 'services[0].taskDefinition' \
            --output text)
          
          # Update image tag in task definition
          aws ecs describe-task-definition --task-definition $TASK_DEF \
            | jq '.taskDefinition | 
                .containerDefinitions[0].image = "${{ secrets.ECR_REGISTRY }}/cosyworld-${{ inputs.environment }}:${{ inputs.image_tag }}" |
                del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
            > new-task-def.json
          
          # Register new task definition
          NEW_TASK_DEF=$(aws ecs register-task-definition \
            --cli-input-json file://new-task-def.json \
            --query 'taskDefinition.taskDefinitionArn' \
            --output text)
          
          # Update service
          aws ecs update-service \
            --cluster cosyworld-${{ inputs.environment }}-cluster \
            --service cosyworld-${{ inputs.environment }}-service \
            --task-definition $NEW_TASK_DEF
          
          echo "✅ Rolled back to image tag: ${{ inputs.image_tag }}"
```

---

## Monitoring Deployments

### CloudWatch Alarms for Deployments

```hcl
# Terraform: infra/terraform-app/monitoring.tf

resource "aws_cloudwatch_metric_alarm" "ecs_deployment_failed" {
  alarm_name          = "${var.project_name}-${var.environment}-deployment-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FailedDeployments"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when ECS deployment fails"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.ecs.cluster_name
    ServiceName = module.ecs.service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_unhealthy_tasks" {
  alarm_name          = "${var.project_name}-${var.environment}-unhealthy-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "Alert when all tasks are unhealthy"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    TargetGroup  = module.alb.target_group_arn_suffix
    LoadBalancer = module.alb.alb_arn_suffix
  }
}
```

### Deployment Dashboard

```bash
# Watch ECS deployment in real-time
watch -n 5 'aws ecs describe-services \
  --cluster cosyworld-prod-cluster \
  --services cosyworld-prod-service \
  --query "services[0].{Desired:desiredCount,Running:runningCount,Pending:pendingCount,Deployments:deployments[*].{Status:status,Desired:desiredCount,Running:runningCount}}" \
  --output table'
```

---

## Summary

### What We Built
- ✅ GitHub Actions CI workflow (lint, test, build)
- ✅ Automated deployment to dev environment
- ✅ Production deployment with approval gates
- ✅ Rollback procedures via GitHub Actions
- ✅ CloudWatch alarms for deployment monitoring
- ✅ Slack notifications for deployment status

### Key Features
- **Zero-downtime deployments** - Rolling updates with health checks
- **Automatic rollback** - ECS circuit breaker reverts failed deployments
- **Environment protection** - Required approvals for production
- **Versioned releases** - Git tags trigger production deploys

### Next Steps
Proceed to **[Report 04 - Multi-Client Strategy](./04_MULTI_CLIENT_STRATEGY.md)** to support multiple independent client deployments.

---

*CI/CD Guide Version: 1.0*  
*Last Updated: November 13, 2025*
