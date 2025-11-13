# AWS Deployment Architecture - Overview & Decision Framework

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Status:** Planning Phase  
**Related Reports:** 
- [01 - Containerization Guide](./01_CONTAINERIZATION_GUIDE.md)
- [02 - Infrastructure as Code](./02_INFRASTRUCTURE_AS_CODE.md)
- [03 - CI/CD Pipeline](./03_CICD_PIPELINE.md)
- [04 - Multi-Client Strategy](./04_MULTI_CLIENT_STRATEGY.md)
- [05 - Migration Plan](./05_MIGRATION_PLAN.md)

---

## Executive Summary

This report series outlines the architecture and implementation plan for deploying CosyWorld to AWS with support for multiple independent client deployments, automated CI/CD, and horizontal scaling capabilities.

### Current State
- **Deployment Model:** Single manual instance on Replit (development only)
- **Architecture:** Monolithic Node.js application with MongoDB
- **Scaling:** Cannot run multiple instances (no coordination layer)
- **CI/CD:** Basic GitHub Actions (lint/build only, no deployment)
- **Infrastructure:** Minimal Terraform (Lambda/S3 for video uploads only)
- **Multi-tenancy:** Not supported

### Target State
- **Deployment Model:** Automated AWS deployments via GitHub Actions
- **Architecture:** Containerized Node.js app on ECS/Fargate with Redis coordination
- **Scaling:** Horizontal auto-scaling with 2-10 instances per client
- **CI/CD:** Full deployment pipeline with rolling updates and health checks
- **Infrastructure:** Complete Terraform modules for VPC, ECS, RDS, ElastiCache, ALB
- **Multi-tenancy:** Isolated AWS stacks per client with shared CI/CD pipeline

---

## Report Structure

### [Report 01 - Containerization Guide](./01_CONTAINERIZATION_GUIDE.md)
**Scope:** Docker implementation and local development
- Dockerfile design for Node.js 18+ application
- Multi-stage builds for optimized production images
- docker-compose.yml for local development stack
- Health check endpoints (/health/live, /health/ready)
- Graceful shutdown handling
- Local testing and validation procedures
- **Prerequisites:** None
- **Estimated Reading Time:** 20 minutes
- **Implementation Time:** 1-2 days

### [Report 02 - Infrastructure as Code](./02_INFRASTRUCTURE_AS_CODE.md)
**Scope:** Terraform modules for AWS resources
- VPC and network architecture (public/private subnets, NAT gateways)
- ECS Fargate cluster configuration
- Application Load Balancer with health checks
- ElastiCache Redis cluster (multi-AZ)
- RDS MongoDB-compatible DocumentDB (optional migration)
- Auto-scaling policies and CloudWatch alarms
- Security groups and IAM roles
- **Prerequisites:** Report 01 (Docker images)
- **Estimated Reading Time:** 30 minutes
- **Implementation Time:** 3-5 days

### [Report 03 - CI/CD Pipeline](./03_CICD_PIPELINE.md)
**Scope:** GitHub Actions deployment automation
- Build and test workflow
- ECR image push pipeline
- Terraform apply automation
- ECS rolling deployment strategy
- Blue/green deployment options
- Rollback procedures
- Environment promotion (dev → staging → prod)
- **Prerequisites:** Reports 01, 02
- **Estimated Reading Time:** 25 minutes
- **Implementation Time:** 2-3 days

### [Report 04 - Multi-Client Strategy](./04_MULTI_CLIENT_STRATEGY.md)
**Scope:** Supporting multiple independent client deployments
- AWS account isolation vs VPC isolation
- Terraform workspace strategy
- Client-specific configuration management
- Secrets management (AWS Secrets Manager)
- Cost allocation and monitoring per client
- Shared vs dedicated resources
- Client onboarding procedures
- **Prerequisites:** Reports 01, 02, 03
- **Estimated Reading Time:** 25 minutes
- **Implementation Time:** 2-4 days

### [Report 05 - Migration Plan](./05_MIGRATION_PLAN.md)
**Scope:** Phased migration from Replit to AWS
- Migration timeline and milestones
- Database migration strategy (MongoDB Atlas or DocumentDB)
- Risk assessment and mitigation
- Cost analysis (development vs production)
- Rollback procedures
- Success metrics and validation
- Post-deployment monitoring setup
- **Prerequisites:** Reports 01-04
- **Estimated Reading Time:** 20 minutes
- **Implementation Time:** 2-3 weeks total

