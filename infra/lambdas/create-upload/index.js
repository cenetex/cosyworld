// Create Upload Lambda (AWS SDK v3)
// - Initializes single or multipart upload
// - Writes session metadata to DynamoDB
// - Returns presigned URL(s) for client-side upload

const crypto = require('crypto');
const { S3Client, PutObjectCommand, CreateMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const ddb = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

const SINGLE_MAX = +process.env.SINGLE_MAX_BYTES || 26214400; // 25 MiB
const PART_SIZE = +process.env.PART_SIZE || 5242880; // 5 MiB minimum
const URL_EXPIRY = +process.env.URL_EXPIRY_SECONDS || 300; // 5 mins

exports.handler = async (event) => {
  try {
    const body = safeJson(event?.body) || {};
    const size = +body.fileSizeBytes || 0;
    const ct = (body.contentType || 'video/mp4').toString();
    if (!size || size < 1) return json(400, { error: 'invalid_size' });

    const id = crypto.randomUUID();
    const date = new Date().toISOString().slice(0, 10);
    const ext = (body.fileExtension || 'mp4').toString().replace(/[^a-z0-9]/gi, '') || 'mp4';
    const key = `uploads/${date}/${id}.${ext}`;
    const ttl = Math.floor(Date.now() / 1000) + 3600; // 1 hour default TTL

    if (size <= SINGLE_MAX) {
      const putUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: process.env.BUCKET,
          Key: key,
          ContentType: ct,
        }),
        { expiresIn: URL_EXPIRY }
      );

      await ddb.send(
        new PutItemCommand({
          TableName: process.env.TABLE_NAME,
          Item: {
            uploadSessionId: { S: id },
            uploadType: { S: 'single' },
            status: { S: 'created' },
            key: { S: key },
            ttl: { N: String(ttl) },
          },
        })
      );

      return json(200, { uploadSessionId: id, uploadType: 'single', key, putUrl, expiresIn: URL_EXPIRY });
    }

    // Multipart
    const totalParts = Math.ceil(size / PART_SIZE);
    const mp = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: process.env.BUCKET, Key: key, ContentType: ct })
    );

    await ddb.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          uploadSessionId: { S: id },
          uploadType: { S: 'multipart' },
          status: { S: 'created' },
          s3UploadId: { S: mp.UploadId },
          key: { S: key },
          partSize: { N: String(PART_SIZE) },
          totalParts: { N: String(totalParts) },
          ttl: { N: String(ttl) },
        },
      })
    );

    return json(200, {
      uploadSessionId: id,
      uploadType: 'multipart',
      key,
      s3UploadId: mp.UploadId,
      partSize: PART_SIZE,
      totalParts,
    });
  } catch (err) {
    console.error('create-upload error', err);
    return json(500, { error: 'internal_error', message: err?.message });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function safeJson(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}
