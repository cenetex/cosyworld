// Cleanup Lambda (basic placeholder)
exports.handler = async () => {
  const start = Date.now();
  console.log('cleanup tick');
  // TODO: Implement expired session and orphan cleanup (see README)
  return { ok: true, durationMs: Date.now() - start };
};
