# Terraform (simplified) for video upload service

This module mirrors the simplified CloudFormation: S3 ingest bucket, DynamoDB table, Lambda functions (create/parts/complete/process), HTTP API, and permissions. S3 notifications are attached post-deploy via script to avoid circular deps.

## Usage

- Ensure AWS credentials and region are configured (AWS_REGION or AWS_DEFAULT_REGION)

```
cd infra/terraform
terraform init
terraform apply -auto-approve
```

Outputs:
- api_base_url
- bucket_name_out
- process_object_fn_arn

Attach S3 notifications (ObjectCreated for uploads/ prefix):
```
../setup-notifications.sh "$(terraform output -raw bucket_name_out)" "$(terraform output -raw process_object_fn_arn)"
```

Optional: enable automatic attach via Terraform (requires AWS CLI locally):
```
terraform apply -var enable_notifications=true
```

Variables:
- bucket_name (default "")
- single_max_bytes (default 26214400)
- part_size (default 5242880)
- url_expiry_seconds (default 300)
- enable_notifications (default false)
