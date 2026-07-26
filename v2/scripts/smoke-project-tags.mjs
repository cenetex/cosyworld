export function spentPreparationTagBelongsToJob(tag, job) {
  if (
    tag?.label !== "spent preparation"
    || tag?.expires !== "when_job_resolves"
    || !job?.progress_clock_id
    || !Array.isArray(job.location_ids)
  ) {
    return false;
  }
  const match = /^actor:\d+:prepared_spent:(\d+):(.+)$/.exec(String(tag.id || ""));
  if (!match || match[2] !== String(job.progress_clock_id)) return false;
  const locationId = Number(match[1]);
  return job.location_ids.some((candidate) => Number(candidate) === locationId);
}
