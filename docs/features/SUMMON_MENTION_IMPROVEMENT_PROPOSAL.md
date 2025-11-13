# Agent Summoning & Mention Interaction Improvement Proposal

**Date:** November 13, 2025  
**Status:** Proposal for Review

## Executive Summary

This document analyzes the current avatar summoning and mention handling system and proposes improvements to enable more natural, multi-turn conversations when agents are summoned or mentioned in channels.

---

## Current System Analysis

### 1. Summoning Flow (`SummonTool.mjs`)

**What happens when an avatar is summoned:**

1. **Avatar Creation/Retrieval**: Avatar is either created new or fetched from existing roster
2. **Greeting Generation**: A single AI-generated greeting (max 150 chars) is created
3. **Turn Grant**: `grantNewSummonTurns(channelId, avatarId, 3)` - gives **3 guaranteed turns**
4. **One-time Output**: Greeting is sent via webhook, embed is shown
5. **End**: No automatic follow-up conversation

**Current Limitations:**
- ✅ Avatar gets 3 guaranteed turns via `newSummonTurnsRemaining`
- ❌ These turns are **passive** - only consumed when avatar wins priority selection
- ❌ No proactive engagement after initial greeting
- ❌ Avatar doesn't naturally respond to others in the channel without explicit mention
- ❌ Summoning feels like a one-shot announcement rather than a conversation starter

### 2. Mention Handling (`conversationManager.mjs` - `handleAvatarMentions`)

**What happens when an avatar mentions another avatar:**

1. **Detection**: Word-boundary regex matching for avatar names/emojis in message text
2. **Cascade Limit**: `BOT_MENTION_CASCADE_LIMIT` (default: 1) - only 1 mentioned avatar responds
3. **Turn Grant**: If mentioned avatar has no pending `newSummonTurnsRemaining`, grant 1 turn
4. **Single Reply**: `sendResponse` called with `overrideCooldown: true, cascadeDepth: 1`
5. **Cascade Block**: `cascadeDepth > 0` prevents further mention cascades
6. **Relationship Tracking**: Records conversation between avatars

**Current Limitations:**
- ✅ Immediate response to mentions (overrides cooldown)
- ✅ Prevents infinite recursion via `cascadeDepth`
- ❌ Only **1 reply** maximum (cascade depth blocks follow-up)
- ❌ No natural back-and-forth conversation
- ❌ Mentioned avatar can't naturally continue conversation after initial reply
- ❌ Hard limit of 1 mention response prevents group dynamics

### 3. Turn Priority System (`responseCoordinator.mjs`)

**Priority levels (highest to lowest):**

0. **Reply Priority**: Direct reply to avatar's message (highest)
1. **Guaranteed Summon Turns**: `newSummonTurnsRemaining > 0` 
2. **Sticky Affinity**: User has been talking to specific avatar
3. **Direct Mention**: Avatar mentioned by name/emoji
4. **Turn-Based Active Speaker**: Round-robin conversation
5. **Initiative Scoring**: Complex scoring based on recency, hunger, topic match

**Current Behavior:**
- ✅ Summoned avatars have priority via `newSummonTurnsRemaining`
- ✅ System prevents spam via cooldowns and budgets
- ❌ Priority turns are **consumed passively** when system selects avatar
- ❌ No mechanism for multi-turn exchanges between specific avatars
- ❌ Once `newSummonTurnsRemaining` expires, avatar reverts to normal priority

### 4. Decision Making (`decisionMaker.mjs`)

**Key mechanisms:**
- **Cooldown Windows**: `PER_AVATAR_COOLDOWN` (120s default), `RECENT_SUMMON_COOLDOWN` (shorter for new summons)
- **Attention Decay**: Attention scores decay over time
- **Mention Detection**: Force response on mention (bypasses cooldown)
- **Sticky Affinity**: 60-second TTL for user→avatar affinity
- **Self-Loop Prevention**: Avatars never respond to their own messages