---

## Strategic Decisions

### 1. Orchestration Platform: ECS Fargate vs EKS

| Factor | ECS Fargate ⭐ | EKS (Kubernetes) |
|--------|----------------|------------------|
| **Complexity** | Low - AWS-managed, simple | High - K8s expertise required |
| **Operational Overhead** | Minimal - serverless containers | High - cluster management |
| **Startup Time** | Fast - hours to days | Slow - days to weeks |
| **Cost (Small Scale)** | $50-150/month per client | $150-300/month (includes control plane) |
| **Scaling** | Automatic with ECS Service | Automatic with HPA/Cluster Autoscaler |
| **Multi-tenancy** | Easy - separate ECS clusters | Complex - namespaces, RBAC |
| **Learning Curve** | Shallow - AWS-native | Steep - Kubernetes concepts |
| **Vendor Lock-in** | High - AWS-specific | Low - portable to any K8s |
| **Best For** | 2-20 clients, simple deployments | 20+ clients, complex microservices |

**RECOMMENDATION: ECS Fargate**

**Rationale:**
- Current team bandwidth (single developer deployment focus)
- Target scale: 5-10 client deployments in first year
- Monolithic architecture (not microservices)
- Faster time to production (critical for MVP)
- Lower operational complexity
- Sufficient scaling capabilities (ECS supports thousands of tasks)
- Can migrate to EKS later if needed (containers are portable)

**When to Reconsider EKS:**
- Scaling beyond 20+ clients
- Need for multi-cloud portability
- Migrating to microservices architecture
- Team has dedicated DevOps/K8s expertise
- Complex service mesh requirements

---

### 2. Database Strategy: MongoDB Atlas vs DocumentDB vs Self-Hosted

| Factor | MongoDB Atlas ⭐ | AWS DocumentDB | Self-Hosted on EC2 |
|--------|------------------|----------------|-------------------|
| **Management** | Fully managed | AWS-managed | Manual management |
| **MongoDB Compatibility** | 100% native | ~95% compatible | 100% native |
| **Backup/Recovery** | Automated, point-in-time | Automated, snapshot-based | Manual setup required |
| **Cost (Small)** | $57/month (M10 shared) | $200/month (r6g.large) | $50-100/month + ops time |
| **Cost (Production)** | $250-500/month (M30) | $400-800/month | $200-400/month + ops time |
| **Multi-Region** | Built-in global clusters | Read replicas only | Complex setup |
| **Scaling** | Automatic with sharding | Vertical + read replicas | Manual configuration |
| **Vendor Lock-in** | Medium - MongoDB Cloud | High - AWS-specific API | None |
| **Best For** | Quick start, low ops burden | AWS-native, compliance needs | Cost-sensitive, full control |

**RECOMMENDATION: MongoDB Atlas (Development/Small Clients) + Optional DocumentDB (Large Clients)**

**Rationale:**
- Already using MongoDB - no migration needed
- Zero operational overhead for database management
- Can start with shared clusters ($57/month) for development
- Easy scaling path (M10 → M30 → M50 as needed)
- Built-in monitoring, backup, and disaster recovery
- Connection string swap for client isolation
- Can migrate specific high-volume clients to DocumentDB if cost becomes issue

**Hybrid Approach:**
```
Development/Testing: MongoDB Atlas M0 (Free) or M10 ($57/month)
Small Clients (1-5): MongoDB Atlas M10 ($57/month each)
Medium Clients (6-10): MongoDB Atlas M30 ($250/month each)
Large Clients (10+): AWS DocumentDB if cost-effective
```

---

### 3. Redis Deployment: ElastiCache vs Redis Cloud

| Factor | ElastiCache ⭐ | Redis Cloud (Redis Labs) |
|--------|----------------|--------------------------|
| **Management** | AWS-managed | Fully managed |
| **Integration** | Native AWS VPC | VPC peering required |
| **Cost (Small)** | $50/month (cache.t4g.micro) | $50/month (30MB) |
| **Cost (Production)** | $200-400/month (cache.r6g.large) | $150-300/month |
| **Multi-AZ** | Built-in | Available |
| **Persistence** | AOF/RDB snapshots | AOF/RDB + Redis on Flash |
| **Redis Version** | 7.0+ | 7.2+ (latest features) |
| **Modules** | Limited (RedisJSON, etc.) | Full support (RedisSearch, etc.) |
| **Best For** | AWS-native, simple setup | Advanced features, multi-cloud |

