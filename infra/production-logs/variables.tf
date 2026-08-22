variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region receiving production logs from the Fly log shipper."
}

variable "log_group_name" {
  type        = string
  default     = "/cosyworld/production"
  description = "CloudWatch Logs group shared by the two production Fly apps."
}

variable "retention_days" {
  type        = number
  default     = 30
  description = "Age-based CloudWatch retention. Must remain at least 14 days."

  validation {
    condition = var.retention_days >= 14 && contains([
      14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827,
      2192, 2557, 2922, 3288, 3653,
    ], var.retention_days)
    error_message = "Production log retention must be a CloudWatch-supported duration of at least 14 days."
  }
}

variable "shipper_iam_user_name" {
  type        = string
  default     = "cosyworld-fly-log-shipper"
  description = "IAM service user whose access key is stored only as Fly secrets."
}

variable "alarm_email_endpoints" {
  type        = set(string)
  default     = []
  description = "Optional email addresses subscribed to the incident SNS topic. AWS requires each address to confirm."
}
