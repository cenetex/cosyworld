locals {
  bucket_name_arg = var.bucket_name != "" ? var.bucket_name : null
}

resource "aws_s3_bucket" "ingest" {
  bucket = local.bucket_name_arg
}

resource "aws_s3_bucket_public_access_block" "ingest" {
  bucket                  = aws_s3_bucket.ingest.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "ingest" {
  bucket = aws_s3_bucket.ingest.id

  rule {
    id     = "ExpireAfter180Days"
    status = "Enabled"
    filter {
      prefix = ""
    }
    expiration {
      days = 180
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "ingest" {
  bucket = aws_s3_bucket.ingest.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_dynamodb_table" "upload_sessions" {
  name         = "UploadSessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "uploadSessionId"

  attribute {
    name = "uploadSessionId"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "aws_iam_role" "lambda" {
  name               = "video-upload-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "basic_exec" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_inline" {
  statement {
    sid = "S3Objects"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:CreateMultipartUpload",
      "s3:UploadPart",
      "s3:CompleteMultipartUpload"
    ]
    resources = ["${aws_s3_bucket.ingest.arn}/uploads/*"]
  }
  statement {
    sid       = "S3ListMultipart"
    actions   = ["s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.ingest.arn]
  }
  statement {
    sid = "DDBCrud"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem"
    ]
    resources = [aws_dynamodb_table.upload_sessions.arn]
  }
}

resource "aws_iam_role_policy" "lambda_inline" {
  name   = "video-upload-inline"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_inline.json
}

# Lambda packages (inline content -> zip)

data "archive_file" "create_zip" {
  type        = "zip"
  output_path = "${path.module}/build/create-upload.zip"
  source_dir  = "${path.module}/../lambdas/create-upload"
}

data "archive_file" "parts_zip" {
  type        = "zip"
  output_path = "${path.module}/build/parts-upload.zip"
  source_dir  = "${path.module}/../lambdas/parts-upload"
}

data "archive_file" "complete_zip" {
  type        = "zip"
  output_path = "${path.module}/build/complete-upload.zip"
  source_dir  = "${path.module}/../lambdas/complete-upload"
}

data "archive_file" "process_zip" {
  type        = "zip"
  output_path = "${path.module}/build/process-object.zip"
  source_dir  = "${path.module}/../lambdas/process-object"
}

resource "aws_lambda_function" "create" {
  function_name = "video-upload-create"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10

  filename         = data.archive_file.create_zip.output_path
  source_code_hash = data.archive_file.create_zip.output_base64sha256

  environment {
    variables = {
      BUCKET             = aws_s3_bucket.ingest.bucket
      TABLE_NAME         = aws_dynamodb_table.upload_sessions.name
      SINGLE_MAX_BYTES   = var.single_max_bytes
      PART_SIZE          = var.part_size
      URL_EXPIRY_SECONDS = var.url_expiry_seconds
    }
  }
}

resource "aws_lambda_function" "parts" {
  function_name = "video-upload-parts"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 10

  filename         = data.archive_file.parts_zip.output_path
  source_code_hash = data.archive_file.parts_zip.output_base64sha256

  environment {
    variables = {
      BUCKET             = aws_s3_bucket.ingest.bucket
      TABLE_NAME         = aws_dynamodb_table.upload_sessions.name
      URL_EXPIRY_SECONDS = var.url_expiry_seconds
    }
  }
}

resource "aws_lambda_function" "complete" {
  function_name = "video-upload-complete"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 15

  filename         = data.archive_file.complete_zip.output_path
  source_code_hash = data.archive_file.complete_zip.output_base64sha256

  environment {
    variables = {
      BUCKET     = aws_s3_bucket.ingest.bucket
      TABLE_NAME = aws_dynamodb_table.upload_sessions.name
    }
  }
}

resource "aws_lambda_function" "process" {
  function_name = "video-upload-process"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  timeout       = 15

  filename         = data.archive_file.process_zip.output_path
  source_code_hash = data.archive_file.process_zip.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.upload_sessions.name
    }
  }
}

# Allow S3 to invoke the process function (bucket notifications configured post-deploy)
resource "aws_lambda_permission" "s3_invoke" {
  statement_id   = "s3-invoke-uploads"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.process.function_name
  principal      = "s3.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = aws_s3_bucket.ingest.arn
}

data "aws_caller_identity" "current" {}

# HTTP API
resource "aws_apigatewayv2_api" "api" {
  name          = "simple-video-upload-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "parts" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.parts.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "complete" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.complete.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /video/upload/create"
  target    = "integrations/${aws_apigatewayv2_integration.create.id}"
}

resource "aws_apigatewayv2_route" "parts" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /video/upload/parts"
  target    = "integrations/${aws_apigatewayv2_integration.parts.id}"
}

resource "aws_apigatewayv2_route" "complete" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /video/upload/complete"
  target    = "integrations/${aws_apigatewayv2_integration.complete.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "prod"
  auto_deploy = true
}

# API -> Lambda permissions
resource "aws_lambda_permission" "apigw_create" {
  statement_id  = "AllowAPIGatewayInvokeCreate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*/video/upload/create"
}

resource "aws_lambda_permission" "apigw_parts" {
  statement_id  = "AllowAPIGatewayInvokeParts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.parts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*/video/upload/parts"
}

resource "aws_lambda_permission" "apigw_complete" {
  statement_id  = "AllowAPIGatewayInvokeComplete"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.complete.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*/video/upload/complete"
}

data "aws_region" "current" {}

# Optional: run setup script to attach S3 notifications
resource "null_resource" "setup_notifications" {
  count = var.enable_notifications ? 1 : 0

  triggers = {
    bucket = aws_s3_bucket.ingest.bucket
    lambda = aws_lambda_function.process.arn
  }

  provisioner "local-exec" {
    command     = "../setup-notifications.sh ${aws_s3_bucket.ingest.bucket} ${aws_lambda_function.process.arn}"
    working_dir = path.module
    interpreter = ["/bin/bash", "-c"]
  }
}

###############################################
# CloudFront (optional)
###############################################

resource "aws_cloudfront_origin_access_control" "oac" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "ingest-oac"
  description                       = "OAC for ingest bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_s3_bucket" "ingest_lookup" {
  bucket = aws_s3_bucket.ingest.id
}

locals {
  ingest_bucket_domain_name = data.aws_s3_bucket.ingest_lookup.bucket_regional_domain_name
}

resource "aws_cloudfront_distribution" "cdn" {
  count               = var.enable_cloudfront ? 1 : 0
  enabled             = true
  comment             = "Cosyworld ingest CDN"
  default_root_object = null

  origin {
    domain_name              = local.ingest_bucket_domain_name
    origin_id                = "s3-ingest-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac[0].id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-ingest-origin"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "oac_bucket_policy" {
  count = var.enable_cloudfront ? 1 : 0

  statement {
    sid     = "AllowCloudFrontOAC"
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.ingest.arn}/*"
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.cdn[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "ingest_oac" {
  count  = var.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.ingest.id
  policy = data.aws_iam_policy_document.oac_bucket_policy[0].json
}
