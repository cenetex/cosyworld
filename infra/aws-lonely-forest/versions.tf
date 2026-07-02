terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "cosyworld-lonely-forest-terraform-state-022118847419"
    key            = "lonely-forest/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cosyworld-lonely-forest-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
