# Complete Upload Lambda Function

## Overview

The Complete Upload Lambda function finalizes video upload sessions by either marking single-part uploads as complete or assembling multipart uploads into the final S3 object.

## Function Details

- **Function Name**: `video-upload-complete`
- **Runtime**: Node.js 20.x
- **Handler**: `index.handler`
- **Timeout**: 15 seconds
- **Memory**: 128 MB (default)

## API Endpoint

- **Method**: POST
- **Path**: `/video/upload/complete`
- **Content-Type**: `application/json`

## Request Schema

### Single-Part Upload Completion
```json
{
  "uploadSessionId": "uuid-v4"
}
```

### Multipart Upload Completion
```json
{
  "uploadSessionId": "uuid-v4",
  "parts": [
    {
      "partNumber": 1,
      "eTag": "\"d41d8cd98f00b204e9800998ecf8427e\""
    },
    {
      "partNumber": 2,
      "eTag": "\"098f6bcd4621d373cade4e832627b4f6\""
    }
  ]
}
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uploadSessionId` | string | Yes | UUID of the upload session |
| `parts` | array | Conditional | Required for multipart uploads |
| `parts[].partNumber` | number | Yes | Part number (1-based) |
| `parts[].eTag` | string | Yes | ETag returned by S3 for the part |

## Response Schema

### Success Response
```json
{
  "status": "uploaded",
  "key": "uploads/2025-08-21/uuid-v4.mp4"
}
```

### Error Response
```json
{
  "error": "not_found",
  "message": "Upload session not found"
}
```

## Business Logic

### Single-Part Upload Flow
1. Validate session exists and is type 'single'
2. Update DynamoDB status to 'uploaded'
3. Return success with object key

### Multipart Upload Flow
1. Validate session exists and is type 'multipart'
2. Validate parts array is provided and not empty
3. Sort parts by part number
4. Call S3 CompleteMultipartUpload API
5. Update DynamoDB status to 'uploaded'
6. Return success with object key

### Part Validation
```javascript
const parts = requestParts
  .map(p => ({
    ETag: p.eTag || p.ETag,
    PartNumber: p.partNumber || p.PartNumber
  }))
  .filter(x => x.ETag && x.PartNumber)
  .sort((a, b) => a.PartNumber - b.PartNumber);
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUCKET` | - | S3 bucket name |
| `TABLE_NAME` | - | DynamoDB table name |

## Error Handling

### Error Codes
- `uploadSessionId required`: Missing session ID
- `not_found`: Session doesn't exist in DynamoDB
- `parts required`: Missing parts array for multipart upload
- `invalid_type`: Unknown upload type in session
- `internal_error`: AWS service errors

### S3 Error Handling
```javascript
try {
  await s3.completeMultipartUpload({
    Bucket: process.env.BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: sortedParts }
  }).promise();
} catch (error) {
  // Handle InvalidPart, NoSuchUpload, etc.
  throw new Error(`S3 completion failed: ${error.message}`);
}
```

## DynamoDB Operations

### Session Lookup
```javascript
const response = await ddb.getItem({
  TableName: process.env.TABLE_NAME,
  Key: {
    uploadSessionId: { S: sessionId }
  }
}).promise();
```

### Status Update
```javascript
await ddb.updateItem({
  TableName: process.env.TABLE_NAME,
  Key: {
    uploadSessionId: { S: sessionId }
  },
  UpdateExpression: 'SET #status = :status',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':status': { S: 'uploaded' }
  }
}).promise();
```

## Security Considerations

1. **Session Validation**: Verify session exists and belongs to user
2. **Part Validation**: Ensure ETags match uploaded parts
3. **State Management**: Prevent multiple completion attempts
4. **Error Information**: Don't leak sensitive AWS details

## Monitoring and Observability

### CloudWatch Metrics
- Completion success rate
- Average completion time
- Error distribution by type
- Multipart vs single-part completion ratio

### Custom Logging
```javascript
console.log('Upload completed:', {
  sessionId,
  uploadType,
  key,
  partsCount: parts?.length,
  duration: Date.now() - startTime
});
```

## Testing

### Single-Part Upload Test
```bash
# After creating session and uploading file
curl -X POST "$API_URL/video/upload/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "uploadSessionId": "test-session-id"
  }'
```

### Multipart Upload Test
```bash
curl -X POST "$API_URL/video/upload/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "uploadSessionId": "test-session-id",
    "parts": [
      {"partNumber": 1, "eTag": "\"etag1\""},
      {"partNumber": 2, "eTag": "\"etag2\""}
    ]
  }'
```

## Common Issues and Troubleshooting

### Issue: InvalidPart Error
**Cause**: Part ETag doesn't match uploaded part
**Solution**: Verify client correctly stores ETags from upload responses

### Issue: NoSuchUpload Error
**Cause**: Multipart upload was aborted or expired
**Solution**: Check upload expiration and handle gracefully

### Issue: Timeout on Large Files
**Cause**: Many parts or slow S3 response
**Solution**: Increase Lambda timeout (currently 15s)

### Issue: Concurrent Completion
**Cause**: Multiple completion attempts
**Solution**: Add DynamoDB conditional updates

## Performance Optimization

1. **Concurrent Operations**: DynamoDB and S3 calls could be parallelized
2. **Part Validation**: Client-side ETag validation before completion
3. **Retry Logic**: Exponential backoff for transient failures
4. **Memory Efficiency**: Stream large part lists instead of loading all

## Future Enhancements

1. **Atomic Operations**: DynamoDB transactions for state changes
2. **Notification Integration**: Trigger downstream processing
3. **Metadata Extraction**: File size, duration, format detection
4. **Cleanup Integration**: Schedule cleanup of old sessions
5. **Analytics**: Track completion patterns and performance
6. **Validation**: Content type verification post-upload

---

*Function Version: 1.0*
*Last Updated: August 21, 2025*
