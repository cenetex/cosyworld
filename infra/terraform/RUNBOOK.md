# Terraform Operations Runbook

## Overview

This runbook provides operational procedures for managing the CoSyWorld video upload infrastructure using Terraform. It covers deployment, updates, troubleshooting, and disaster recovery procedures.

## Prerequisites

### Required Tools
- **Terraform >= 1.5.0**
- **AWS CLI >= 2.0**
- **jq** (for JSON processing)
- **curl** (for API testing)

### Environment Setup
```bash
# Set AWS credentials
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-east-1"

# Verify credentials
aws sts get-caller-identity

# Set working directory
cd /path/to/cosyworld8/infra/terraform
```

## Initial Deployment

### 1. First-Time Setup

```bash
# Initialize Terraform
terraform init

# Create terraform.tfvars file (optional)
cat > terraform.tfvars << EOF
bucket_name = "my-custom-bucket-name"
single_max_bytes = 52428800  # 50MB
part_size = 10485760         # 10MB
url_expiry_seconds = 600     # 10 minutes
enable_notifications = true
EOF

# Validate configuration
terraform validate

# Plan deployment
terraform plan -out=deployment.plan

# Review the plan carefully
less deployment.plan

# Apply the plan
terraform apply deployment.plan
```

### 2. Post-Deployment Verification

```bash
# Get outputs
API_URL=$(terraform output -raw api_base_url)
BUCKET_NAME=$(terraform output -raw bucket_name_out)
LAMBDA_ARN=$(terraform output -raw process_object_fn_arn)

echo "API URL: $API_URL"
echo "Bucket: $BUCKET_NAME"
echo "Lambda ARN: $LAMBDA_ARN"

# Test API endpoint
curl -X POST "$API_URL/video/upload/create" \
  -H "Content-Type: application/json" \
  -d '{"fileSizeBytes": 1048576, "contentType": "video/mp4"}' \
  | jq .

# Verify S3 bucket
aws s3 ls s3://$BUCKET_NAME

# Check Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `video-upload`)].FunctionName'
```

## Regular Operations

### Updating Infrastructure

#### 1. Minor Updates (Variables)
```bash
# Update variables in terraform.tfvars
vim terraform.tfvars

# Plan and apply
terraform plan
terraform apply -auto-approve
```

#### 2. Lambda Code Updates
```bash
# Code updates are handled automatically via inline definitions
# Simply run terraform apply to update Lambda functions
terraform plan -target=aws_lambda_function.create
terraform apply -target=aws_lambda_function.create
```

#### 3. Major Infrastructure Changes
```bash
# Create a backup of current state
cp terraform.tfstate terraform.tfstate.backup.$(date +%Y%m%d%H%M)

# Plan with detailed output
terraform plan -detailed-exitcode -out=update.plan

# Review changes carefully
terraform show update.plan

# Apply with confirmation
terraform apply update.plan
```

### Monitoring and Health Checks

#### 1. Infrastructure Health Check
```bash
#!/bin/bash
# health_check.sh

API_URL=$(terraform output -raw api_base_url 2>/dev/null)
BUCKET_NAME=$(terraform output -raw bucket_name_out 2>/dev/null)

if [ -z "$API_URL" ] || [ -z "$BUCKET_NAME" ]; then
  echo "❌ Failed to get Terraform outputs"
  exit 1
fi

# Test API Gateway
echo "🔍 Testing API Gateway..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/video/upload/create" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"fileSizeBytes": 1048576}')

if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 400 ]; then
  echo "✅ API Gateway is responding (HTTP $HTTP_STATUS)"
else
  echo "❌ API Gateway health check failed (HTTP $HTTP_STATUS)"
fi

# Test S3 bucket access
echo "🔍 Testing S3 bucket access..."
if aws s3 ls s3://$BUCKET_NAME > /dev/null 2>&1; then
  echo "✅ S3 bucket is accessible"
else
  echo "❌ S3 bucket access failed"
fi

# Check Lambda functions
echo "🔍 Checking Lambda functions..."
LAMBDA_FUNCTIONS=$(aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `video-upload`)].FunctionName' \
  --output text)

for func in $LAMBDA_FUNCTIONS; do
  STATUS=$(aws lambda get-function --function-name "$func" \
    --query 'Configuration.State' --output text 2>/dev/null)
  if [ "$STATUS" = "Active" ]; then
    echo "✅ Lambda function $func is active"
  else
    echo "❌ Lambda function $func status: $STATUS"
  fi
done

echo "🔍 Health check completed"
```