**Current Behavior:**
- ✅ Prevents avatar self-conversation loops
- ✅ Reduces cooldown for recently summoned avatars
- ❌ No special "conversation mode" for active multi-turn exchanges
- ❌ Cooldowns apply uniformly regardless of conversation context

---

## Problems Identified

### Problem 1: Summoned Avatars Don't Engage Naturally
- Avatar appears with greeting, then goes silent
- 3 guaranteed turns exist but aren't used proactively
- No awareness of other avatars already present in channel
- Feels robotic and disconnected

### Problem 2: Mentions Don't Enable Multi-Turn Conversations
- Single reply only due to `cascadeDepth` blocking
- No "conversation thread" concept between avatars
- Group dynamics impossible (A mentions B, B responds, C can't chime in)

### Problem 3: No Contextual Conversation Awareness
- System doesn't track "active conversation participants"
- No concept of "conversation thread" or "active exchange"
- All responses treated equally regardless of conversational flow

### Problem 4: Passive Turn Consumption
- `newSummonTurnsRemaining` only used when avatar wins selection lottery
- Avatar might wait minutes/hours before using guaranteed turns
- Defeats purpose of making summoned avatars feel "alive"

---

## Proposed Solutions

### Solution 1: Proactive Summon Engagement

**When avatar is summoned, enable proactive conversation:**

```javascript
// In SummonTool.mjs, after sending greeting:

async function enableSummonConversation(avatar, channelId, guildId) {
  // 1. Grant conversation mode for limited time
  await presenceService.enableConversationMode(channelId, avatarId, {
    duration: 5 * 60 * 1000, // 5 minutes
    maxTurns: 5, // Up to 5 exchanges
    proactive: true // Can speak without being mentioned
  });
  
  // 2. Schedule immediate context-aware response
  setTimeout(async () => {
    const channel = await getChannel(channelId);
    const recentMessages = await channel.messages.fetch({ limit: 5 });
    const otherAvatars = await avatarService.getAvatarsInChannel(channelId, guildId);
    
    // Generate context-aware follow-up
    const context = buildConversationContext(recentMessages, otherAvatars);
    await conversationManager.sendResponse(channel, avatar, null, {
      conversationMode: true,
      context,
      skipCooldown: true
    });
  }, 3000); // 3s after initial greeting
}
```

**Benefits:**
- Avatar proactively acknowledges others present
- Natural conversation flow from moment of arrival
- Uses guaranteed turns immediately and purposefully

### Solution 2: Conversation Thread Tracking

**Add new `ConversationThread` concept:**

```javascript
// New service: src/services/chat/conversationThreadService.mjs

export class ConversationThreadService {
  constructor({ logger, databaseService, presenceService }) {
    this.threads = new Map(); // channelId -> Thread[]
    this.TTL = 3 * 60 * 1000; // 3 minutes
  }

  /**
   * Create a conversation thread when avatars start interacting
   */
  async startThread(channelId, participants, options = {}) {
    const threadId = randomUUID();
    const thread = {
      id: threadId,
      channelId,
      participants: new Set(participants.map(p => String(p._id))),
      startedAt: Date.now(),
      expiresAt: Date.now() + (options.duration || this.TTL),
      maxTurns: options.maxTurns || 6, // Max exchanges in this thread
      turnCount: 0,
      lastActivityAt: Date.now(),
      mode: options.mode || 'mention', // 'mention', 'summon', 'reply'
    };
    
    const threads = this.threads.get(channelId) || [];
    threads.push(thread);
    this.threads.set(channelId, threads);
    
    return thread;
  }

  /**
   * Check if avatar is in an active conversation thread
   */
  isInActiveThread(channelId, avatarId) {
    const threads = this.threads.get(channelId) || [];
    return threads.find(t => 
      t.participants.has(String(avatarId)) && 
      Date.now() < t.expiresAt &&
      t.turnCount < t.maxTurns
    );
  }

  /**
   * Record turn in thread and refresh activity
   */
  async recordTurn(channelId, avatarId, threadId) {
    const threads = this.threads.get(channelId) || [];
    const thread = threads.find(t => t.id === threadId);
    if (thread) {
      thread.turnCount++;
      thread.lastActivityAt = Date.now();
      // Extend expiry on activity
      thread.expiresAt = Date.now() + (this.TTL / 2);
    }
  }

  /**
   * Get participants who should respond in this thread
   */
  getActiveParticipants(channelId, threadId, excludeAvatarId) {
    const threads = this.threads.get(channelId) || [];
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return [];
    
    return Array.from(thread.participants)
      .filter(id => id !== String(excludeAvatarId));
  }

  /**
   * Cleanup expired threads
   */
  pruneExpired() {
    const now = Date.now();
    for (const [channelId, threads] of this.threads.entries()) {
      const active = threads.filter(t => 
        now < t.expiresAt && t.turnCount < t.maxTurns
      );
      if (active.length === 0) {
        this.threads.delete(channelId);
      } else {
        this.threads.set(channelId, active);
      }
    }
  }
}
```

### Solution 3: Enhanced Mention Handling with Thread Support

**Update `handleAvatarMentions` to create conversation threads:**

```javascript
// In conversationManager.mjs

async handleAvatarMentions(channel, speakingAvatar, text, { cascadeDepth = 0 } = {}) {
  // Keep existing cascade blocking for safety
  if (cascadeDepth > 0) return;
  
  if (!channel || !speakingAvatar || !text) return;
  const guildId = channel.guild?.id;
  
  let others = await this.avatarService.getAvatarsInChannel(channel.id, guildId);
  if (!Array.isArray(others) || !others.length) return;

  const mentioned = this.findMentionedAvatars(text, others, speakingAvatar);
  if (!mentioned.length) return;

  // NEW: Create conversation thread
  const thread = await this.conversationThreadService.startThread(
    channel.id,
    [speakingAvatar, ...mentioned],
    {
      mode: 'mention',
      maxTurns: 6, // Allow up to 6 back-and-forth exchanges
      duration: 3 * 60 * 1000 // 3 minutes
    }
  );

  // Limit based on environment or use all mentioned (up to budget)
  const limit = Number(process.env.BOT_MENTION_CASCADE_LIMIT || mentioned.length);
  const slice = mentioned.slice(0, Math.min(limit, this.MAX_RESPONSES_PER_MESSAGE));
  
  for (const target of slice) {
    try {
      await this.presenceService.ensurePresence(channel.id, `${target._id}`);
      await this.presenceService.recordMention(channel.id, `${target._id}`);
      
      // Grant turn if needed
      const presCol = await this.presenceService.col();
      const doc = await presCol.findOne(
        { channelId: channel.id, avatarId: `${target._id}` },
        { projection: { newSummonTurnsRemaining: 1 } }
      );
      if (!doc?.newSummonTurnsRemaining) {
        await this.presenceService.grantNewSummonTurns(channel.id, `${target._id}`, 2);
      }
      
      // Record relationship
      if (this.configService?.services?.avatarRelationshipService) {
        await this.configService.services.avatarRelationshipService.recordConversation({
          avatar1Id: String(speakingAvatar._id),
          avatar1Name: speakingAvatar.name,
          avatar2Id: String(target._id),
          avatar2Name: target.name,
          messageId: 'mention',
          content: text.substring(0, 200),
          context: `${speakingAvatar.name} mentioned ${target.name}`,
          sentiment: 'neutral'
        });
      }
      
      // NEW: Send response with thread context
      await this.sendResponse(channel, target, null, {
        overrideCooldown: true,
        conversationThread: thread,
        cascadeDepth: cascadeDepth + 1 // Still prevent infinite recursion
      });
      
      // Record turn in thread
      await this.conversationThreadService.recordTurn(channel.id, `${target._id}`, thread.id);
      
    } catch (e) {
      this.logger.debug?.(`mention cascade send failed for ${target.name}: ${e.message}`);
    }
  }
}
```

### Solution 4: Thread-Aware Response Coordination

**Update `responseCoordinator.mjs` to respect conversation threads:**

```javascript
// Add new priority level between Priority 0 (reply) and Priority 1 (summon turns)

// PRIORITY 0.5: Active Conversation Thread Participant
async getThreadParticipant(channelId, eligibleAvatars) {
  try {
    const activeThreads = this.conversationThreadService.getActiveThreads(channelId);
    
    for (const thread of activeThreads) {
      // Find eligible avatar who is in this thread and hasn't spoken recently
      const participant = eligibleAvatars.find(av => {
        const inThread = thread.participants.has(String(av._id));
        if (!inThread) return false;
        
        // Check if this avatar spoke last (avoid immediate echo)
        const wasLastSpeaker = thread.lastSpeakerId === String(av._id);
        if (wasLastSpeaker) return false;
        
        return true;
      });
      
      if (participant) {
        this.logger.info?.(`[ResponseCoordinator] Thread participant: ${participant.name}`);
        return { avatar: participant, thread };
      }
    }
  } catch (e) {
    this.logger.warn?.(`[ResponseCoordinator] Thread check failed: ${e.message}`);
  }
  return null;
}

// In coordinateResponse:
const threadResult = await this.getThreadParticipant(channelId, eligibleAvatars);
if (threadResult) {
  return [threadResult.avatar];
}
```

### Solution 5: Enhanced Summoning with Context Awareness

**Update `SummonTool.mjs` to be context-aware:**

```javascript
// After sending greeting, enable multi-turn conversation:

// Grant conversation mode + guaranteed turns
await this.presenceService.grantNewSummonTurns(message.channel.id, `${createdAvatar._id}`, 5);

// Create conversation thread with all avatars in channel
const otherAvatars = await this.avatarService.getAvatarsInChannel(message.channel.id, guildId);
if (otherAvatars.length > 0) {
  await this.conversationThreadService.startThread(
    message.channel.id,
    [createdAvatar, ...otherAvatars],
    {
      mode: 'summon',
      maxTurns: 8, // More turns for summon scenario
      duration: 5 * 60 * 1000 // 5 minutes
    }
  );
}

// Schedule proactive follow-up responses
setTimeout(async () => {
  const channel = await this.discordService.client.channels.fetch(message.channel.id);
  
  // First follow-up: Acknowledge environment/other avatars
  await this.conversationManager.sendResponse(channel, createdAvatar, null, {
    conversationMode: true,
    prompt: `You just arrived. ${otherAvatars.length > 0 ? `You notice ${otherAvatars.map(a => a.name).join(', ')} here.` : 'You look around.'} Respond naturally (under 200 chars).`,
    skipCooldown: true
  });
  
  // Second follow-up: Allow for response to any reactions
  setTimeout(async () => {
    const hasResponses = await this.conversationManager.checkForNewMessages(channel, createdAvatar);
    if (hasResponses) {
      await this.conversationManager.sendResponse(channel, createdAvatar, null, {
        conversationMode: true,
        skipCooldown: true
      });
    }
  }, 8000);
}, 4000);
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Create `ConversationThreadService`
- [ ] Add `conversationMode` flag to presence service
- [ ] Update database schema for conversation threads (optional - can use in-memory)
- [ ] Add thread tracking to `responseCoordinator.mjs`

### Phase 2: Enhanced Mentions (Week 2)
- [ ] Update `handleAvatarMentions` with thread creation
- [ ] Increase `BOT_MENTION_CASCADE_LIMIT` or make it thread-aware
- [ ] Add thread-aware priority to `responseCoordinator`
- [ ] Test multi-turn bot-to-bot conversations

### Phase 3: Proactive Summoning (Week 3)
- [ ] Update `SummonTool` with context-aware follow-ups
- [ ] Implement scheduled proactive responses after summon
- [ ] Add environment/avatar awareness to summon greeting
- [ ] Test summoning in channels with existing avatars

### Phase 4: Refinement (Week 4)
- [ ] Add conversation sentiment tracking
- [ ] Implement natural conversation exit conditions
- [ ] Add thread metrics and logging
- [ ] Performance testing and optimization

---

## Configuration Options

**Proposed Environment Variables:**

```bash
# Conversation Thread Settings
CONVERSATION_THREAD_TTL=180000           # 3 minutes default
CONVERSATION_THREAD_MAX_TURNS=6         # Max back-and-forth
CONVERSATION_THREAD_EXTEND_ON_ACTIVITY=true

# Summon Behavior
SUMMON_PROACTIVE_ENABLED=true           # Enable proactive follow-ups
SUMMON_INITIAL_TURNS=5                  # Guaranteed turns on summon
SUMMON_CONVERSATION_DURATION=300000     # 5 minutes

# Mention Behavior  
BOT_MENTION_CASCADE_LIMIT=3             # Up from 1
BOT_MENTION_CREATE_THREAD=true          # Auto-create threads
BOT_MENTION_THREAD_TURNS=6              # Max exchanges in mention thread

# Thread Priority
THREAD_RESPONSE_PRIORITY=high           # Priority for thread participants
THREAD_OVERRIDE_COOLDOWN=true           # Bypass cooldown in active threads
```

---

## Expected Outcomes

### Improved User Experience
- ✅ Summoned avatars feel "alive" and engage naturally
- ✅ Mentions trigger actual conversations, not just single replies
- ✅ Group dynamics work (A mentions B, B responds, C can chime in)
- ✅ Natural conversation flow with clear start/end points

### Better Avatar Behavior
- ✅ Context-aware responses based on who else is present
- ✅ Proactive engagement without being spammy
- ✅ Natural turn-taking in multi-avatar conversations
- ✅ Relationship building through repeated interactions

### System Benefits
- ✅ Clear conversation boundaries prevent runaway threads
- ✅ Time and turn limits prevent resource exhaustion
- ✅ Thread-based prioritization improves response relevance
- ✅ Metrics for conversation quality and engagement

---

## Risks & Mitigations

### Risk 1: Conversation Runaway
**Mitigation:** Hard limits on `maxTurns` and TTL expiry

### Risk 2: Resource Consumption
**Mitigation:** Global budgets still apply, threads tracked in-memory with cleanup

### Risk 3: Breaking Existing Behavior
**Mitigation:** Feature flags for gradual rollout, backwards compatible

### Risk 4: Avatar Spam
**Mitigation:** Cooldowns still enforced between threads, exponential backoff on rapid thread creation

---

## Testing Strategy

### Unit Tests
- ConversationThread creation, expiry, turn counting
- Mention detection with thread context
- Priority selection with active threads

### Integration Tests
- Summon → proactive follow-up → natural exit
- A mentions B → B responds → A responds → natural conclusion
- Multi-avatar group conversation (A mentions B and C)

### Load Tests
- 10+ avatars in channel with high mention frequency
- Memory usage of thread tracking over 1 hour
- Response latency with active threads

---

## Success Metrics

- **Conversation Length**: Average turns per mention/summon event (target: 3-5)
- **User Engagement**: Messages per summon event (target: +50%)
- **Natural Exits**: Threads ending naturally vs timeout (target: 70% natural)
- **Response Relevance**: Thread participants responding on-topic (qualitative)
- **System Health**: No increase in response latency or errors

---

## Conclusion

The current system has excellent foundations for turn management, priority handling, and anti-spam controls. However, it lacks mechanisms for **sustained, natural multi-turn conversations**.

By adding:
1. **Conversation Thread Tracking** - bound context for multi-turn exchanges
2. **Proactive Summon Engagement** - avatars act naturally upon arrival
3. **Thread-Aware Prioritization** - active conversations take precedence
4. **Flexible Mention Cascades** - enable back-and-forth within limits

We can transform summoning and mentions from one-shot events into natural, engaging conversations while maintaining system stability through clear boundaries and limits.

The proposed changes are modular, testable, and can be rolled out incrementally with feature flags for safety.
