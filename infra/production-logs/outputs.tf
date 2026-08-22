output "log_group_name" {
  value       = aws_cloudwatch_log_group.production.name
  description = "Set this as CLOUDWATCH_LOG_GROUP_NAME on the Fly log shipper."
}

output "shipper_iam_user_name" {
  value       = aws_iam_user.fly_log_shipper.name
  description = "Create one access key for this user outside Terraform, then store it only in Fly secrets."
}

output "incident_reader_policy_arn" {
  value       = aws_iam_policy.incident_reader.arn
  description = "Attach this query-only policy to approved incident-response roles."
}

output "incident_topic_arn" {
  value       = aws_sns_topic.incident_alerts.arn
  description = "SNS topic used by all production-log alarms."
}

output "alarm_names" {
  value       = sort([for alarm in aws_cloudwatch_metric_alarm.incident : alarm.alarm_name])
  description = "CloudWatch alarms created from normalized incident classifications."
}
