# Cleanup Lambda Function

## Overview

The Cleanup Lambda function is responsible for maintaining the video upload system by removing expired upload sessions, aborting incomplete multipart uploads, and cleaning up orphaned S3 objects. This function is designed to run on a scheduled basis to ensure system health and cost optimization.

## Function Details

- **Function Name**: `video-upload-cleanup` (not currently deployed)
- **Runtime**: Node.js 20.x
- **Handler**: `index.handler`
- **Timeout**: 30 seconds (recommended)
- **Memory**: 256 MB (recommended)

## Trigger Configuration

- **Event Source**: Amazon EventBridge (CloudWatch Events)
- **Schedule**: Rate expression or cron expression
- **Recommended**: `rate(1 hour)` or `cron(0 */6 * * ? *)` (every 6 hours)

## Current Implementation

### Stub Function
```javascript
exports.handler = async () => {
  console.log('cleanup tick');
  return {}; 
};
```

The current implementation is a stub. Below is the planned comprehensive cleanup functionality.

## Cleanup Operations

### 1. Expired Session Cleanup

#### DynamoDB TTL vs Manual Cleanup
While DynamoDB TTL automatically removes expired items, manual cleanup provides:
- Immediate cleanup of associated S3 objects
- Logging and metrics for cleanup operations
- Custom business logic for session expiration

```javascript
async function cleanupExpiredSessions() {
  const ddb = new AWS.DynamoDB();
  const currentTime = Math.floor(Date.now() / 1000);
  
  // Scan for expired sessions
  const expiredSessions = await ddb.scan({
    TableName: process.env.TABLE_NAME,
    FilterExpression: '#ttl < :currentTime AND #status <> :uploaded',
    ExpressionAttributeNames: {
      '#ttl': 'ttl',
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':currentTime': { N: currentTime.toString() },
      ':uploaded': { S: 'uploaded' }
    }
  }).promise();
  
  const cleanupResults = {
    sessionsProcessed: 0,
    multipartUploadsAborted: 0,
    objectsDeleted: 0,
    errors: []
  };
  
  for (const session of expiredSessions.Items) {
    try {
      await cleanupSession(session, cleanupResults);
    } catch (error) {
      cleanupResults.errors.push({
        sessionId: session.uploadSessionId.S,
        error: error.message
      });
    }
  }
  
  return cleanupResults;
}
```

### 2. Multipart Upload Cleanup

```javascript
async function cleanupSession(session, results) {
  const s3 = new AWS.S3();
  const ddb = new AWS.DynamoDB();
  
  const sessionId = session.uploadSessionId.S;
  const uploadType = session.uploadType.S;
  const key = session.key.S;
  
  if (uploadType === 'multipart' && session.s3UploadId) {
    // Abort incomplete multipart upload
    try {
      await s3.abortMultipartUpload({
        Bucket: process.env.BUCKET,
        Key: key,
        UploadId: session.s3UploadId.S
      }).promise();
      
      results.multipartUploadsAborted++;
      console.log(`Aborted multipart upload: ${sessionId}`);
    } catch (error) {
      if (error.code !== 'NoSuchUpload') {
        throw error; // Re-throw if not already cleaned up
      }
    }
  }
  
  // Check if object exists and delete if incomplete
  if (session.status.S !== 'uploaded') {
    try {
      await s3.headObject({
        Bucket: process.env.BUCKET,
        Key: key
      }).promise();
      
      // Object exists but session is not marked as uploaded
      await s3.deleteObject({
        Bucket: process.env.BUCKET,
        Key: key
      }).promise();
      
      results.objectsDeleted++;
      console.log(`Deleted orphaned object: ${key}`);
    } catch (error) {
      if (error.code !== 'NotFound') {
        throw error;
      }
    }
  }
  
  // Remove session from DynamoDB
  await ddb.deleteItem({
    TableName: process.env.TABLE_NAME,
    Key: {
      uploadSessionId: { S: sessionId }
    }
  }).promise();
  
  results.sessionsProcessed++;
}
```

### 3. Orphaned Object Cleanup

