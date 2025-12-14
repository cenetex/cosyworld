/**
 * X Mention Auto Replier
 *
 * Polls the global account's mentions very sparingly and replies using GlobalBotService voice.
 * Designed to respect Free-tier read constraints by:
 * - Low max_results per poll
 * - Persisted since_id
 * - Monthly read budget cap
 */

export function registerXMentionAutoReplier({
  xService,
  schedulingService,
  aiService,
  globalBotService,
  logger,
}) {
  if (!xService) return;

  const enabledFlag = String(process.env.X_MENTION_REPLY_ENABLED || '').trim().toLowerCase();
  const disabled = enabledFlag === '0' || enabledFlag === 'false' || enabledFlag === 'off' || enabledFlag === 'no';
  if (disabled) {
    logger?.info?.('[XMentionAutoReplier] Disabled (X_MENTION_REPLY_ENABLED indicates off)');
    return;
  }

  const intervalMinutes = (() => {
    const raw = Number(process.env.X_MENTION_REPLY_INTERVAL_MINUTES);
    if (!Number.isNaN(raw) && raw > 0) return raw;
    return 5;
  })();

  const intervalMs = Math.max(15, intervalMinutes) * 60 * 1000;

  let inProgress = false;
  const task = async () => {
    if (inProgress) return;
    inProgress = true;
    try {
      await xService.processGlobalMentionsAndReply({ aiService, globalBotService });
    } catch (e) {
      logger?.warn?.('[XMentionAutoReplier] task failed:', e?.message || e);
    } finally {
      inProgress = false;
    }
  };

  if (schedulingService?.addTask) {
    schedulingService.addTask('x-mention-auto-reply', task, intervalMs);
  } else {
    setInterval(task, intervalMs);
  }

  logger?.info?.(`[XMentionAutoReplier] Enabled; interval=${Math.round(intervalMs / 60000)}min`);
}

export default registerXMentionAutoReplier;