#### 2. Performance Monitoring
```bash
# Monitor Lambda invocations
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/video-upload"

# Check API Gateway metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=simple-video-upload-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Monitor S3 bucket size
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=$BUCKET_NAME Name=StorageType,Value=StandardStorage \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Maximum
```

### State Management

#### 1. State Backup
```bash
# Create automated backup script
cat > backup_state.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="./state-backups"
mkdir -p $BACKUP_DIR

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp terraform.tfstate "$BACKUP_DIR/terraform.tfstate.$TIMESTAMP"
cp .terraform.lock.hcl "$BACKUP_DIR/.terraform.lock.hcl.$TIMESTAMP"

# Keep only last 10 backups
ls -t $BACKUP_DIR/terraform.tfstate.* | tail -n +11 | xargs rm -f

echo "State backed up to $BACKUP_DIR/terraform.tfstate.$TIMESTAMP"
EOF

chmod +x backup_state.sh
./backup_state.sh
```

#### 2. State Recovery
```bash
# List available backups
ls -la state-backups/

# Restore from backup
cp state-backups/terraform.tfstate.YYYYMMDD_HHMMSS terraform.tfstate

# Verify state integrity
terraform plan
```

#### 3. Remote State Migration (Future)
```bash
# Configure remote backend (recommended for production)
cat >> versions.tf << 'EOF'

terraform {
  backend "s3" {
    bucket         = "your-terraform-state-bucket"
    key            = "cosyworld/video-upload/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
EOF

# Migrate to remote state
terraform init -migrate-state
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied Errors
```bash
# Check current AWS identity
aws sts get-caller-identity

# Verify required permissions
aws iam get-user-policy --user-name $(aws sts get-caller-identity --query User.UserName --output text) --policy-name terraform-policy 2>/dev/null || echo "No inline policies"

# Test specific permissions
aws s3 ls  # Test S3 access
aws lambda list-functions --max-items 1  # Test Lambda access
aws dynamodb list-tables --max-items 1   # Test DynamoDB access
```

#### 2. Resource Already Exists
```bash
# Import existing resource
terraform import aws_s3_bucket.ingest existing-bucket-name

# Or remove from state and recreate
terraform state rm aws_s3_bucket.ingest
terraform apply
```

#### 3. Lambda Function Update Failures
```bash
# Check function status
aws lambda get-function --function-name video-upload-create

# View recent logs
aws logs tail /aws/lambda/video-upload-create --since 1h

# Manual function update
aws lambda update-function-code \
  --function-name video-upload-create \
  --zip-file fileb://build/create-upload.zip
```

#### 4. API Gateway Issues
```bash
# Check API Gateway status
API_ID=$(aws apigatewayv2 get-apis --query 'Items[?Name==`simple-video-upload-api`].ApiId' --output text)
aws apigatewayv2 get-api --api-id $API_ID

# Test specific route
aws apigatewayv2 get-routes --api-id $API_ID

# Check integration
aws apigatewayv2 get-integrations --api-id $API_ID
```

### Debug Commands

#### 1. Terraform Debug Mode
```bash
# Enable detailed logging
export TF_LOG=DEBUG
export TF_LOG_PATH=./terraform-debug.log

terraform plan
terraform apply

# Review debug log
less terraform-debug.log
```

#### 2. AWS Service Debugging
```bash
# Lambda function logs
aws logs describe-log-streams --log-group-name /aws/lambda/video-upload-create --order-by LastEventTime --descending --max-items 5

# API Gateway access logs (if enabled)
aws logs describe-log-groups --log-group-name-prefix /aws/apigateway/

# CloudFormation events (if using)
aws cloudformation describe-stack-events --stack-name your-stack-name --max-items 10
```

## Disaster Recovery

### 1. Complete Infrastructure Loss

```bash
# Emergency deployment script
cat > emergency_deploy.sh << 'EOF'
#!/bin/bash
set -e

echo "🚨 Emergency deployment starting..."

# Backup any existing state
if [ -f terraform.tfstate ]; then
  cp terraform.tfstate terraform.tfstate.emergency.$(date +%Y%m%d%H%M)
fi

# Initialize clean environment
rm -rf .terraform
terraform init

# Deploy with minimal configuration
terraform apply -var enable_notifications=false -auto-approve

echo "✅ Emergency deployment completed"
echo "📝 Remember to:"
echo "   1. Verify all outputs"
echo "   2. Test API endpoints"
echo "   3. Configure S3 notifications if needed"
echo "   4. Update application configuration"
EOF

chmod +x emergency_deploy.sh
```

### 2. Partial Service Recovery

```bash
# Recreate specific resources
terraform taint aws_lambda_function.create
terraform apply -target=aws_lambda_function.create

