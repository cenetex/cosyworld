# Non-secret settings for the currently deployed AWS stack.
# Keep production tokens in Secrets Manager and pass their ARNs separately.
create_hosted_zones = true
deploy_profile      = "local"
image_tag           = "latest"
subnet_ids = [
  "subnet-6d16a437",
  "subnet-7da89541",
  "subnet-a5b939a9",
  "subnet-eb3e2f8e",
  "subnet-f45220bc",
  "subnet-f7219bdb",
]

create_github_oidc_provider = false
