variable "bucket_name" {
  type        = string
  default     = ""
  description = "Optional custom S3 bucket name. Leave empty for auto-generated."
}

variable "single_max_bytes" {
  type        = number
  default     = 26214400
  description = "Max size for single-part upload"
}

variable "part_size" {
  type        = number
  default     = 5242880
  description = "Multipart part size in bytes (>= 5 MiB)"
}

variable "url_expiry_seconds" {
  type        = number
  default     = 300
  description = "Presigned URL expiry"
}

variable "enable_notifications" {
  type        = bool
  default     = false
  description = "If true, run post-deploy script to attach S3->Lambda notifications"
}

variable "enable_cloudfront" {
  type        = bool
  default     = true
  description = "If true, create a CloudFront distribution in front of the ingest bucket using OAC"
}
