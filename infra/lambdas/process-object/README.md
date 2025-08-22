# Process Object Lambda Function

## Overview

The Process Object Lambda function is triggered by S3 ObjectCreated events when files are uploaded to the ingest bucket. It serves as the entry point for post-upload processing workflows including video transcoding, thumbnail generation, and metadata extraction.

## Function Details

- **Function Name**: `video-upload-process`
- **Runtime**: Node.js 20.x
- **Handler**: `index.handler`
- **Timeout**: 15 seconds
- **Memory**: 128 MB (default)

## Trigger Configuration

- **Event Source**: S3 Bucket Notifications
- **Event Types**: `s3:ObjectCreated:*`
- **Filter**: Object key prefix `uploads/`
- **Delivery**: Asynchronous invocation

## Event Schema

### S3 Event Structure
```json
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "us-east-1",
      "eventTime": "2025-08-21T12:00:00.000Z",
      "eventName": "ObjectCreated:Put",
      "userIdentity": {
        "principalId": "AWS:AIDAI..."
      },
      "requestParameters": {
        "sourceIPAddress": "127.0.0.1"
      },
      "responseElements": {
        "x-amz-request-id": "C3D13FE58DE4C24",
        "x-amz-id-2": "FMyUVURIY8..."
      },
      "s3": {
        "s3SchemaVersion": "1.0",
        "configurationId": "process-uploads",
        "bucket": {
          "name": "bucket-name",
          "ownerIdentity": {
            "principalId": "A3NL1KOZTQw"
          },
          "arn": "arn:aws:s3:::bucket-name"
        },
        "object": {
          "key": "uploads/2025-08-21/uuid-v4.mp4",
          "size": 1048576,
          "eTag": "0123456789abcdef",
          "sequencer": "0A1B2C3D4E5F681"
        }
      }
    }
  ]
}
```

## Current Implementation

### Stub Function
```javascript
exports.handler = async (event) => {
  console.log('S3 event', JSON.stringify(event));
  return { ok: true };
};
```

The current implementation is a stub that only logs incoming events. This serves as a foundation for future processing capabilities.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TABLE_NAME` | - | DynamoDB table name |
| `PROCESSING_QUEUE_URL` | - | SQS queue for async processing |
| `TRANSCODE_PIPELINE_ID` | - | Elastic Transcoder pipeline |

## Planned Processing Workflows

### 1. Video Transcoding
```mermaid
graph LR
    S3[S3 Upload] --> Process[Process Lambda]
    Process --> MediaConvert[AWS MediaConvert]
    MediaConvert --> Output[Transcoded Videos]
    Output --> Notification[Completion Notification]
