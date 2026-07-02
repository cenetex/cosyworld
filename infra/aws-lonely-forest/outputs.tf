output "account_id" {
  value       = data.aws_caller_identity.current.account_id
  description = "AWS account where the stack is applied."
}

output "app_url" {
  value       = "https://${var.app_domain}"
  description = "Live app URL."
}

output "archive_url" {
  value       = "https://${var.archive_domain}"
  description = "Archive/library URL."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "Push the orchestrator image here before applying/updating the ECS service."
}

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "GitHub Actions OIDC role used by tagged AWS releases."
}

output "alb_dns_name" {
  value       = aws_lb.app.dns_name
  description = "Application Load Balancer DNS name."
}

output "archive_cloudfront_domain" {
  value       = aws_cloudfront_distribution.archive.domain_name
  description = "CloudFront distribution domain for the archive site."
}

output "app_name_servers" {
  value       = var.create_hosted_zones ? aws_route53_zone.app[0].name_servers : []
  description = "Name servers to set at the registrar when create_hosted_zones is true."
}

output "archive_name_servers" {
  value       = var.create_hosted_zones ? aws_route53_zone.archive[0].name_servers : []
  description = "Name servers to set at the registrar when create_hosted_zones is true."
}