```javascript
async function cleanupOrphanedObjects() {
  const s3 = new AWS.S3();
  const ddb = new AWS.DynamoDB();
  
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - 24); // Objects older than 24 hours
  
  const objects = await s3.listObjectsV2({
    Bucket: process.env.BUCKET,
    Prefix: 'uploads/',
    MaxKeys: 1000
  }).promise();
  
  const orphanedObjects = [];
  
  for (const object of objects.Contents) {
    if (object.LastModified < cutoffDate) {
      // Check if session exists for this object
      const sessionExists = await checkSessionExists(object.Key);
      
      if (!sessionExists) {
        orphanedObjects.push(object.Key);
      }
    }
  }
  
  // Delete orphaned objects in batches
  if (orphanedObjects.length > 0) {
    const deleteParams = {
      Bucket: process.env.BUCKET,
      Delete: {
        Objects: orphanedObjects.map(key => ({ Key: key })),
        Quiet: false
      }
    };
    
    const deleteResult = await s3.deleteObjects(deleteParams).promise();
    
    console.log(`Deleted ${deleteResult.Deleted.length} orphaned objects`);
    return deleteResult.Deleted.length;
  }
  
  return 0;
}

async function checkSessionExists(objectKey) {
  const ddb = new AWS.DynamoDB();
  
  // Extract session ID from object key pattern
  const match = objectKey.match(/uploads\/\d{4}-\d{2}-\d{2}\/([^.]+)\./);
  if (!match) return false;
  
  const sessionId = match[1];
  
  try {
    const result = await ddb.getItem({
      TableName: process.env.TABLE_NAME,
      Key: {
        uploadSessionId: { S: sessionId }
      }
    }).promise();
    
    return !!result.Item;
  } catch (error) {
    console.error(`Error checking session ${sessionId}:`, error);
    return true; // Assume exists to avoid accidental deletion
  }
}
```

### 4. Failed Upload Cleanup

```javascript
async function cleanupFailedUploads() {
  const ddb = new AWS.DynamoDB();
  const s3 = new AWS.S3();
  
  // Find sessions stuck in 'created' status for more than 1 hour
  const oneHourAgo = Math.floor((Date.now() - 3600000) / 1000);
  
  const stuckSessions = await ddb.scan({
    TableName: process.env.TABLE_NAME,
    FilterExpression: '#status = :created AND #ttl < :oneHourAgo',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':created': { S: 'created' },
      ':oneHourAgo': { N: oneHourAgo.toString() }
    }
  }).promise();
  
  let cleanedCount = 0;
  
  for (const session of stuckSessions.Items) {
    const sessionId = session.uploadSessionId.S;
    const uploadType = session.uploadType.S;
    
    try {
      if (uploadType === 'multipart' && session.s3UploadId) {
        // List parts to see if any were uploaded
        const parts = await s3.listParts({
          Bucket: process.env.BUCKET,
          Key: session.key.S,
          UploadId: session.s3UploadId.S
        }).promise();
        
        if (parts.Parts.length === 0) {
          // No parts uploaded, safe to abort
          await s3.abortMultipartUpload({
            Bucket: process.env.BUCKET,
            Key: session.key.S,
            UploadId: session.s3UploadId.S
          }).promise();
          
          console.log(`Aborted stuck multipart upload: ${sessionId}`);
        } else {
          // Parts exist, mark as 'partial' for manual review
          await ddb.updateItem({
            TableName: process.env.TABLE_NAME,
            Key: { uploadSessionId: { S: sessionId } },
            UpdateExpression: 'SET #status = :partial',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':partial': { S: 'partial' } }
          }).promise();
          
          continue; // Don't delete the session
        }
      }
      
      // Delete the session
      await ddb.deleteItem({
        TableName: process.env.TABLE_NAME,
        Key: { uploadSessionId: { S: sessionId } }
      }).promise();
      
      cleanedCount++;
    } catch (error) {
      console.error(`Error cleaning stuck session ${sessionId}:`, error);
    }
  }
  
  return cleanedCount;
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TABLE_NAME` | - | DynamoDB table name |
| `BUCKET` | - | S3 bucket name |
| `CLEANUP_AGE_HOURS` | 24 | Age threshold for orphaned objects |
| `BATCH_SIZE` | 100 | Number of items to process per batch |
| `DRY_RUN` | false | If true, log actions without executing |

## Main Handler Function

```javascript
exports.handler = async (event, context) => {
  console.log('Starting cleanup process');
  
  const results = {
    timestamp: new Date().toISOString(),
    requestId: context.awsRequestId,
    expiredSessionsCleanup: null,
    orphanedObjectsCleanup: null,
    failedUploadsCleanup: null,
    totalDuration: 0,
    errors: []
  };
  
  const startTime = Date.now();
  
  try {
    // 1. Clean up expired sessions
    console.log('Cleaning expired sessions...');
    results.expiredSessionsCleanup = await cleanupExpiredSessions();
    
    // 2. Clean up orphaned objects
    console.log('Cleaning orphaned objects...');
    results.orphanedObjectsCleanup = await cleanupOrphanedObjects();
    
    // 3. Clean up failed uploads
    console.log('Cleaning failed uploads...');
    results.failedUploadsCleanup = await cleanupFailedUploads();
    
  } catch (error) {
    console.error('Cleanup process error:', error);
    results.errors.push({
      type: 'GENERAL_ERROR',
      message: error.message,
      stack: error.stack
    });
  }
  
  results.totalDuration = Date.now() - startTime;
  
  // Send metrics to CloudWatch
  await sendMetrics(results);
  
  console.log('Cleanup process completed:', JSON.stringify(results, null, 2));
  
  return results;
};
```

