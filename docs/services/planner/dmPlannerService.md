# DMPlannerService API (Draft)

Service to orchestrate NPC avatars across threads with round-based planning.

## Responsibilities
- Rank threads and assign actions to avatars based on global context
- Maintain fairness (initiative/combat), relevance (mentions/subscriptions), and rate limits
- Enqueue actionable tasks to be executed by existing systems

## Interfaces

```ts
export interface PlannerOptions {
  platform?: 'discord' | 'oneirocom' | string;
  now?: Date;
  budget?: { maxAssignments: number; perThreadLimit?: number };
}

export interface Assignment {
  id: string;
  createdAt: Date;
  dueAt?: Date;
  priority: number; // 0..100
  platform: string;
  threadId: string;
  action: 'respond' | 'useTool' | 'createThread' | 'moveToThread' | 'followThread' | 'addSticky' | string;
  payload?: Record<string, any>;
  assignees: string[]; // avatarIds
  status: 'queued' | 'in-progress' | 'done' | 'skipped' | 'failed';
  provenance?: { reason?: string; evidence?: string[]; plannerVersion?: string };
}
```

### Methods

- `async planRound(options: PlannerOptions): Promise<Assignment[]>`
  - Collects thread states, ranks, selects candidate avatars, and emits queued assignments.

- `async getPolicies(): Promise<Record<string, any>>`
  - Returns tunable thresholds and routing rules (e.g., per-thread throttle, stickies surfaced in prompts).

## Execution Flow
1. Fetch ThreadState list from `ThreadStateService.listThreads({ platform })`.
2. For each thread, ensure summary freshness (`summarizeThread` if stale/dirty).
3. Rank by activity, mentions, subscriptions, combat flags, and time since last avatar response.
4. Generate assignments with bounded budget; enqueue via `AssignmentQueueService`.

## Integration Notes
- Use `avatarService.findMentionedAvatarsInGuild` to detect mentions.
- Use `locationService` to convert channel/thread IDs into location metadata.
- Use `WebSearchTool` (via ToolService) for external research context.
- Execution of assignments bridges to `ConversationManager`, `ToolService`, and `DiscordService`.

## Observability
- Emit planner logs per round: selected threads, skipped reasons, assignment counts.
- Store planner version in assignment provenance for audit.
