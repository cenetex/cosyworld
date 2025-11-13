# Report 05 - Migration & Rollout Plan

**Document Version:** 1.0  
**Date:** November 13, 2025  
**Prerequisites:** Reports 01-04 (All infrastructure and CI/CD ready)  
**Estimated Implementation Time:** 2-3 weeks  
**Related Reports:** [00 - Overview](./00_AWS_DEPLOYMENT_OVERVIEW.md)

---

## Overview

Phased migration plan from Replit to AWS with minimal risk and zero data loss. This report provides week-by-week timeline, rollback procedures, and success criteria.

### Migration Goals

- ✅ Zero data loss (MongoDB migration)
- ✅ Minimal downtime (< 5 minutes)
- ✅ Easy rollback to Replit if issues occur
- ✅ Validate AWS deployment before cutover
- ✅ Gradual traffic migration (if using multiple instances)

---

## Migration Timeline

### Week 1: Preparation & Local Validation

**Objectives:**
- Docker container working locally
- All services initialize successfully
- Health checks implemented and tested

**Tasks:**

**Day 1-2: Containerization**
```bash
# Create Dockerfile
# Create docker-compose.yml
# Add health check endpoints
docker build -t cosyworld:local .
docker-compose up -d
curl http://localhost:3000/api/health/ready
```

**Day 3-4: Local Testing**
```bash
# Test all services in container
- Discord bot connects
- Telegram bot connects (if configured)
- MongoDB connection works
- Redis connection works (if configured)
- All 70+ services initialize
- Web UI accessible
- API endpoints functional
```

**Day 5: Graceful Shutdown**
```bash
# Implement shutdown handlers in src/index.mjs
# Test shutdown behavior
docker-compose stop app
# Verify: graceful shutdown in logs, no errors
```

**Success Criteria:**
- ✅ Docker image builds successfully
- ✅ All services start without errors
- ✅ Health checks return 200 OK
- ✅ Graceful shutdown works cleanly
- ✅ No data loss during restart

---

### Week 2: AWS Infrastructure Deployment

**Objectives:**
- Terraform infrastructure deployed to AWS
- ECS cluster running with test container
- All AWS resources provisioned correctly

**Tasks:**

**Day 1: Terraform Setup**
```bash
# Create Terraform backend
aws s3 mb s3://cosyworld-terraform-state
aws dynamodb create-table --table-name cosyworld-terraform-locks ...

# Create Terraform modules
cd infra/terraform-app
terraform init
```

**Day 2-3: Development Environment**
```bash
# Create dev workspace
terraform workspace new dev

# Deploy infrastructure
terraform plan -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars

# Verify outputs
terraform output
```

**Day 4: Push Docker Image**
```bash
# Login to ECR
aws ecr get-login-password | docker login ...

# Build and push
docker build -t cosyworld:dev .
docker tag cosyworld:dev $(terraform output -raw ecr_repository_url):dev
docker push $(terraform output -raw ecr_repository_url):dev
```

**Day 5: Deploy to ECS**
```bash
# Force new deployment
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_service_name) \
  --force-new-deployment

# Wait for deployment
aws ecs wait services-stable ...

# Test health
ALB_URL=$(terraform output -raw alb_url)
curl $ALB_URL/api/health/ready
```

**Success Criteria:**
- ✅ All Terraform modules apply successfully
- ✅ VPC, ECS, ALB, Redis provisioned
- ✅ Docker image pushed to ECR
- ✅ ECS tasks running and healthy
- ✅ ALB health checks passing
- ✅ CloudWatch logs streaming

---

### Week 3: Database Migration & Production Cutover

**Objectives:**
- MongoDB data migrated to Atlas
- Production infrastructure deployed
- Traffic cutover from Replit to AWS
- Monitoring validated

**Tasks:**

**Day 1: Database Migration (Replit → Atlas)**

