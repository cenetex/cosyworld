// Parts Upload Lambda (AWS SDK v3)
// - Returns presigned URLs for specified part numbers of a multipart upload

const { S3Client, UploadPartCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const ddb = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

const URL_EXPIRY = +process.env.URL_EXPIRY_SECONDS || 300; // 5 mins

exports.handler = async (event) => {
  try {
    const body = safeJson(event?.body) || {};
    const id = body.uploadSessionId;
    let parts = body.parts;

    if (!id) return json(400, { error: 'uploadSessionId required' });
    if (!Array.isArray(parts) || !parts.length) return json(400, { error: 'parts required' });

    const it = await ddb.send(
      new GetItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: { uploadSessionId: { S: id } },
      })
    );

    if (!it.Item || it.Item.uploadType.S !== 'multipart') return json(404, { error: 'not_found' });

    const key = it.Item.key.S;
    const uploadId = it.Item.s3UploadId.S;
    const total = parseInt(it.Item.totalParts.N, 10);

    parts = [...new Set(parts.map((n) => +n).filter((n) => n >= 1 && n <= total))];
    if (!parts.length) return json(400, { error: 'no_valid_parts' });

    const urls = await Promise.all(
      parts.map(async (p) => {
        // Important: remove flexible checksums middleware so the presigned URL
        // does NOT embed x-amz-checksum-* params for an unknown body.
        const cmd = new UploadPartCommand({
          Bucket: process.env.BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: p,
        });
        try {
          cmd.middlewareStack.remove('flexibleChecksumsMiddleware');
        } catch {}
        const url = await getSignedUrl(s3, cmd, { expiresIn: URL_EXPIRY });
        return { partNumber: p, url };
      })
    );

    return json(200, { uploadSessionId: id, key, urls, expiresIn: URL_EXPIRY });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal_error', message: err?.message });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function safeJson(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}
