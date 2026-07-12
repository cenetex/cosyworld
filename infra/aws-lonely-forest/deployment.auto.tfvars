# Non-secret settings for the currently deployed AWS stack.
# Keep production tokens in Secrets Manager and pass their ARNs separately.
create_hosted_zones = true
deploy_profile      = "production"
image_tag           = "latest"

# Secret values live in AWS Secrets Manager. These ARNs are safe to keep here
# and ensure subsequent Terraform deploys continue injecting them into ECS.
ruby_high_wallet_cards_bearer_secret_arn = "arn:aws:secretsmanager:us-east-1:022118847419:secret:lonely-forest/COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER-2BhIN3"
moderation_token_secret_arn              = "arn:aws:secretsmanager:us-east-1:022118847419:secret:lonely-forest/COSYWORLD_MODERATION_TOKEN-FOZTbz"
openrouter_api_key_secret_arn            = "arn:aws:secretsmanager:us-east-1:022118847419:secret:lonely-forest/OPENROUTER_API_KEY-m6U4CG"
openrouter_chat_model                    = "x-ai/grok-4.5"
generation_default_mode                  = "off"
generation_feature_modes                 = { pathway_content = "auto_bounded" }
replicate_api_token_secret_arn           = "arn:aws:secretsmanager:us-east-1:022118847419:secret:lonely-forest/REPLICATE_API_TOKEN-KEaGRv"
subnet_ids = [
  "subnet-6d16a437",
  "subnet-7da89541",
  "subnet-a5b939a9",
  "subnet-eb3e2f8e",
  "subnet-f45220bc",
  "subnet-f7219bdb",
]

create_github_oidc_provider = false