**Option A: Live Migration (Zero Downtime)**
```bash
# 1. Create MongoDB Atlas cluster
# Region: us-east-1 (same as AWS)
# Tier: M10 or higher (for live migration)

# 2. Enable Atlas Live Migration
# Atlas UI → Migrate Data → Live Migration
# Source: MongoDB connection string from Replit
# Wait 1-6 hours for initial sync

# 3. Cutover when lag < 1 minute
# Atlas will sync continuously until cutover
```

**Option B: Snapshot Migration (Brief Downtime)**
```bash
# 1. Put Replit app in maintenance mode
# 2. Export database
mongodump --uri="$REPLIT_MONGO_URI" --out=/tmp/backup

# 3. Import to Atlas
mongorestore --uri="$ATLAS_MONGO_URI" /tmp/backup

# 4. Verify data
mongo "$ATLAS_MONGO_URI" --eval "db.avatars.countDocuments()"
```

**Day 2: Production Infrastructure**
```bash
# Create production workspace
terraform workspace new prod

# Deploy production infrastructure
terraform apply -var-file=environments/prod.tfvars

# Push production Docker image
docker tag cosyworld:latest $(terraform output -raw ecr_repository_url):v1.0.0
docker push $(terraform output -raw ecr_repository_url):v1.0.0

# Deploy to ECS
aws ecs update-service --force-new-deployment ...
```

**Day 3: Parallel Testing**
```bash
# Keep Replit running
# Test AWS deployment in parallel

# Run smoke tests on AWS
ALB_URL=$(terraform output -raw alb_url)

# Test all endpoints
curl $ALB_URL/api/health/ready
curl $ALB_URL/api/avatars
curl $ALB_URL/

# Test Discord bot (use test channel)
# Send message, verify response

# Monitor logs
aws logs tail /ecs/cosyworld-prod --follow
```

**Day 4: Traffic Cutover**

**DNS Cutover (if using custom domain):**
```bash
# 1. Lower TTL on DNS record (1 hour before cutover)
# 2. Update DNS A record to point to ALB
# 3. Monitor old Replit instance for traffic drop
# 4. Disable Replit instance after 24 hours

# Example: Route 53
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "bot.yourdomain.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "'$(terraform output -raw alb_dns_name)'"}]
      }
    }]
  }'
```

**Discord Webhook Update:**
```bash
# If using Discord webhooks, update URLs
# Old: https://cosyworld-REPLIT.repl.co/webhook
# New: https://ALB-DNS-NAME.elb.amazonaws.com/webhook
```

**Day 5: Validation & Cleanup**
```bash
# Monitor AWS deployment for 24 hours
# Check CloudWatch metrics:
- ECS task count stable
- ALB request count increasing
- No error spikes in logs
- Redis connections stable

# Verify Replit traffic dropped to zero

# After 48 hours of stable AWS operation:
# 1. Export final Replit backup (safety)
# 2. Stop Replit instance
# 3. Archive Replit project
```

**Success Criteria:**
- ✅ All MongoDB data migrated successfully
- ✅ Production infrastructure deployed
- ✅ Traffic flowing through AWS ALB
- ✅ Discord bot responding from AWS
- ✅ Zero errors in CloudWatch logs
- ✅ Replit instance can be stopped safely

---

## Rollback Procedures

### Scenario 1: AWS Deployment Fails (Before Cutover)

**Symptom:** ECS tasks unhealthy, health checks failing

**Action:**
```bash
# Continue using Replit (no cutover yet)
# Debug AWS issues without time pressure

# Check ECS task logs
aws logs tail /ecs/cosyworld-prod --since 1h

# Check task definition
aws ecs describe-task-definition --task-definition cosyworld-prod

# Common issues:
- Incorrect environment variables
- Secrets not accessible
- MongoDB connection failing
- Redis connection failing
```

**No rollback needed** - Replit still serving traffic

---

### Scenario 2: Issues After Cutover (< 1 hour)

**Symptom:** High error rate, bot not responding, database errors

**Action:**
```bash
# IMMEDIATE: Revert DNS to Replit
aws route53 change-resource-record-sets ... # Point back to Replit

# OR: Update Discord webhook back to Replit
# Replit instance should still be running

# Users experience brief disruption (2-5 minutes)
# Investigate AWS issues offline
```

