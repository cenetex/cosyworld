// Complete Upload Lambda (AWS SDK v3)
// - Marks single uploads as uploaded
// - Completes multipart uploads with provided ETags

const { S3Client, CompleteMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const ddb = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

exports.handler = async (event) => {
  try {
    const body = safeJson(event?.body) || {};
    const id = body.uploadSessionId;
    if (!id) return json(400, { error: 'uploadSessionId required' });

    const it = await ddb.send(
      new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: { uploadSessionId: { S: id } } })
    );
    if (!it.Item) return json(404, { error: 'not_found' });

    const type = it.Item.uploadType.S;
    const key = it.Item.key.S;

    if (type === 'single') {
      await ddb.send(
        new UpdateItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: { uploadSessionId: { S: id } },
          UpdateExpression: 'SET #s = :s',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': { S: 'uploaded' } },
        })
      );
      return json(200, { status: 'uploaded', key });
    }

    if (type === 'multipart') {
      const uploadId = it.Item.s3UploadId.S;
      const parts = Array.isArray(body.parts) ? body.parts : [];
      const list = parts
        .map((p) => ({ ETag: p.eTag || p.ETag, PartNumber: p.partNumber || p.PartNumber }))
        .filter((x) => x.ETag && x.PartNumber)
        .sort((a, b) => a.PartNumber - b.PartNumber);
      if (!list.length) return json(400, { error: 'parts required' });

      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: process.env.BUCKET,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: list },
        })
      );

      await ddb.send(
        new UpdateItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: { uploadSessionId: { S: id } },
          UpdateExpression: 'SET #s = :s',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': { S: 'uploaded' } },
        })
      );
      return json(200, { status: 'uploaded', key });
    }

    return json(400, { error: 'invalid_type' });
  } catch (err) {
    console.error('complete-upload error', err);
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
