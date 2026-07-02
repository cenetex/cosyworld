# Non-secret settings for the currently deployed AWS stack.
# Keep production tokens in Secrets Manager and pass their ARNs separately.
create_hosted_zones = true
deploy_profile      = "local"
image_tag           = "latest"

create_github_oidc_provider = false