**Timeline:** 2-5 minutes to rollback DNS

---

### Scenario 3: Data Loss Detected

**Symptom:** Missing data in MongoDB Atlas after migration

**Action:**
```bash
# STOP all writes to Atlas
# Restore from Replit backup

mongorestore --uri="$ATLAS_MONGO_URI" --drop /tmp/replit-backup

# Verify data integrity
mongo "$ATLAS_MONGO_URI" --eval "
  db.avatars.countDocuments();
  db.messages.countDocuments();
  db.users.countDocuments();
"

# Compare counts with Replit database
```

**Prevention:**
- Always test migration with sample data first
- Verify counts before cutover
- Keep Replit instance running for 48 hours

---

## Validation Checklist

### Pre-Cutover Validation

**Infrastructure:**
- [ ] VPC created with correct CIDR
- [ ] Public and private subnets in 2 AZs
- [ ] NAT gateways functional
- [ ] Security groups configured correctly
- [ ] ALB provisioned and health checks passing
- [ ] ECS cluster created
- [ ] ECR repository created
- [ ] Redis cluster accessible from ECS

**Application:**
- [ ] Docker image builds successfully
- [ ] Image pushed to ECR
- [ ] ECS task definition correct
- [ ] Environment variables configured
- [ ] Secrets accessible from Secrets Manager
- [ ] All 70+ services initialize without errors
- [ ] Health check endpoints return 200 OK

**Database:**
- [ ] MongoDB Atlas cluster provisioned
- [ ] Data migrated from Replit
- [ ] Document counts match
- [ ] Indexes created
- [ ] Connection string configured in Secrets Manager

**Monitoring:**
- [ ] CloudWatch log groups created
- [ ] Logs streaming from ECS tasks
- [ ] CloudWatch dashboard created
- [ ] Alarms configured for critical metrics
- [ ] SNS topics for alerts

---

### Post-Cutover Validation

**Immediate (First Hour):**
- [ ] ALB receiving traffic
- [ ] ECS tasks healthy (2+ running)
- [ ] Discord bot responding to messages
- [ ] No errors in CloudWatch logs
- [ ] Redis connections established
- [ ] MongoDB queries succeeding

**First 24 Hours:**
- [ ] Auto-scaling tested (manually trigger load)
- [ ] Health checks stable
- [ ] No memory leaks (monitor task memory usage)
- [ ] No connection pool exhaustion
- [ ] Background schedulers running
- [ ] Story generation working (if enabled)

**First Week:**
- [ ] No unexpected cost increases
- [ ] All client functionality working
- [ ] Backups completing successfully
- [ ] Performance acceptable (response times)
- [ ] No incidents or alerts

---

## Risk Mitigation

### High-Risk Areas

**1. Database Migration**
- **Risk:** Data loss during migration
- **Mitigation:** 
  - Use Atlas Live Migration (continuous sync)
  - Verify document counts before cutover
  - Keep Replit running for 48 hours
  - Test migration with sample data first

**2. Service Initialization**
- **Risk:** Services fail to start in AWS
- **Mitigation:**
  - Test thoroughly in docker-compose locally
  - Deploy to dev environment first
  - Increase ECS task startup grace period (60s → 120s)
  - Monitor CloudWatch logs during startup

**3. Discord Bot Connection**
- **Risk:** Bot disconnected or responding slowly
- **Mitigation:**
  - Test in Discord test server first
  - Verify Redis leader election working
  - Monitor Discord API latency
  - Have rollback plan ready

**4. Cost Overruns**
- **Risk:** AWS costs higher than expected
- **Mitigation:**
  - Set AWS Budgets with alerts ($500, $1000)
  - Monitor daily costs in Cost Explorer
  - Right-size resources (start small)
  - Use Fargate Spot for non-prod

---

## Success Metrics

### Technical Metrics

**Availability:**
- Target: 99.9% uptime (< 45 minutes downtime per month)
- Measure: ALB target health, ECS service running count

