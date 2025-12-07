/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { buildCreditInfo, estimateTokens } from './utils.mjs';

/**
 * Builds the conversation context for the AI model
 * @param {Object} params
 * @param {Array} params.history - Conversation history
 * @param {Object} params.currentMessage - The current incoming message
 * @param {Object} params.persona - Bot persona configuration
 * @param {Object} params.credits - User credit limits
 * @param {Object} params.plan - Current plan context
 * @param {Object} params.media - Recent media context
 * @param {Object} params.buybot - Buybot context
 * @param {boolean} params.isMention - Whether the bot was mentioned
 * @returns {Object} { systemPrompt, userPrompt }
 */
export function buildConversationContext({
  history,
  currentMessage,
  persona,
  credits,
  plan,
  media,
  buybot,
  isMention,
  rag = []
}) {
  // 1. Build Conversation History
  // Use token budget instead of fixed count
  const MAX_HISTORY_TOKENS = 3000; // Reserve space for history
  let currentTokens = 0;
  const selectedHistory = [];
  
  // Iterate backwards to get most recent messages fitting in token budget
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgContent = `${msg.from}: ${msg.text}`;
    const tokens = estimateTokens(msgContent);
    
    if (currentTokens + tokens > MAX_HISTORY_TOKENS) {
      break;
    }
    
    selectedHistory.unshift(msg); // Add to front to maintain chronological order
    currentTokens += tokens;
  }
  
  let conversationContext = selectedHistory.length > 0
    ? selectedHistory.map(m => `${m.from}: ${m.text}`).join('\n')
    : `${currentMessage.from.first_name || currentMessage.from.username || 'User'}: ${currentMessage.text}`;

  if (currentMessage.reply_to_message) {
    const reply = currentMessage.reply_to_message;
    const replyFrom = reply.from?.first_name || reply.from?.username || 'User';
    let replyContent = reply.text || (reply.caption ? `[Media] ${reply.caption}` : '[Media]');
    conversationContext += `\n(User is replying to ${replyFrom}: "${replyContent}")`;
  }

  // 2. Build System Prompt
  let botPersonality = 'You are the CosyWorld narrator bot.';
  let botDynamicPrompt = '';
  if (persona?.bot) {
    botPersonality = persona.bot.personality || botPersonality;
    botDynamicPrompt = persona.bot.dynamicPrompt || '';
  }

  const toolCreditContext = `
Tool Credits (global): ${buildCreditInfo(credits.image, 'Images')} | ${buildCreditInfo(credits.video, 'Videos')} | ${buildCreditInfo(credits.tweet, 'X posts')}
Rule: Only call tools if credits available. If 0, explain naturally and mention reset time.`;

  const buybotContextStr = buybot ? `\nToken Tracking (Buybot):\n${buybot}\n` : '';

  const ragContextStr = rag.length > 0 
    ? `\nRelevant Knowledge:\n${rag.map(r => `- ${r.content} (Source: ${r.source})`).join('\n')}\n`
    : '';

  const systemPrompt = `${botPersonality}
${botDynamicPrompt}
Conversation mode: ${isMention ? 'Direct mention' : 'General chat'}
${toolCreditContext}${buybotContextStr}
${ragContextStr}
${plan.summary}
${media.summary}
CRITICAL INSTRUCTIONS:
1. When posting to X, use recent media ID. Don't post old images.
2. DO NOT mention internal media IDs (like "A1B2C3D4") in your chat responses. They are for your internal tool use only.
3. Use standard Markdown for formatting (e.g., **bold**, *italic*). DO NOT use HTML tags (like <b>, <i>) or HTML entities (like &quot;). Write naturally.`;

  const userPrompt = `Recent conversation:\n${conversationContext}\nRespond naturally.`;

  return { systemPrompt, userPrompt, conversationContext };
}