**RECOMMENDATION: AWS ElastiCache for Redis**

**Rationale:**
- Native VPC integration (lower latency, higher security)
- Simplified IAM and security group management
- Consistent AWS billing and cost allocation
- Multi-AZ replication included in standard tier
- Automatic failover and backup
- Sufficient for coordination use cases (leader election, distributed locks, pub/sub)
- Can upgrade to Redis Cloud if advanced modules needed later

**Configuration:**
```
Development: cache.t4g.micro (1 node) - $50/month
Production: cache.r6g.large (3 nodes, multi-AZ) - $400/month
```

---

### 4. Load Balancing: ALB vs NLB

| Factor | Application Load Balancer ⭐ | Network Load Balancer |
|--------|------------------------------|----------------------|
| **Use Case** | HTTP/HTTPS traffic | TCP/UDP, extreme performance |
| **Features** | Path/host routing, WAF, auth | Minimal processing |
| **Cost** | $22.50/month + LCU charges | $22.50/month + NLCU charges |
| **Latency** | ~10-50ms | ~1-5ms (ultra-low) |
| **Health Checks** | HTTP-based | TCP-based |
| **Best For** | Web applications, APIs | Gaming, IoT, raw TCP |

**RECOMMENDATION: Application Load Balancer (ALB)**