**Performance:**
- Target: p95 response time < 500ms
- Measure: ALB request latency metrics

**Reliability:**
- Target: Error rate < 1%
- Measure: ALB 5xx response count / total requests

**Scalability:**
- Target: Auto-scaling responds within 2 minutes
- Measure: CloudWatch auto-scaling events

### Business Metrics

**Cost Efficiency:**
- Target: AWS costs within 20% of estimate
- Dev: $200-250/month
- Prod: $900-1200/month

**Deployment Speed:**
- Target: < 10 minutes from git push to production
- Measure: GitHub Actions deployment time

**Recovery Time:**
- Target: < 5 minutes to rollback
- Measure: Time from issue detected to DNS reverted

---

## Post-Migration Cleanup

### Week 4: Optimization

**Tasks:**
- [ ] Review CloudWatch metrics
- [ ] Adjust auto-scaling thresholds if needed
- [ ] Right-size ECS task CPU/memory
- [ ] Optimize Redis cache settings
- [ ] Review and reduce log retention (cost optimization)
- [ ] Set up weekly cost reports
- [ ] Document any client-specific configurations

### Week 5: Replit Decommission

**Tasks:**
- [ ] Export final Replit backup
- [ ] Download all logs from Replit
- [ ] Archive Replit configuration
- [ ] Cancel Replit subscription (if paid)
- [ ] Update documentation to reflect AWS deployment
- [ ] Update README.md with new deployment instructions

---

## Lessons Learned Template

After migration, document:

```markdown
# Migration Lessons Learned

## What Went Well
- 
- 

## What Went Wrong
- 
- 

## What We'd Do Differently
- 
- 

## Recommendations for Next Client
- 
- 
```

---

## Summary

### Migration Phases

| Week | Phase | Focus | Risk Level |
|------|-------|-------|------------|
| 1 | Preparation | Docker, local testing | Low |
| 2 | Infrastructure | AWS deployment, dev environment | Medium |
| 3 | Production | Database migration, cutover | High |
| 4+ | Optimization | Monitoring, cost optimization | Low |

### Key Success Factors

✅ **Thorough Testing** - Test everything in dev before production  
✅ **Incremental Approach** - Don't skip phases  
✅ **Rollback Plan** - Always have escape hatch  
✅ **Monitoring** - Watch metrics closely during cutover  
✅ **Communication** - Keep stakeholders informed  

### Final Checklist

Before declaring migration complete:

- [ ] All services running on AWS
- [ ] Replit instance stopped
- [ ] Data verified in MongoDB Atlas
- [ ] 7 days of stable operation
- [ ] Cost tracking validated
- [ ] Documentation updated
- [ ] Team trained on new deployment process
- [ ] Rollback procedures tested
- [ ] Next client onboarding planned

---

## Conclusion

This 6-report series provides a complete, production-ready AWS deployment architecture for CosyWorld:

1. **[Report 00](./00_AWS_DEPLOYMENT_OVERVIEW.md)** - Strategic decisions and architecture overview
2. **[Report 01](./01_CONTAINERIZATION_GUIDE.md)** - Docker containerization
3. **[Report 02](./02_INFRASTRUCTURE_AS_CODE.md)** - Terraform infrastructure
4. **[Report 03](./03_CICD_PIPELINE.md)** - GitHub Actions CI/CD
5. **[Report 04](./04_MULTI_CLIENT_STRATEGY.md)** - Multi-client deployments
6. **[Report 05](./05_MIGRATION_PLAN.md)** - Migration and rollout (this document)

**Total Implementation Timeline:** 6 weeks  
**Total Cost (First Client):** ~$971/month production, ~$228/month dev  
**Team Size:** 1-2 developers  

The system is designed to be:
- **Production-ready** from day one
- **Scalable** to 100+ clients
- **Cost-efficient** with auto-scaling
- **Maintainable** with IaC and automation

**Ready to begin? Start with [Report 01 - Containerization Guide](./01_CONTAINERIZATION_GUIDE.md)**

---

*Migration Plan Version: 1.0*  
*Last Updated: November 13, 2025*
