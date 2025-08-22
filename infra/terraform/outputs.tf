output "api_base_url" {
  value = "${aws_apigatewayv2_api.api.api_endpoint}/prod"
}

output "bucket_name_out" {
  value = aws_s3_bucket.ingest.bucket
}

output "process_object_fn_arn" {
  value = aws_lambda_function.process.arn
}

output "cloudfront_domain" {
  value       = var.enable_cloudfront && length(aws_cloudfront_distribution.cdn) > 0 ? aws_cloudfront_distribution.cdn[0].domain_name : null
  description = "CloudFront domain for ingest bucket (if enabled)"
}
