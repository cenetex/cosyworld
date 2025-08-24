# DM Planner: Global NPC Orchestration for Threads and Rounds

This document summarizes the current state of mentions/threads and proposes a DM Planner that treats avatars as NPCs, maintains global thread summaries, and assigns actions per round. The goal is to improve tool use and make conversations feel like a coordinated tabletop session across Discord threads (and external forums).

## Current State (Findings)

- Mentions
  - `src/services/avatar/avatarService.mjs` implements `extractMentionedAvatars(content, avatars)` and `findMentionedAvatarsInGuild(content, guildId, limit)` using exact and fuzzy matches (name, emoji).
- Threads as locations
  - `src/services/social/discordService.mjs` listens to `threadCreate` and moves the speaking avatar into the new thread.
  - `docs/services/location/locationService.md` describes mapping Discord channels/threads to in-game locations.
- Persistent context ("sticky" analogue)
  - `src/services/ai/promptAssembler.mjs` uses `memoryService.persistent(...)` as “pins” included in prompts, but there isn’t a dedicated per-thread sticky/DM-notes store.
- Follow/subscribe
  - No explicit per-thread “follow” for avatars in Discord. “Follow” exists only for X via `src/services/social/xService.mjs`.
- Conversation orchestration
  - `docs/services/communication/conversationManager.md` covers message flow but not round-based initiative.
- External threads
  - `src/services/oneirocom/OneirocomForumService.mjs` provides get/create thread for Oneirocom (see `.lore-project89/mcpProject89.md`).

Gaps
- No global view that ranks threads by activity/importance.
- No canonical thread summary store or participant roster.
- No planner that assigns avatar actions per round across threads.
- No per-thread “sticky notes” separate from avatar persistent memory.
- No “follow thread” subscription model for avatars in Discord.

## Proposal: DM Planner Architecture

A new planning layer that:
- Maintains per-thread state (summary, participants, activity) and a global index of active threads.
- Runs a “round” loop that assigns actions to avatars (NPCs) across threads based on priorities and initiative.
- Spawns sub-agents (or tasks) to execute planned actions via existing services (ConversationManager, ToolService, DiscordService, OneirocomForumService).

### Core Data

- ThreadState
  - id: channelId or external threadId
  - platform: "discord" | "oneirocom" | other
  - parentId (for threads), guildId, title/name
  - participants: { users: [ids], avatars: [ids], lastSeenAt }
  - activity: { messagesLast5m, messagesLast1h, lastMessageAt, mentionCount }
  - summary: { lastUpdatedAt, short, detailed, bulletFacts[] }
  - tags: ["combat", "quest", "social", "dm-note:<label>"]
  - stickies: [{ id, text, addedBy, weight, scope: "thread" | "global" }]
  - combat?: { inCombat: bool, round: number, initiative: [ { id, kind: "avatar|user", roll, order } ], startedAt }

- Assignment
  - id, createdAt, dueAt, priority (0..100)
  - threadId, platform
  - action: "respond" | "useTool" | "createThread" | "moveToThread" | "followThread" | "addSticky" | "system:moderate"
  - payload: freeform executor data
  - assignees: [avatarId]
  - status: "queued" | "in-progress" | "done" | "skipped" | "failed"
  - provenance: { reason, evidence: [messageIds], plannerVersion }

- Subscription
  - id, avatarId, threadId, platform, reason, createdAt
  - notifyPolicy: "mentions" | "high-activity" | "quest-related" | "combat-only"

### Services

- ThreadStateService
  - ingestMessage(platform, threadId, message)
  - summarizeThread(threadId)
  - getThreadState(threadId), listThreads(filter)

- DMPlannerService
  - planRound(options):
    1) collect thread states; rank by priority/need
    2) determine candidates per thread (mentions, subscriptions, availability)
    3) if combat: produce initiative and action slots
    4) assign actions and enqueue

- AssignmentQueueService
  - enqueue, claim, complete/fail with backoff

- Executors
  - respond via ConversationManager/PromptService/DiscordService
  - useTool via ToolService
  - createThread/moveToThread via DiscordService/OneirocomForumService
  - followThread/unfollowThread manage Subscription store
  - addSticky updates ThreadState.stickies

- SummarizerService
  - AI summarization with TTL and budget; include stickies

### Planner Round

Trigger: scheduler tick (e.g., every 60–120s) and/or after N messages.
Steps:
1) Refresh thread states needing update
2) Rank threads by activity, mentions, combat/quests, stale replies
3) For top K threads, choose candidates and create Assignments
4) Enqueue; executors realize actions

### Tool Use Policies

- CreateThread when branching, sensitive/private follow-ups, or high contention
- MoveToThread when users create a thread from a message (already partially handled)
- FollowThread when avatar mentioned, quest actor, or combat flagged
- Stickies: DM notes (objectives, rules, clues) per thread; surface in summaries and prompts

## Integration with Current Code

- Mentions: reuse `avatarService.findMentionedAvatarsInGuild`
- Threads/Locations: reuse `discordService` thread events + `locationService`
- Summaries/Pins: reuse `memoryService.persistent` for global pins; add thread-scoped stickies in new store
- External forum: reuse `OneirocomForumService`
- Conversation execution: continue `ConversationManager` + `PromptService`

## Minimal Schemas (MongoDB)

- thread_states: { _id: <platform:threadId>, platform, parentId, guildId, title, participants, activity, summary, tags, stickies, combat, updatedAt }
- planner_assignments: { _id, createdAt, dueAt, priority, threadId, platform, action, payload, assignees, status, provenance }
- thread_subscriptions: { _id, avatarId, threadId, platform, reason, notifyPolicy, createdAt }

## MVP Plan

- Days 1–2: ThreadStateService; summarizer stub with token budget
- Days 3–4: DMPlannerService.planRound with simple ranking, action="respond" for top 5 threads
- Day 5: AssignmentQueueService + basic respond executor
- Day 6: followThread/unfollowThread; auto-follow on mention
- Days 7–8: Thread stickies and show in PromptAssembler
- Day 9: CreateThread policy + align with `threadCreate`
- Days 10–12: Basic combat flags + round counter; simple initiative

## Acceptance Criteria

- Planner creates rate-limited assignments leading to avatar replies in priority threads
- Per-thread summaries persisted and updated at most every N minutes or on spikes
- Avatars auto-follow mentioned threads; planner prioritizes them
- DM stickies appear in thread summaries and avatar prompts

## Risks

- Over-posting: throttles, global caps, priority queues
- Cost: summarizer TTL and batching; heuristic fallback
- Loops: idempotent executors and dedupe keys
- Latency: plan in batches; execute via queue consumers

## Next Steps

- Add `docs/services/planner/*.md` with API signatures as interfaces stabilize
- Optional: admin UI to inspect thread states and assignments
