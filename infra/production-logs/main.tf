locals {
  metric_namespace = "CosyWorld/ProductionLogs"
  alerts = {
    forced_exit = {
      description = "A Fly process exceeded its graceful shutdown budget or was forcibly terminated."
      threshold   = 1
      period      = 60
    }
    health_failure = {
      description = "Required production health checks repeatedly failed."
      threshold   = 1
      period      = 300
    }
    oom = {
      description = "A production process or Machine reported an out-of-memory exit."
      threshold   = 1
      period      = 60
    }
    panic = {
      description = "A production process panicked."
      threshold   = 1
      period      = 60
    }
    provider_unavailable = {
      description = "AI provider unavailability persisted across the retry window."
      threshold   = 5
      period      = 600
    }
    actor_job_failure = {
      description = "An actor job entered the durable dead state after exhausting retries or encountering a terminal provider route."
      threshold   = 1
      period      = 60
    }
  }
}

resource "aws_cloudwatch_log_group" "production" {
  name              = var.log_group_name
  retention_in_days = var.retention_days

  tags = {
    Application = "cosyworld"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_user" "fly_log_shipper" {
  name = var.shipper_iam_user_name
  path = "/service-accounts/"

  tags = {
    Application = "cosyworld"
    Purpose     = "fly-log-shipping"
    ManagedBy   = "terraform"
  }
}

data "aws_iam_policy_document" "fly_log_shipper" {
  statement {
    sid = "WriteOnlyCosyWorldProductionLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.production.arn}:*"]
  }
}

resource "aws_iam_user_policy" "fly_log_shipper" {
  name   = "write-cosyworld-production-logs"
  user   = aws_iam_user.fly_log_shipper.name
  policy = data.aws_iam_policy_document.fly_log_shipper.json
}

data "aws_iam_policy_document" "incident_reader" {
  statement {
    sid = "QueryOnlyCosyWorldProductionLogs"
    actions = [
      "logs:DescribeLogStreams",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:GetLogGroupFields",
      "logs:GetLogRecord",
      "logs:GetQueryResults",
      "logs:StartQuery",
      "logs:StopQuery",
    ]
    resources = [
      aws_cloudwatch_log_group.production.arn,
      "${aws_cloudwatch_log_group.production.arn}:*",
    ]
  }
}

resource "aws_iam_policy" "incident_reader" {
  name        = "cosyworld-production-log-reader"
  description = "Query-only access to the CosyWorld production incident log group."
  policy      = data.aws_iam_policy_document.incident_reader.json

  tags = {
    Application = "cosyworld"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}


resource "aws_sns_topic" "incident_alerts" {
  name = "cosyworld-production-log-alerts"

  tags = {
    Application = "cosyworld"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

resource "aws_sns_topic_subscription" "incident_email" {
  for_each  = var.alarm_email_endpoints
  topic_arn = aws_sns_topic.incident_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_cloudwatch_log_metric_filter" "incident" {
  for_each = local.alerts

  name           = "cosyworld-production-${replace(each.key, "_", "-")}"
  pattern        = "{ $.alert_kind = \"${each.key}\" }"
  log_group_name = aws_cloudwatch_log_group.production.name

  metric_transformation {
    name      = each.key
    namespace = local.metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "incident" {
  for_each = local.alerts

  alarm_name          = "cosyworld-production-${replace(each.key, "_", "-")}"
  alarm_description   = each.value.description
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = each.value.threshold
  period              = each.value.period
  statistic           = "Sum"
  namespace           = local.metric_namespace
  metric_name         = each.key
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.incident_alerts.arn]
  ok_actions          = [aws_sns_topic.incident_alerts.arn]

  tags = {
    Application = "cosyworld"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  depends_on = [aws_cloudwatch_log_metric_filter.incident]
}