**Rationale:**
- HTTP/HTTPS application with REST API and web UI
- Need path-based routing (/api/*, /health/*, static files)
- Health checks on /health/ready endpoint
- SSL termination at load balancer
- Potential future features: authentication, WAF, rate limiting
- Negligible latency difference for web application use case

---

### 5. Secrets Management

| Factor | AWS Secrets Manager ⭐ | AWS Systems Manager Parameter Store | Environment Variables |
|--------|------------------------|-------------------------------------|----------------------|
| **Rotation** | Automatic | Manual | Manual |
| **Encryption** | KMS by default | KMS optional | Not encrypted |
| **Versioning** | Automatic | Manual | None |
| **Cost** | $0.40/secret/month + API calls | Free (standard params) | Free |
| **Audit** | CloudTrail integration | CloudTrail integration | None |
| **Best For** | Production secrets | Config values, non-sensitive | Development only |

**RECOMMENDATION: AWS Secrets Manager (Production) + Parameter Store (Config)**

**Configuration Strategy:**
```
Secrets Manager (sensitive):
- DISCORD_BOT_TOKEN
- OPENROUTER_API_KEY
- GOOGLE_AI_API_KEY
- ENCRYPTION_KEY
- MONGO_URI (with credentials)

Parameter Store (configuration):
- WEB_PORT
- MONGO_DB_NAME
- NODE_ENV
- Feature flags (ENABLE_LLM_TOOL_CALLING, etc.)
- Public URLs

Environment Variables (container-level):
- AWS_REGION
- LOG_LEVEL
- Container-specific settings
```

---

## Architecture Overview

### High-Level AWS Architecture (Per Client)

```
┌─────────────────────────────────────────────────────────────┐
│ Route 53                                                     │
│ client1.cosyworld.ai → ALB                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Application Load Balancer (ALB)                             │
│ - SSL Termination (ACM Certificate)                         │
│ - Health Checks: /health/ready                              │
│ - Target Group: ECS Tasks                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ECS Fargate Cluster                                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ ECS Task 1   │  │ ECS Task 2   │  │ ECS Task N   │     │
│  │              │  │              │  │              │     │
│  │ Container:   │  │ Container:   │  │ Container:   │     │
│  │ cosyworld    │  │ cosyworld    │  │ cosyworld    │     │
│  │ Node.js app  │  │ Node.js app  │  │ Node.js app  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  Auto-scaling: 2-10 tasks based on CPU/Memory               │
└────────────────────┬───────────────┬────────────────────────┘
                     │               │
          ┌──────────┴─────┐    ┌────┴──────────┐
          ▼                ▼    ▼               ▼
┌──────────────────┐ ┌─────────────────────────────┐
│ ElastiCache      │ │ MongoDB Atlas               │
│ Redis Cluster    │ │ (or DocumentDB)             │
│                  │ │                             │
│ - Multi-AZ       │ │ - Managed service           │
│ - 3 nodes        │ │ - Auto backups              │
│ - Leader election│ │ - Point-in-time recovery    │
│ - Distributed    │ │ - Per-client cluster or     │
│   locks          │ │   database                  │
│ - Pub/Sub        │ │                             │
└──────────────────┘ └─────────────────────────────┘
```

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ VPC (10.0.0.0/16)                                           │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Public Subnets (10.0.1.0/24, 10.0.2.0/24)             │ │
│  │                                                        │ │
│  │  ┌──────────────────┐    ┌────────────────────┐      │ │
│  │  │ NAT Gateway 1    │    │ NAT Gateway 2      │      │ │
│  │  │ (AZ us-east-1a)  │    │ (AZ us-east-1b)    │      │ │
│  │  └──────────────────┘    └────────────────────┘      │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │ Application Load Balancer                    │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Private Subnets (10.0.10.0/24, 10.0.11.0/24)          │ │
│  │                                                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ ECS Task     │  │ ECS Task     │  │ ECS Task   │ │ │
│  │  │ (Fargate)    │  │ (Fargate)    │  │ (Fargate)  │ │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │ ElastiCache Redis Cluster                    │    │ │
│  │  │ (Multi-AZ with automatic failover)           │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                              │
│  Internet Gateway                                           │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    Internet
```

---

## Cost Estimates

### Per-Client Monthly Costs

#### Development/Staging Environment
| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| ECS Fargate | 2 tasks × 0.25 vCPU, 0.5 GB | $15 |
| Application Load Balancer | 1 ALB + minimal traffic | $25 |
| ElastiCache Redis | cache.t4g.micro (1 node) | $50 |
| MongoDB Atlas | M10 shared cluster | $57 |
| NAT Gateway | 2 NAT gateways + minimal data | $70 |
| CloudWatch Logs | ~10 GB/month | $5 |
| Secrets Manager | ~10 secrets | $4 |
| ECR | Docker image storage | $2 |
| **Total** | | **~$228/month** |

#### Production Environment (Small Client)
| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| ECS Fargate | 2-4 tasks × 0.5 vCPU, 1 GB | $60 |
| Application Load Balancer | 1 ALB + moderate traffic | $40 |
| ElastiCache Redis | cache.r6g.large (multi-AZ, 3 nodes) | $400 |
| MongoDB Atlas | M30 dedicated cluster | $250 |
| NAT Gateway | 2 NAT gateways + 100 GB data | $140 |
| CloudWatch Logs | ~50 GB/month | $25 |
| Secrets Manager | ~15 secrets | $6 |
| ECR | Docker image storage | $5 |
| Data Transfer | ~500 GB outbound | $45 |
| **Total** | | **~$971/month** |

#### Production Environment (Large Client)
| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| ECS Fargate | 4-10 tasks × 1 vCPU, 2 GB | $300 |
| Application Load Balancer | 1 ALB + high traffic | $80 |
| ElastiCache Redis | cache.r6g.xlarge (multi-AZ) | $800 |
| MongoDB Atlas | M50 dedicated cluster | $500 |
| NAT Gateway | 2 NAT gateways + 500 GB data | $340 |
| CloudWatch Logs | ~200 GB/month | $100 |
| Secrets Manager | ~20 secrets | $8 |
| ECR | Docker image storage | $10 |
| Data Transfer | ~2 TB outbound | $180 |
| **Total** | | **~$2,318/month** |

### Shared Infrastructure Costs
| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| ECR Repository | Shared Docker registry | Included in per-client |
| GitHub Actions | CI/CD pipeline (2000 free minutes) | $0-50 |
| Route 53 | Hosted zones ($0.50/zone) | $5-20 (depends on # clients) |

### Cost Optimization Strategies
1. **Reserved Capacity:** Consider 1-year Reserved Instances for ElastiCache (save 30-40%)
2. **Savings Plans:** Fargate Savings Plans for predictable workloads (save 20-50%)
3. **Right-sizing:** Start with smaller instances and scale based on actual usage
4. **Spot Instances:** Not applicable for Fargate (not supported)
5. **Data Transfer:** Use CloudFront CDN for static assets to reduce ALB data transfer costs
6. **Log Retention:** Set CloudWatch log retention to 30-90 days instead of indefinite

---

## Scaling Characteristics

### Horizontal Scaling (ECS Service Auto-scaling)

```yaml
Triggers:
  - CPU Utilization > 70% → Scale OUT (add tasks)
  - CPU Utilization < 30% → Scale IN (remove tasks)
  - Memory Utilization > 80% → Scale OUT
  - ALB Request Count > 1000/task → Scale OUT

Limits:
  Minimum Tasks: 2 (high availability)
  Maximum Tasks: 10 (cost control)
  
Scale-out Cooldown: 60 seconds
Scale-in Cooldown: 300 seconds (prevent thrashing)
```

### Redis Coordination for Multi-Instance

All instances coordinate through Redis:
- **Leader Election:** One instance handles Discord/Telegram connections
- **Distributed Locks:** Prevent duplicate message processing
- **Pub/Sub:** Event distribution across instances
- **Shared Cache:** Conversation history, user sessions
- **Message Deduplication:** Redis SET with TTL

See [Multi-Instance Architecture Report](./MULTI_INSTANCE_ARCHITECTURE_REPORT.md) for detailed coordination patterns.

---

## Security Architecture

### Network Security
```
Internet → ALB (HTTPS only, port 443)
  ↓
  Security Group: ALB-SG
    Inbound: 443 from 0.0.0.0/0
    Outbound: 3000 to ECS-SG
  ↓
  ECS Tasks (HTTP, port 3000)
  ↓
  Security Group: ECS-SG
    Inbound: 3000 from ALB-SG only
    Outbound: 6379 to Redis-SG, 27017 to MongoDB
  ↓
  ElastiCache Redis (port 6379)
  ↓
  Security Group: Redis-SG
    Inbound: 6379 from ECS-SG only
    Outbound: None
```

### IAM Roles

#### ECS Task Execution Role
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:region:account:secret:cosyworld/*"
    }
  ]
}
```

#### ECS Task Role (Application Permissions)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::client-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:region:account:table/video-upload-metadata"
    }
  ]
}
```

### Encryption
- **In Transit:** TLS 1.2+ for all external connections (ALB → clients)
- **At Rest:** 
  - ECS Task logs: Encrypted with KMS
  - ElastiCache: Encryption at rest + in transit
  - MongoDB Atlas: Encrypted by default
  - Secrets Manager: KMS encryption
  - S3 buckets: SSE-S3 or SSE-KMS

---

## Monitoring & Observability

### CloudWatch Dashboards (Per Client)

**Application Metrics:**
- ECS Task count (current/desired/running)
- CPU utilization (per task + cluster average)
- Memory utilization (per task + cluster average)
- Network bytes in/out

**Load Balancer Metrics:**
- Request count (total, per target)
- HTTP 2xx/4xx/5xx response codes
- Target response time (p50, p95, p99)
- Healthy/unhealthy target count

**Database Metrics:**
- Redis: Commands/sec, cache hit rate, evicted keys
- MongoDB: Connection count, operation count, replication lag

**Application Health:**
- Custom metric: Health check success rate
- Custom metric: Discord/Telegram connection status
- Custom metric: AI request latency
- Custom metric: Message processing queue depth

### CloudWatch Alarms

**Critical (PagerDuty/SMS):**
- All ECS tasks unhealthy (>= 2 minutes)
- ALB no healthy targets (>= 1 minute)
- Redis cluster down (>= 2 minutes)
- Error rate > 10% (>= 5 minutes)

**Warning (Email):**
- CPU utilization > 85% (>= 10 minutes)
- Memory utilization > 90% (>= 10 minutes)
- Disk space < 15% (>= 5 minutes)
- Error rate > 5% (>= 10 minutes)

**Info (Slack):**
- Deployment started
- Deployment completed
- Auto-scaling event (scale out/in)

### Logging Strategy

```javascript
// Application logs → CloudWatch Logs
{
  "timestamp": "2025-11-13T10:30:45.123Z",
  "level": "info",
  "service": "discord-service",
  "client": "client1",
  "message": "Message received",
  "metadata": {
    "channelId": "123456789",
    "userId": "987654321",
    "messageLength": 42
  }
}
```

**Log Groups:**
```
/ecs/cosyworld/client1/application
/ecs/cosyworld/client1/nginx (if using)
/aws/elasticache/cosyworld-client1-redis
```

**Retention:**
- Development: 7 days
- Staging: 30 days
- Production: 90 days
- Audit logs: 1 year

---

## High Availability & Disaster Recovery

### High Availability Design

**Multi-AZ Deployment:**
```
Availability Zone 1 (us-east-1a):
  - Public Subnet (NAT Gateway, ALB)
  - Private Subnet (ECS Tasks, Redis node 1)

Availability Zone 2 (us-east-1b):
  - Public Subnet (NAT Gateway, ALB)
  - Private Subnet (ECS Tasks, Redis node 2)

Availability Zone 3 (us-east-1c):
  - Private Subnet (Redis node 3)
```

**Component Redundancy:**
- **ALB:** Multi-AZ by default
- **ECS Tasks:** Minimum 2 tasks in different AZs
- **Redis:** 3-node cluster with automatic failover
- **MongoDB Atlas:** 3-replica set with automatic failover
- **NAT Gateways:** 2 NAT gateways (1 per AZ)

**Failover Times:**
- ALB health check failure → 30 seconds to stop routing
- ECS task failure → 60 seconds to launch replacement
- Redis node failure → 30-90 seconds automatic failover
- MongoDB Atlas failure → 10-40 seconds automatic failover

### Disaster Recovery Strategy

**Backup Strategy:**
```
MongoDB Atlas:
  - Continuous backup (every 6 hours)
  - Point-in-time recovery (35-day retention)
  - Daily snapshot exports to S3

Redis (ElastiCache):
  - Daily automatic snapshots
  - 7-day retention
  - Manual snapshots before deployments

ECS Task Definitions:
  - Versioned in Git
  - Stored in ECR (immutable tags)

Secrets:
  - Automatic versioning in Secrets Manager
  - Can restore previous versions
```

**Recovery Time Objective (RTO):**
- Single task failure: ~60 seconds (automatic)
- Availability zone failure: ~2-5 minutes (automatic)
- Region failure: ~30-60 minutes (manual failover to backup region)
- Complete disaster: ~2-4 hours (rebuild from Terraform + restore data)

**Recovery Point Objective (RPO):**
- Database: < 6 hours (Atlas continuous backup)
- Redis cache: 0 hours (ephemeral data, acceptable loss)
- Application state: 0 hours (stateless containers)

---

## Prerequisites & Dependencies

### Required Before Starting

1. **AWS Account:**
   - Root account access (for initial IAM setup)
   - Billing enabled
   - Credit card on file

2. **Domain Name:**
   - Domain registered (Route 53 or external)
   - Access to DNS management

3. **GitHub Repository:**
   - Admin access to configure secrets
   - GitHub Actions enabled

4. **MongoDB Database:**
   - MongoDB Atlas account (recommended)
   - OR AWS account with DocumentDB permissions

5. **Development Environment:**
   - Docker Desktop installed
   - AWS CLI v2 installed and configured
   - Terraform v1.5+ installed
   - Node.js 18+ installed

6. **API Keys/Credentials:**
   - Discord Bot Token + Client ID
   - OpenRouter API Key
   - Google AI API Key (optional)
   - Helius API Key (optional, for Buybot)
   - X/Twitter API credentials (optional)

### Skills Required

**Essential:**
- Basic Docker knowledge (container concepts)
- AWS fundamentals (VPC, EC2, IAM basics)
- Git/GitHub workflows
- Command line comfort

**Nice to Have:**
- Terraform experience (HCL syntax)
- CI/CD pipeline experience
- MongoDB administration
- Redis concepts

**Not Required (covered in reports):**
- Advanced Kubernetes/orchestration
- Deep AWS networking expertise
- Complex Terraform modules

---

## Success Criteria

### Phase 1: Containerization (Week 1)
- ✅ Docker image builds successfully
- ✅ Health check endpoints return 200 OK
- ✅ Application runs in local Docker container
- ✅ docker-compose stack starts MongoDB + Redis + App
- ✅ All 70+ services initialize without errors

### Phase 2: Infrastructure (Weeks 2-3)
- ✅ Terraform creates VPC, subnets, routing tables
- ✅ ECS cluster provisions successfully
- ✅ ALB health checks pass for ECS targets
- ✅ ElastiCache Redis cluster accessible from ECS
- ✅ Security groups allow only necessary traffic
- ✅ Cost estimates match actuals (±20%)

### Phase 3: CI/CD (Week 4)
- ✅ GitHub Actions builds Docker image
- ✅ ECR receives and stores image
- ✅ Terraform apply succeeds from CI pipeline
- ✅ ECS rolling update completes without downtime
- ✅ Rollback procedure tested and documented

### Phase 4: Multi-Client (Week 5)
- ✅ Terraform workspaces isolate client resources
- ✅ Secrets Manager stores client-specific secrets
- ✅ Second client deployment succeeds independently
- ✅ Cost tracking separates clients accurately
- ✅ Client onboarding documented and repeatable

### Phase 5: Production Validation (Week 6)
- ✅ All services healthy for 48 hours
- ✅ Auto-scaling responds to load tests
- ✅ Redis coordination prevents duplicate messages
- ✅ Database backups completing successfully
- ✅ Monitoring alerts trigger correctly
- ✅ Migration from Replit to AWS complete

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Cost overruns** | High | Medium | Start with dev environment, monitor daily costs, set billing alarms |
| **Deployment complexity** | Medium | Medium | Phased approach, extensive testing in dev environment |
| **Downtime during migration** | High | Low | Blue/green deployment, maintain Replit as fallback |
| **Redis coordination bugs** | High | Medium | Extensive testing, gradual rollout, feature flags |
| **Database migration issues** | High | Low | Practice migrations, use Atlas migration tools |
| **Security vulnerabilities** | High | Low | Security group review, secrets rotation, regular audits |
| **Learning curve delays** | Medium | Medium | Comprehensive documentation, focus on ECS over EKS |
| **Multi-client isolation breach** | Critical | Low | Separate AWS accounts, rigorous testing |

---

## Next Steps

### Immediate Actions (This Week)
1. ✅ **Review all 6 reports in this series**
2. 📋 **Approve architecture decisions** (ECS vs EKS, MongoDB Atlas vs DocumentDB)
3. 💳 **Set up AWS account** (if not already configured)
4. 🔑 **Create MongoDB Atlas account** (M0 free tier for testing)
5. 📦 **Install prerequisites** (Docker, AWS CLI, Terraform)

### Week 1: Containerization
- Read [Report 01 - Containerization Guide](./01_CONTAINERIZATION_GUIDE.md)
- Implement Dockerfile
- Create docker-compose.yml
- Add health check endpoints
- Test local container deployment

### Week 2-3: Infrastructure
- Read [Report 02 - Infrastructure as Code](./02_INFRASTRUCTURE_AS_CODE.md)
- Create Terraform modules
- Deploy development environment to AWS
- Validate networking and security
- Test ECS task deployment

### Week 4: CI/CD
- Read [Report 03 - CI/CD Pipeline](./03_CICD_PIPELINE.md)
- Create GitHub Actions workflows
- Configure ECR and secrets
- Test automated deployments
- Document rollback procedures

### Week 5: Multi-Client
- Read [Report 04 - Multi-Client Strategy](./04_MULTI_CLIENT_STRATEGY.md)
- Design Terraform workspace strategy
- Implement secrets isolation
- Deploy second client environment
- Create onboarding playbook

### Week 6: Production Migration
- Read [Report 05 - Migration Plan](./05_MIGRATION_PLAN.md)
- Execute database migration
- Perform final validation
- Cutover from Replit to AWS
- Monitor production for 48 hours

---

## Conclusion

This deployment architecture provides a **production-ready, scalable, multi-client AWS infrastructure** while balancing:

✅ **Simplicity** - ECS Fargate over complex Kubernetes  
✅ **Speed** - Managed services (Atlas, ElastiCache) over self-hosted  
✅ **Cost** - Right-sized for 5-10 clients, scales efficiently  
✅ **Reliability** - Multi-AZ, auto-scaling, automated backups  
✅ **Security** - VPC isolation, secrets management, encryption  
✅ **Maintainability** - Infrastructure as Code, automated deployments  

**Estimated Timeline:** 6 weeks from start to production  
**Estimated Cost:** $228/month (dev) + $971/month per production client  
**Team Size:** 1-2 developers (primary + reviewer)  

The modular report structure allows you to:
- Focus on one phase at a time
- Review and approve each component independently
- Iterate on specific sections without re-reading entire document
- Share specific reports with stakeholders (e.g., Report 02 with infrastructure team)

**Proceed to [Report 01 - Containerization Guide](./01_CONTAINERIZATION_GUIDE.md) when ready to begin implementation.**

---

*Report generated: November 13, 2025*  
*Last updated: November 13, 2025*  
*Version: 1.0*
