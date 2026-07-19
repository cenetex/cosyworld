data "aws_caller_identity" "current" {}

locals {
  terraform_state_bucket = "cosyworld-lonely-forest-terraform-state-${data.aws_caller_identity.current.account_id}"
  terraform_lock_table   = "cosyworld-lonely-forest-terraform-locks"
}

data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

locals {
  app_www_domain     = "www.${var.app_domain}"
  archive_www_domain = "www.${var.archive_domain}"
  app_zone_name      = "${var.app_domain}."
  archive_zone_name  = "${var.archive_domain}."
  vpc_id             = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "default" {
  count = length(var.subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

locals {
  default_subnet_ids          = length(var.subnet_ids) == 0 ? sort(data.aws_subnets.default[0].ids) : []
  selected_default_subnet_ids = slice(local.default_subnet_ids, 0, min(var.default_subnet_limit, length(local.default_subnet_ids)))
  subnet_ids                  = length(var.subnet_ids) > 0 ? var.subnet_ids : local.selected_default_subnet_ids
}

data "aws_subnet" "selected" {
  for_each = toset(local.subnet_ids)
  id       = each.value
}

locals {
  efs_subnet_ids_by_az_grouped = {
    for subnet_id, subnet in data.aws_subnet.selected : subnet.availability_zone => subnet_id...
  }
  efs_subnet_ids_by_az = {
    for az, subnet_ids in local.efs_subnet_ids_by_az_grouped : az => subnet_ids[0]
  }
}

resource "aws_route53_zone" "app" {
  count = var.create_hosted_zones ? 1 : 0
  name  = var.app_domain
}

resource "aws_route53_zone" "archive" {
  count = var.create_hosted_zones ? 1 : 0
  name  = var.archive_domain
}

data "aws_route53_zone" "app" {
  count        = var.create_hosted_zones ? 0 : 1
  name         = local.app_zone_name
  private_zone = false
}

data "aws_route53_zone" "archive" {
  count        = var.create_hosted_zones ? 0 : 1
  name         = local.archive_zone_name
  private_zone = false
}

locals {
  app_zone_id     = var.create_hosted_zones ? aws_route53_zone.app[0].zone_id : data.aws_route53_zone.app[0].zone_id
  archive_zone_id = var.create_hosted_zones ? aws_route53_zone.archive[0].zone_id : data.aws_route53_zone.archive[0].zone_id
}

resource "aws_acm_certificate" "site" {
  domain_name = var.app_domain
  subject_alternative_names = compact([
    var.enable_www_records ? local.app_www_domain : "",
    var.archive_domain,
    var.enable_www_records ? local.archive_www_domain : "",
  ])
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  validation_records = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      zone_id = endswith(dvo.domain_name, var.archive_domain) ? local.archive_zone_id : local.app_zone_id
      name    = dvo.resource_record_name
      type    = dvo.resource_record_type
      value   = dvo.resource_record_value
    }
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.validation_records

  allow_overwrite = true
  zone_id         = each.value.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.value]
}

resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

resource "aws_ecr_repository" "app" {
  name                 = "${var.name_prefix}-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.github_oidc_thumbprint]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/tags/v*",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.name_prefix}-github-actions-deployer"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
}