```

#### Implementation Plan
```javascript
async function transcodeVideo(bucket, key) {
  const mediaConvert = new AWS.MediaConvert();
  
  const job = await mediaConvert.createJob({
    Role: process.env.MEDIACONVERT_ROLE,
    Settings: {
      Inputs: [{
        FileInput: `s3://${bucket}/${key}`,
        VideoSelector: {},
        AudioSelector: {}
      }],
      OutputGroups: [{
        Name: "File Group",
        OutputGroupSettings: {
          Type: "FILE_GROUP_SETTINGS",
          FileGroupSettings: {
            Destination: `s3://${bucket}/processed/`
          }
        },
        Outputs: [
          // 1080p output
          {
            VideoDescription: {
              Width: 1920,
              Height: 1080,
              CodecSettings: {
                Codec: "H_264"
              }
            }
          },
          // 720p output  
          {
            VideoDescription: {
              Width: 1280,
              Height: 720,
              CodecSettings: {
                Codec: "H_264"
              }
            }
          }
        ]
      }]
    }
  }).promise();
  
  return job.Job.Id;
}
```

### 2. Thumbnail Generation
```javascript
async function generateThumbnail(bucket, key) {
  const ffmpeg = require('fluent-ffmpeg');
  const sharp = require('sharp');
  
  // Extract frame at 3 seconds
  const thumbnailBuffer = await new Promise((resolve, reject) => {
    ffmpeg(`s3://${bucket}/${key}`)
      .seekInput(3)
      .frames(1)
      .format('png')
      .pipe()
      .on('data', resolve)
      .on('error', reject);
  });
  
  // Generate multiple sizes
  const sizes = [
    { width: 320, height: 240, suffix: 'small' },
    { width: 640, height: 480, suffix: 'medium' },
    { width: 1280, height: 720, suffix: 'large' }
  ];
  
  const thumbnails = await Promise.all(
    sizes.map(async ({ width, height, suffix }) => {
      const resized = await sharp(thumbnailBuffer)
        .resize(width, height)
        .png()
        .toBuffer();
        
      const thumbnailKey = key.replace(/\.[^.]+$/, `_${suffix}.png`);
      
      await s3.putObject({
        Bucket: bucket,
        Key: `thumbnails/${thumbnailKey}`,
        Body: resized,
        ContentType: 'image/png'
      }).promise();
      
      return `thumbnails/${thumbnailKey}`;
    })
  );
  
  return thumbnails;
}
```

### 3. Metadata Extraction
```javascript
async function extractMetadata(bucket, key) {
  const ffprobe = require('ffprobe-static');
  const ffmpeg = require('fluent-ffmpeg');
  
  const metadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(`s3://${bucket}/${key}`, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
  
  const videoStream = metadata.streams.find(s => s.codec_type === 'video');
  const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
  
  return {
    duration: parseFloat(metadata.format.duration),
    size: parseInt(metadata.format.size),
    bitrate: parseInt(metadata.format.bit_rate),
    video: videoStream ? {
      codec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      framerate: eval(videoStream.r_frame_rate),
      bitrate: parseInt(videoStream.bit_rate)
    } : null,
    audio: audioStream ? {
      codec: audioStream.codec_name,
      sampleRate: parseInt(audioStream.sample_rate),
      channels: audioStream.channels,
      bitrate: parseInt(audioStream.bit_rate)
    } : null
  };
}
```

### 4. Database Updates
```javascript
async function updateDatabase(sessionId, metadata, thumbnails, transcodedFiles) {
  const ddb = new AWS.DynamoDB();
  
  await ddb.updateItem({
    TableName: process.env.TABLE_NAME,
    Key: {
      uploadSessionId: { S: sessionId }
    },
    UpdateExpression: `
      SET #status = :status,
          #metadata = :metadata,
          #thumbnails = :thumbnails,
          #transcoded = :transcoded,
          #processedAt = :processedAt
    `,
    ExpressionAttributeNames: {
      '#status': 'status',
      '#metadata': 'metadata',
      '#thumbnails': 'thumbnails',
      '#transcoded': 'transcodedFiles',
      '#processedAt': 'processedAt'
    },
    ExpressionAttributeValues: {
      ':status': { S: 'processed' },
      ':metadata': { S: JSON.stringify(metadata) },
      ':thumbnails': { SS: thumbnails },
      ':transcoded': { SS: transcodedFiles },
      ':processedAt': { S: new Date().toISOString() }
    }
  }).promise();
}
```

## Error Handling

### Retry Strategy
```javascript
const MAX_RETRIES = 3;
const RETRY_DELAY = [1000, 5000, 15000]; // Exponential backoff

async function processWithRetry(fn, retries = 0) {
  try {
    return await fn();
  } catch (error) {
    if (retries < MAX_RETRIES) {
      console.log(`Retry ${retries + 1} after error:`, error.message);
      await sleep(RETRY_DELAY[retries]);
      return processWithRetry(fn, retries + 1);
    }
    throw error;
  }
}
```

### Dead Letter Queue
```javascript
// Send failed processing events to DLQ for manual review
async function sendToDLQ(originalEvent, error) {
  const sqs = new AWS.SQS();
  
  await sqs.sendMessage({
    QueueUrl: process.env.DLQ_URL,
    MessageBody: JSON.stringify({
      originalEvent,
      error: error.message,
      timestamp: new Date().toISOString(),
      retryCount: 0
    })
  }).promise();
}
```

## Monitoring and Observability

### CloudWatch Metrics
- Processing success rate
- Average processing time
- Error rate by type
- Queue depth for async processing

### Custom Metrics
```javascript
const cloudWatch = new AWS.CloudWatch();

await cloudWatch.putMetricData({
  Namespace: 'VideoUpload/Processing',
  MetricData: [
    {
      MetricName: 'ProcessingDuration',
      Value: processingTime,
      Unit: 'Milliseconds',
      Dimensions: [
        {
          Name: 'FileSize',
          Value: getFileSizeCategory(fileSize)
        }
      ]
    }
  ]
}).promise();
```

### Structured Logging
```javascript
const logger = {
  info: (message, context = {}) => {
    console.log(JSON.stringify({
      level: 'INFO',
      message,
      timestamp: new Date().toISOString(),
      requestId: process.env.AWS_REQUEST_ID,
      ...context
    }));
  },
  
  error: (message, error, context = {}) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      message,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      requestId: process.env.AWS_REQUEST_ID,
      ...context
    }));
  }
};
```

## Testing

### Local Testing with SAM
```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  ProcessFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: process-object/
      Handler: index.handler
      Runtime: nodejs20.x
      Events:
        S3Event:
          Type: S3
          Properties:
            Bucket: !Ref TestBucket
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: uploads/
```

### Unit Tests
```javascript
const { handler } = require('./index');

describe('Process Object Lambda', () => {
  test('should process S3 event successfully', async () => {
    const event = {
      Records: [{
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'uploads/test.mp4', size: 1048576 }
        }
      }]
    };
    
    const result = await handler(event);
    expect(result.ok).toBe(true);
  });
  
  test('should handle multiple records', async () => {
    const event = {
      Records: [
        { s3: { bucket: { name: 'test-bucket' }, object: { key: 'uploads/test1.mp4' } } },
        { s3: { bucket: { name: 'test-bucket' }, object: { key: 'uploads/test2.mp4' } } }
      ]
    };
    
    const result = await handler(event);
    expect(result.processedCount).toBe(2);
  });
});
```

## Security Considerations

1. **IAM Permissions**: Least privilege access to required services
2. **Input Validation**: Verify S3 event structure and object metadata
3. **Resource Limits**: Prevent processing of extremely large files
4. **Network Access**: Use VPC endpoints for service communication
5. **Secrets Management**: Use AWS Systems Manager for API keys

## Performance Optimization

1. **Memory Allocation**: Adjust based on file sizes being processed
2. **Concurrent Processing**: Process multiple files in parallel
3. **Streaming**: Use streaming for large file operations
4. **Caching**: Cache frequently accessed metadata
5. **Connection Pooling**: Reuse AWS service connections

## Future Enhancements

1. **AI Integration**: Content analysis and tagging
2. **Quality Control**: Automated quality scoring
3. **Format Detection**: Support for additional video formats
4. **Batch Processing**: Efficient handling of bulk uploads
5. **Real-time Analytics**: Live processing metrics dashboard
6. **Content Moderation**: Automated inappropriate content detection

---

*Function Version: 1.0*
*Last Updated: August 21, 2025*
