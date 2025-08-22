# Create Upload Lambda Function

## Overview

The Create Upload Lambda function is responsible for initializing new video upload sessions. It determines whether to use single-part or multipart upload based on file size and generates the necessary presigned URLs for direct S3 upload.

## Function Details

- **Function Name**: `video-upload-create`
- **Runtime**: Node.js 20.x
- **Handler**: `index.handler`
- **Timeout**: 10 seconds
- **Memory**: 128 MB (default)

## API Endpoint

- **Method**: POST
- **Path**: `/video/upload/create`
- **Content-Type**: `application/json`

## Request Schema

```json
{
  "fileSizeBytes": 1048576,
  "contentType": "video/mp4",
  "fileExtension": "mp4"
}
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fileSizeBytes` | number | Yes | Size of the file in bytes |
| `contentType` | string | No | MIME type (default: "video/mp4") |
| `fileExtension` | string | No | File extension (default: "mp4") |

## Response Schema

### Single-Part Upload Response
```json
{
  "uploadSessionId": "uuid-v4",
  "uploadType": "single",
  "key": "uploads/2025-08-21/uuid-v4.mp4",
  "putUrl": "https://bucket.s3.amazonaws.com/uploads/...",
  "expiresIn": 300
}
```

### Multipart Upload Response
```json
{
  "uploadSessionId": "uuid-v4",
  "uploadType": "multipart", 
  "key": "uploads/2025-08-21/uuid-v4.mp4",
  "s3UploadId": "aws-multipart-upload-id",
  "partSize": 5242880,
  "totalParts": 5
}
```

## Business Logic

### File Size Decision Logic
```javascript
const SINGLE_MAX = 26214400; // 25 MB
const PART_SIZE = 5242880;   // 5 MB

if (fileSizeBytes <= SINGLE_MAX) {
  // Single-part upload
} else {
  // Multipart upload
  const totalParts = Math.ceil(fileSizeBytes / PART_SIZE);
}
```

### Key Generation
- Pattern: `uploads/YYYY-MM-DD/uuid-v4.extension`
- Date component for logical organization
- UUID ensures uniqueness
- Extension sanitized (alphanumeric only)

### DynamoDB Session Record
```json
{
  "uploadSessionId": {"S": "uuid"},
  "uploadType": {"S": "single|multipart"},
  "status": {"S": "created"},
  "key": {"S": "uploads/..."},
  "ttl": {"N": "1692612000"},
  // Multipart only:
  "s3UploadId": {"S": "aws-upload-id"},
  "partSize": {"N": "5242880"},
  "totalParts": {"N": "5"}
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUCKET` | - | S3 bucket name |
| `TABLE_NAME` | - | DynamoDB table name |
| `SINGLE_MAX_BYTES` | 26214400 | Single upload limit |
| `PART_SIZE` | 5242880 | Multipart part size |
| `URL_EXPIRY_SECONDS` | 300 | Presigned URL expiry |

## Error Handling

### Error Responses
```json
{
  "error": "invalid_size",
  "message": "File size must be greater than 0"
}
```

### Error Codes
- `invalid_size`: File size is 0 or negative
- `internal_error`: AWS service errors, DynamoDB failures

## Security Considerations

1. **Input Validation**: File size and content type validation
2. **Presigned URLs**: Time-limited access (5 minutes default)
3. **Path Sanitization**: Extension and filename cleaning
4. **Rate Limiting**: Handled at API Gateway level

## Monitoring and Observability

### CloudWatch Metrics
- Invocation count
- Duration
- Error rate
- Throttles

### Custom Metrics (Future)
- Upload session creation rate
- Single vs multipart ratio
- File size distribution

### Logging
```javascript
console.log('Upload session created:', {
  sessionId,
  uploadType,
  fileSize: fileSizeBytes,
  contentType
});
```

## Testing

### Unit Test Example
```javascript
const event = {
  body: JSON.stringify({
    fileSizeBytes: 1048576,
    contentType: 'video/mp4'
  })
};

const result = await handler(event);
const body = JSON.parse(result.body);

expect(result.statusCode).toBe(200);
expect(body.uploadType).toBe('single');
expect(body.putUrl).toContain('X-Amz-Signature');
```

### Integration Test
```bash
API_URL="https://api-id.execute-api.region.amazonaws.com/prod"

curl -X POST "$API_URL/video/upload/create" \
  -H "Content-Type: application/json" \
  -d '{
    "fileSizeBytes": 1048576,
    "contentType": "video/mp4",
    "fileExtension": "mp4"
  }'
```

## Performance Considerations

1. **Cold Start**: ~100-300ms for Node.js 20.x
2. **Warm Start**: ~10-50ms typical execution
3. **Memory Usage**: ~50-70MB peak
4. **DynamoDB**: Single write operation per request

## Future Enhancements

1. **Content Type Validation**: MIME type verification
2. **File Name Preservation**: Optional original filename storage
3. **User Authentication**: Integration with auth tokens
4. **Quota Management**: Per-user upload limits
5. **Virus Scanning**: Pre-upload validation
6. **Custom Metadata**: Additional file attributes

---

*Function Version: 1.0*
*Last Updated: August 21, 2025*
