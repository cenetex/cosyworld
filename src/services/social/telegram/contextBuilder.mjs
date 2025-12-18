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
 * @param {boolean} params.isMention - Whether the bot was mentioned (just affects response timing)
 * @param {string} params.triggerType - What triggered this response ('mention', 'reply', 'active_participant', 'gap')
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
  triggerType = 'general',
  rag = []
}) {
  // 1. Build Conversation History with Message IDs
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
  
  // Format conversation with message IDs so the bot can reference specific messages
  let conversationContext = selectedHistory.length > 0
    ? selectedHistory.map(m => {
        const msgId = m.messageId ? `[msg:${m.messageId}]` : '';
        return `${msgId}${m.from}: ${m.text}`;
      }).join('\\n')
    : `${currentMessage.from.first_name || currentMessage.from.username || 'User'}: ${currentMessage.text}`;

  if (currentMessage.reply_to_message) {
    const reply = currentMessage.reply_to_message;
    const replyFrom = reply.from?.first_name || reply.from?.username || 'User';
    let replyContent = reply.text || (reply.caption ? `[Media] ${reply.caption}` : '[Media]');
    const replyMsgId = reply.message_id ? `[msg:${reply.message_id}]` : '';
    conversationContext += `\\n(User is replying to ${replyMsgId}${replyFrom}: "${replyContent}")`;
  }

  // Include available message IDs for react/reply actions (including bot's own messages)
  const recentMessageIds = selectedHistory
    .filter(m => m.messageId)
    .slice(-10) // Last 10 messages for more context
    .map(m => ({ id: m.messageId, from: m.from, preview: (m.text || '').slice(0, 50), isBot: m.isBot }));

  // Format recent message IDs for the system prompt
  const messageIdContext = recentMessageIds.length > 0
    ? `\\nRecent messages you can interact with:\\n${recentMessageIds.map(m => `  - [msg:${m.id}] ${m.from}${m.isBot ? ' (you)' : ''}: "${m.preview}${m.preview.length >= 50 ? '...' : ''}"`).join('\\n')}`
    : '';

  // 2. Build System Prompt
  let botPersonality = 'You are the CosyWorld narrator bot.';
  let botDynamicPrompt = '';
  if (persona?.bot) {
    botPersonality = persona.bot.personality || botPersonality;
    botDynamicPrompt = persona.bot.dynamicPrompt || '';
  }

  const toolCreditContext = `
Tool Credits (global): ${buildCreditInfo(credits.image, 'Images')} | ${buildCreditInfo(credits.video, 'Videos')} | ${buildCreditInfo(credits.tweet, 'X posts')}
Rule: Only call media generation tools if credits available. If 0, explain naturally and mention reset time.`;

  const buybotContextStr = buybot ? `\\nToken Tracking (Buybot):\\n${buybot}\\n` : '';

  const ragContextStr = rag.length > 0 
    ? `\\nRelevant Knowledge:\\n${rag.map(r => `- ${r.content} (Source: ${r.source})`).join('\\n')}\\n`
    : '';

  // Trigger context - note that all triggers use the same toolset
  const triggerContext = isMention 
    ? 'You were directly mentioned - the user wants your attention. Be responsive and engaging!'
    : triggerType === 'reply' 
      ? 'A user replied to your message - they want to continue chatting with you.'
      : triggerType === 'private'
        ? 'This is a private chat - be more personal and attentive.'
        : 'General channel activity - join naturally if you have something fun or helpful to add.';

  // Personality guidance for more natural/fun interactions
  const personalityGuidance = `
PERSONALITY & STYLE:
- Be genuinely curious and playful - ask follow-up questions when interested
- React with appropriate emojis to show you're engaged (don't overdo it - pick moments)
- Keep responses concise unless elaboration is truly needed
- Match the energy of the conversation - casual chat gets casual responses
- It's OK to be witty, make jokes, or use wordplay when appropriate
- If someone shares something cool, show genuine enthusiasm
- Don't be afraid to have opinions or preferences (in character)
- Use reactions (react_to_message) to acknowledge without always needing words`;

  const systemPrompt = `${botPersonality}
${botDynamicPrompt}
${personalityGuidance}

CHANNEL INTERACTION:
${triggerContext}
You have the same tools available regardless of how you were triggered.

ACTION PLANNING (plan_actions):
Use plan_actions to interact with the channel. Structure your plan with steps:
- "speak": Send a message. Use "message" for the text. Use "targetMessageId" to reply to a specific message.
- "react_to_message": React with emoji. Use "emoji" for the reaction (🐀❤️🔥👍😂🎉👀🤔😎), "targetMessageId" for which message.
- "wait": Choose not to respond (valid when conversation doesn't need you).
- "generate_image/generate_video": Create media content.
- "post_tweet": Share to X/Twitter.

Response patterns:
- Quick acknowledgment → just react_to_message (no speak needed)
- Questions to you → speak with targetMessageId to reply directly
- Something exciting → react first, then speak
- Between others → wait (or react silently if genuinely amused/interested)
${toolCreditContext}${buybotContextStr}
${ragContextStr}
${plan.summary}
${media.summary}${messageIdContext}

CRITICAL INSTRUCTIONS:
1. When posting to X, use recent media ID. Don't post old images.
2. DO NOT mention internal media IDs (like "A1B2C3D4") in your messages. They are for tool use only.
3. Use standard Markdown for formatting. DO NOT use HTML tags or entities.
4. Message IDs [msg:123] are for targeting specific messages. Pass the numeric ID to targetMessageId in your plan steps.
5. Use reactions liberally to stay engaged without being verbose.`;

  const userPrompt = `Recent conversation:\\n${conversationContext}\\n\\nRespond naturally. Use reactions when a quick acknowledgment fits better than words.`;

  return { systemPrompt, userPrompt, conversationContext, recentMessageIds };
}
