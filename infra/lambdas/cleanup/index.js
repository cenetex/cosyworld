exports.handler = async () => {
  const start = Date.now();
  console.log('cleanup tick');
  return { ok: true, durationMs: Date.now() - start };
};