# Recreate API Gateway
terraform taint aws_apigatewayv2_api.api
terraform apply -target=aws_apigatewayv2_api.api
```

### 3. Data Recovery

```bash
# List S3 objects for verification
aws s3 ls s3://$BUCKET_NAME/uploads/ --recursive --human-readable

# Check DynamoDB table contents
aws dynamodb scan --table-name UploadSessions --max-items 10

# Verify data integrity
aws s3api head-object --bucket $BUCKET_NAME --key uploads/2025-08-21/test-file.mp4
```

## Security Operations

### 1. Security Audit

```bash
# Check bucket public access
aws s3api get-public-access-block --bucket $BUCKET_NAME

# Review IAM roles and policies
aws iam get-role --role-name video-upload-lambda-role
aws iam list-attached-role-policies --role-name video-upload-lambda-role

# Check Lambda function permissions
aws lambda get-policy --function-name video-upload-create

# Audit API Gateway authorizers
aws apigatewayv2 get-authorizers --api-id $API_ID
```

### 2. Security Hardening

```bash
# Enable S3 access logging
aws s3api put-bucket-logging \
  --bucket $BUCKET_NAME \
  --bucket-logging-status file://logging-config.json

# Enable API Gateway logging
aws apigatewayv2 update-stage \
  --api-id $API_ID \
  --stage-name prod \
  --access-log-settings DestinationArn=arn:aws:logs:region:account:log-group:api-gateway-logs,Format='$requestId $ip $requestTime $httpMethod $resourcePath $status $error.message'
```

### 3. Compliance Checks

```bash
# Encryption verification
aws s3api get-bucket-encryption --bucket $BUCKET_NAME
aws kms describe-key --key-id alias/aws/s3

# Access pattern analysis
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=$BUCKET_NAME \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --max-items 50
```

## Cost Management

### 1. Cost Monitoring

```bash
# S3 storage costs
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter file://s3-filter.json

# Lambda execution costs
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter file://lambda-filter.json
```

### 2. Resource Optimization

```bash
# Analyze S3 storage classes
aws s3api list-objects-v2 --bucket $BUCKET_NAME --query 'Contents[?StorageClass!=`STANDARD`]'

# Check Lambda memory utilization
aws logs filter-log-events \
  --log-group-name /aws/lambda/video-upload-create \
  --start-time $(date -u -d '7 days ago' +%s)000 \
  --filter-pattern "REPORT RequestId" \
  | jq -r '.events[].message' \
  | grep "Max Memory Used"

# DynamoDB capacity utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=UploadSessions \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average,Maximum
```

## Maintenance Procedures

### 1. Regular Maintenance Tasks

```bash
# Weekly maintenance script
cat > weekly_maintenance.sh << 'EOF'
#!/bin/bash

echo "🔧 Starting weekly maintenance..."

# 1. State backup
./backup_state.sh

# 2. Security check
echo "🔒 Running security audit..."
./security_audit.sh

# 3. Performance check
echo "📊 Checking performance metrics..."
./health_check.sh

# 4. Cost analysis
echo "💰 Analyzing costs..."
./cost_report.sh

# 5. Update Terraform providers
echo "⬆️ Checking for provider updates..."
terraform init -upgrade

echo "✅ Weekly maintenance completed"
EOF

chmod +x weekly_maintenance.sh
```

### 2. Version Updates

```bash
# Update Terraform version
terraform version
# Download and install latest version from terraform.io

# Update AWS CLI
aws --version
pip install --upgrade awscli

# Update provider versions in versions.tf
vim versions.tf
terraform init -upgrade
```

## Emergency Contacts and Escalation

### 1. Emergency Response Team
- **Primary**: Infrastructure Team Lead
- **Secondary**: Senior DevOps Engineer  
- **Escalation**: Engineering Manager

### 2. Emergency Procedures
1. **Immediate Response** (0-15 minutes)
   - Assess impact scope
   - Check AWS Service Health Dashboard
   - Run health check script

2. **Initial Investigation** (15-30 minutes)
   - Review recent changes
   - Check Terraform state
   - Analyze error logs

3. **Resolution** (30+ minutes)
   - Implement fix or rollback
   - Verify service restoration
   - Document incident

### 3. Communication Template
```
INCIDENT: Video Upload Service Degradation
STATUS: [INVESTIGATING/IDENTIFIED/MONITORING/RESOLVED]
IMPACT: [Brief description]
SERVICES AFFECTED: [List affected components]
ACTIONS TAKEN: [What has been done]
NEXT STEPS: [Planned actions]
ETA: [Expected resolution time]
```

---

*Runbook Version: 1.0*
*Last Updated: August 21, 2025*
