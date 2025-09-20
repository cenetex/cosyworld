// Process Object Lambda
// Currently logs S3 ObjectCreated events; can be extended for processing
exports.handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  console.log('process-object event records:', records.length);
  for (const rec of records) {
    const bucket = rec?.s3?.bucket?.name;
    const key = decodeURIComponent((rec?.s3?.object?.key || '').replace(/\+/g, ' '));
    const size = rec?.s3?.object?.size;
    console.log('ObjectCreated', { bucket, key, size });
  }
  return { ok: true, processedCount: records.length };
};