data "aws_iam_policy_document" "github_actions_deploy" {
  statement {
    sid = "TerraformBackendS3"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/lonely-forest/*"]
  }

  statement {
    sid       = "TerraformBackendS3List"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["lonely-forest/*"]
    }
  }

  statement {
    sid = "TerraformBackendLocks"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem",
    ]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.terraform_lock_table}"]
  }

  statement {
    sid = "EcrImagePush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:ListTagsForResource",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "TerraformRefreshReadOnly"
    actions = [
      "ec2:Describe*",
      "acm:DescribeCertificate",
      "acm:ListTagsForCertificate",
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
      "cloudfront:GetOriginAccessControl",
      "cloudfront:ListDistributions",
      "cloudfront:ListTagsForResource",
      "ecs:DescribeClusters",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "elasticfilesystem:DescribeAccessPoints",
      "elasticfilesystem:DescribeFileSystems",
      "elasticfilesystem:DescribeLifecycleConfiguration",
      "elasticfilesystem:DescribeMountTargetSecurityGroups",
      "elasticfilesystem:DescribeMountTargets",
      "elasticloadbalancing:DescribeListenerAttributes",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeLoadBalancerAttributes",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeRules",
      "elasticloadbalancing:DescribeTags",
      "elasticloadbalancing:DescribeTargetGroupAttributes",
      "elasticloadbalancing:DescribeTargetGroups",
      "logs:DescribeLogGroups",
      "logs:ListTagsForResource",
    ]
    resources = ["*"]
  }

  statement {
    sid = "IamRefreshReadOnly"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
    ]
    resources = [
      aws_iam_role.ecs_execution.arn,
      aws_iam_role.ecs_task.arn,
      aws_iam_role.github_actions.arn,
    ]
  }

  statement {
    sid = "IamOidcReadOnly"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:ListOpenIDConnectProviders",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ArchiveSiteObjectWrites"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectTagging",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.archive.arn}/*"]
  }

  statement {
    sid = "ArchiveBucketReads"
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucketLocation",
      "s3:GetBucketLogging",
      "s3:GetBucketPolicy",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketRequestPayment",
      "s3:GetBucketTagging",
      "s3:GetBucketAcl",
      "s3:GetBucketCORS",
      "s3:GetBucketWebsite",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.archive.arn]
  }

  statement {
    sid = "Route53ReadOnly"
    actions = [
      "route53:GetHostedZone",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource",
    ]
    resources = [
      "arn:aws:route53:::hostedzone/${local.app_zone_id}",
      "arn:aws:route53:::hostedzone/${local.archive_zone_id}",
    ]
  }

  statement {
    sid     = "Route53RecordChanges"
    actions = ["route53:ChangeResourceRecordSets"]
    resources = [
      "arn:aws:route53:::hostedzone/${local.app_zone_id}",
      "arn:aws:route53:::hostedzone/${local.archive_zone_id}",
    ]
  }

  statement {
    sid       = "Route53ChangeReadOnly"
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }

  statement {
    sid = "EcsRegisterTaskDefinition"
    actions = [
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid = "EcsServiceUpdates"
    actions = [
      "ecs:UpdateService",
    ]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.name_prefix}-cluster/${var.name_prefix}-app",
    ]
  }

  statement {
    sid = "EcsTaskDefinitionCleanup"
    actions = [
      "ecs:DeregisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid = "PassEcsTaskRoles"
    actions = [
      "iam:PassRole",
    ]
    resources = [
      aws_iam_role.ecs_execution.arn,
      aws_iam_role.ecs_task.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name   = "${var.name_prefix}-github-actions-deploy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_deploy.json
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name_prefix}-app"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "app" {
  name = "${var.name_prefix}-cluster"
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Public ALB access for ${var.app_domain}"
  vpc_id      = local.vpc_id
}

resource "aws_security_group_rule" "alb_http_in" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group_rule" "alb_https_in" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group_rule" "alb_egress" {
  type              = "egress"
  security_group_id = aws_security_group.alb.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-ecs"
  description = "ECS task access for ${var.app_domain}"
  vpc_id      = local.vpc_id
}

resource "aws_security_group_rule" "app_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.app.id
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "app_egress" {
  type              = "egress"
  security_group_id = aws_security_group.app.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group" "efs" {
  name        = "${var.name_prefix}-efs"
  description = "EFS access from ECS tasks"
  vpc_id      = local.vpc_id
}

resource "aws_security_group_rule" "efs_from_app" {
  type                     = "ingress"
  security_group_id        = aws_security_group.efs.id
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
}

resource "aws_efs_file_system" "app" {
  creation_token = "${var.name_prefix}-data"
  encrypted      = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }
}

resource "aws_efs_access_point" "app" {
  file_system_id = aws_efs_file_system.app.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/cosyworld"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }
}

resource "aws_efs_mount_target" "app" {
  for_each = local.efs_subnet_ids_by_az

  file_system_id  = aws_efs_file_system.app.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_lb" "app" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.subnet_ids
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name_prefix}-app"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id

  health_check {
    enabled             = true
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.site.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name               = "${var.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

locals {
  secret_arns = compact([
    var.ruby_high_wallet_cards_bearer_secret_arn,
    var.moderation_token_secret_arn,
    var.openrouter_api_key_secret_arn,
    var.replicate_api_token_secret_arn,
    var.box_burn_solana_rpc_url_secret_arn,
    var.box_core_collection_address_secret_arn,
  ])
}

data "aws_iam_policy_document" "ecs_secret_read" {
  count = length(local.secret_arns) > 0 ? 1 : 0

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.secret_arns
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_secret_read" {
  count = length(local.secret_arns) > 0 ? 1 : 0

  name   = "${var.name_prefix}-ecs-secret-read"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_secret_read[0].json
}

locals {
  capacity_process_id = coalesce(var.process_id, var.shard_id)
  app_environment = concat([
    { name = "COSYWORLD_DEPLOY_PROFILE", value = var.deploy_profile },
    { name = "COSYWORLD_V2_ADDR", value = "0.0.0.0:3000" },
    { name = "COSYWORLD_PROCESS_ID", value = local.capacity_process_id },
    { name = "COSYWORLD_V2_SHARD_ID", value = local.capacity_process_id },
    { name = "COSYWORLD_V2_SNAPSHOT_PATH", value = "/data/cosyworld-v2-snapshot.json" },
    { name = "COSYWORLD_V2_EVENT_DB_PATH", value = "/data/cosyworld-v2-events.sqlite" },
    { name = "COSYWORLD_GENERATED_ASSET_DIR", value = "/data/generated" },
    { name = "COSYWORLD_WEBAUTHN_RP_ID", value = var.app_domain },
    { name = "COSYWORLD_WEBAUTHN_ORIGIN", value = "https://${var.app_domain}" },
    { name = "COSYWORLD_WEBAUTHN_EXTRA_ORIGINS", value = var.enable_www_records ? "https://www.${var.app_domain}" : "" },
    { name = "COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL", value = var.ruby_high_wallet_cards_url },
    { name = "COSYWORLD_HOSTED_PARTY_MAX_GUESTS", value = tostring(var.hosted_party_max_guests) },
    { name = "COSYWORLD_HOSTED_PARTY_MAX_ACTIVE_PER_GUEST", value = tostring(var.hosted_party_max_active_per_guest) },
    { name = "COSYWORLD_HOSTED_ACCESS_TTL_SECS", value = tostring(var.hosted_access_ttl_seconds) },
    { name = "COSYWORLD_HOSTED_ACCESS_GRACE_SECS", value = tostring(var.hosted_access_grace_seconds) },
    { name = "COSYWORLD_GENERATION_DEFAULT_MODE", value = var.generation_default_mode },
    { name = "COSYWORLD_GENERATION_FEATURE_MODES_JSON", value = jsonencode(var.generation_feature_modes) },
    { name = "RUST_LOG", value = "cosyworld_orchestrator=info,tower_http=warn" },
    ],
    var.openrouter_api_key_secret_arn != "" ? [
      { name = "COSYWORLD_AI_PROVIDER", value = "openrouter" },
      { name = "OPENROUTER_CHAT_MODEL", value = var.openrouter_chat_model },
      { name = "OPENROUTER_REASONING_EFFORT", value = var.openrouter_reasoning_effort },
    ] : [],
  )

  app_secrets = concat(
    var.ruby_high_wallet_cards_bearer_secret_arn != "" ? [{ name = "COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER", valueFrom = var.ruby_high_wallet_cards_bearer_secret_arn }] : [],
    var.moderation_token_secret_arn != "" ? [{ name = "COSYWORLD_MODERATION_TOKEN", valueFrom = var.moderation_token_secret_arn }] : [],
    var.openrouter_api_key_secret_arn != "" ? [{ name = "OPENROUTER_API_KEY", valueFrom = var.openrouter_api_key_secret_arn }] : [],
    var.replicate_api_token_secret_arn != "" ? [
      { name = "COSYWORLD_REPLICATE_API_TOKEN", valueFrom = var.replicate_api_token_secret_arn },
      { name = "REPLICATE_API_TOKEN", valueFrom = var.replicate_api_token_secret_arn },
    ] : [],
    var.box_burn_solana_rpc_url_secret_arn != "" ? [{ name = "COSYWORLD_BOX_BURN_SOLANA_RPC_URL", valueFrom = var.box_burn_solana_rpc_url_secret_arn }] : [],
    var.box_core_collection_address_secret_arn != "" ? [{ name = "COSYWORLD_BOX_CORE_COLLECTION_ADDRESS", valueFrom = var.box_core_collection_address_secret_arn }] : [],
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name_prefix}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      environment = local.app_environment
      secrets     = local.app_secrets

      mountPoints = [
        {
          sourceVolume  = "data"
          containerPath = "/data"
          readOnly      = false
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "app"
        }
      }
    }
  ])

  volume {
    name = "data"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.app.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.app.id
      }
    }
  }

  lifecycle {
    create_before_destroy = true

    precondition {
      condition = (
        var.deploy_profile != "production" ||
        (
          var.ruby_high_wallet_cards_bearer_secret_arn != "" &&
          var.moderation_token_secret_arn != ""
        )
      )
      error_message = "Production deploys require ruby_high_wallet_cards_bearer_secret_arn and moderation_token_secret_arn."
    }
  }
}

resource "aws_ecs_service" "app" {
  name            = "${var.name_prefix}-app"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 90

  network_configuration {
    subnets          = local.subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  depends_on = [
    aws_lb_listener.https,
    aws_efs_mount_target.app,
  ]
}

resource "aws_route53_record" "app_apex" {
  zone_id = local.app_zone_id
  name    = var.app_domain
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "app_www" {
  count = var.enable_www_records ? 1 : 0

  zone_id = local.app_zone_id
  name    = local.app_www_domain
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

locals {
  archive_site_dir    = var.archive_site_dir != "" ? var.archive_site_dir : abspath("${path.module}/../../sites/lonelyforestlibrary")
  archive_bucket_name = var.archive_bucket_name != "" ? var.archive_bucket_name : replace(var.archive_domain, ".", "-")
  archive_files       = fileset(local.archive_site_dir, "**/*")
  mime_types = {
    ".css"  = "text/css"
    ".gif"  = "image/gif"
    ".html" = "text/html"
    ".ico"  = "image/x-icon"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".map"  = "application/json"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".txt"  = "text/plain"
    ".webp" = "image/webp"
    ".xml"  = "application/xml"
  }
}

resource "aws_s3_bucket" "archive" {
  bucket        = local.archive_bucket_name
  force_destroy = var.archive_bucket_force_destroy
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket                  = aws_s3_bucket.archive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "archive_site" {
  for_each = local.archive_files

  bucket       = aws_s3_bucket.archive.id
  key          = each.value
  source       = "${local.archive_site_dir}/${each.value}"
  etag         = filemd5("${local.archive_site_dir}/${each.value}")
  content_type = lookup(local.mime_types, lower(try(regex("\\.[^.]+$", each.value), "")), "application/octet-stream")
}

resource "aws_cloudfront_origin_access_control" "archive" {
  name                              = "${var.name_prefix}-archive-oac"
  description                       = "OAC for ${var.archive_domain}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "archive" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.archive_domain} static archive"
  default_root_object = "index.html"
  aliases             = compact([var.archive_domain, var.enable_www_records ? local.archive_www_domain : ""])

  origin {
    domain_name              = aws_s3_bucket.archive.bucket_regional_domain_name
    origin_id                = "archive-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.archive.id
  }

  default_cache_behavior {
    target_origin_id       = "archive-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "archive_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.archive.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.archive.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "archive" {
  bucket = aws_s3_bucket.archive.id
  policy = data.aws_iam_policy_document.archive_bucket.json
}

resource "aws_route53_record" "archive_apex" {
  zone_id = local.archive_zone_id
  name    = var.archive_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.archive.domain_name
    zone_id                = aws_cloudfront_distribution.archive.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "archive_www" {
  count = var.enable_www_records ? 1 : 0

  zone_id = local.archive_zone_id
  name    = local.archive_www_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.archive.domain_name
    zone_id                = aws_cloudfront_distribution.archive.hosted_zone_id
    evaluate_target_health = false
  }
}