## Monitoring and Alerting

### CloudWatch Metrics
```javascript
async function sendMetrics(results) {
  const cloudWatch = new AWS.CloudWatch();
  
  const metrics = [
    {
      MetricName: 'SessionsCleanedUp',
      Value: results.expiredSessionsCleanup?.sessionsProcessed || 0,
      Unit: 'Count'
    },
    {
      MetricName: 'MultipartUploadsAborted',
      Value: results.expiredSessionsCleanup?.multipartUploadsAborted || 0,
      Unit: 'Count'
    },
    {
      MetricName: 'OrphanedObjectsDeleted',
      Value: results.orphanedObjectsCleanup || 0,
      Unit: 'Count'
    },
    {
      MetricName: 'CleanupDuration',
      Value: results.totalDuration,
      Unit: 'Milliseconds'
    },
    {
      MetricName: 'CleanupErrors',
      Value: results.errors.length,
      Unit: 'Count'
    }
  ];
  
  await cloudWatch.putMetricData({
    Namespace: 'VideoUpload/Cleanup',
    MetricData: metrics.map(metric => ({
      ...metric,
      Timestamp: new Date()
    }))
  }).promise();
}
```

### CloudWatch Alarms
```yaml
# CloudWatch Alarm for cleanup failures
CleanupErrorAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: VideoUpload-CleanupErrors
    AlarmDescription: High number of cleanup errors
    MetricName: CleanupErrors
    Namespace: VideoUpload/Cleanup
    Statistic: Sum
    Period: 3600
    EvaluationPeriods: 1
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref SNSTopic
```

## Testing

### Unit Tests
```javascript
const { handler } = require('./index');

describe('Cleanup Lambda', () => {
  beforeEach(() => {
    // Mock AWS services
    jest.clearAllMocks();
  });
  
  test('should clean up expired sessions', async () => {
    // Mock DynamoDB scan response
    const mockScan = jest.fn().mockResolvedValue({
      Items: [
        {
          uploadSessionId: { S: 'test-session' },
          uploadType: { S: 'single' },
          status: { S: 'created' },
          ttl: { N: '1000' }
        }
      ]
    });
    
    AWS.DynamoDB.prototype.scan = mockScan;
    
    const result = await handler({});
    
    expect(result.expiredSessionsCleanup.sessionsProcessed).toBe(1);
  });
});
```

### Integration Testing
```bash
# Test with dry run mode
aws lambda invoke \
  --function-name video-upload-cleanup \
  --payload '{"dryRun": true}' \
  --cli-binary-format raw-in-base64-out \
  response.json

cat response.json | jq .
```

## Deployment Configuration

### EventBridge Rule
```yaml
CleanupScheduleRule:
  Type: AWS::Events::Rule
  Properties:
    Description: "Trigger cleanup function every 6 hours"
    ScheduleExpression: "rate(6 hours)"
    State: ENABLED
    Targets:
      - Arn: !GetAtt CleanupFunction.Arn
        Id: "CleanupFunctionTarget"
```

### IAM Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/UploadSessions"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:AbortMultipartUpload",
        "s3:DeleteObject",
        "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::bucket-name",
        "arn:aws:s3:::bucket-name/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

## Security Considerations

1. **Least Privilege**: Only required permissions for cleanup operations
2. **Validation**: Verify object ownership before deletion
3. **Audit Trail**: Log all cleanup actions for compliance
4. **Rate Limiting**: Prevent excessive API calls during cleanup
5. **Error Handling**: Graceful handling of permission errors

## Performance Optimization

1. **Batch Operations**: Process multiple items per API call
2. **Parallel Processing**: Use Promise.all for independent operations
3. **Pagination**: Handle large result sets efficiently
4. **Memory Management**: Optimize for large-scale cleanup operations
5. **Timeout Management**: Split large operations across multiple invocations

## Future Enhancements

1. **Cost Reporting**: Track storage costs saved through cleanup
2. **Intelligent Scheduling**: Adjust frequency based on upload patterns
3. **Selective Cleanup**: Target cleanup based on user or content type
4. **Recovery Options**: Temporary retention for accidentally deleted items
5. **Analytics Integration**: Feed cleanup data into business intelligence systems

---

*Function Version: 1.0*
*Last Updated: August 21, 2025*
