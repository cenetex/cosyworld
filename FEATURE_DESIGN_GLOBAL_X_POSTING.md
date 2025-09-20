# Global X Posting Feature Design

Date: 2025-09-20  
Status: Draft (Engineering Design)  
Author: Generated assistant (subject to review)

## 1. Objective
Provide a centralized, reliable, and controllable system for posting media and narrative updates (images, videos, combat summaries) to a single designated global X (Twitter) account triggered by system events.

## 2. Problem Statement
Currently X posts are triggered ad-hoc from multiple services (avatars, chat, combat tools, video generation). This causes:
- Duplicated logic & inconsistent formatting
- Hard to enforce rate limits & dedupe
- No moderation gating or audit trail
- Limited observability & retry resilience

## 3. Goals & Non-Goals
Goals:
- Unified event ingestion & posting queue
- Rate limiting (per-hour, per-day) + deduplication
- Optional moderation / approval workflow
- Template-driven, configurable messaging
- Retry with backoff & audit logging
- Extensible to future platforms
Non-Goals (initial release):
- Multi-platform federation (e.g., Mastodon)
- AI-based content rewriting or localization
- Advanced analytics beyond core metrics

## 4. Event Taxonomy
Event Types (internal domain events):
- `MEDIA.IMAGE.GENERATED`
- `MEDIA.VIDEO.GENERATED`
- `COMBAT.SUMMARY.GENERATED`

Payload Examples:
```jsonc
// MEDIA.IMAGE.GENERATED
{
  "type": "image",
  "avatarId": "657ab...",
  "imageUrl": "https://cdn/.../img.png",
  "prompt": "Celestial ranger in neon forest",
  "guildId": "123456789012345678",
  "createdAt": "2025-09-20T12:00:00Z"
}

// MEDIA.VIDEO.GENERATED
{
  "type": "video",
  "videoUrl": "https://cdn/.../vid.mp4",
  "title": "Origin cinematic",
  "avatarId": "657ab...", // optional
  "createdAt": "2025-09-20T13:00:00Z"
}

// COMBAT.SUMMARY.GENERATED
{
  "type": "combat",
  "encounterId": "enc_91a2",
  "winner": { "id": "a1", "name": "Nyx" },
  "loser": { "id": "b2", "name": "Helion" },
  "summaryText": "Nyx outmaneuvered Helion in a 7‑round duel...",
  "imageUrl": "https://cdn/.../climax.png",
  "rounds": 7,
  "createdAt": "2025-09-20T14:00:00Z"
}
```

## 5. Architecture Overview
Components:
1. Event Emitter: Lightweight in-process dispatcher (pub/sub dictionary of arrays).
2. GlobalPostService (Orchestrator): Ingests events, performs dedupe, persistence, moderation gating, enqueueing, dispatch to worker.
3. Posting Queue: In-memory priority queue with persistence fallback (Mongo documents store status; queue holds ids).
4. Rate Limiter: Sliding window (hour/day) counters stored in Mongo or Redis (future optimization).
5. Template Engine: Simple placeholder interpolation with validation.
6. X Adapter: Reuses existing `xService` functions (`postImageToX`, `postVideoToX`) plus generic wrapper.
7. Admin API: CRUD/config + moderation & retry endpoints.
8. Admin UI: New page `Global X Posts` for monitoring & control.
9. Audit Logger: Append-only records for config changes & moderation actions.

## 6. Data Model (Mongo)
### 6.1 `x_post_events`
| Field | Type | Notes |
|-------|------|-------|
| _id | ObjectId | Primary key |
| eventType | String | `image|video|combat` |
| status | String | `pending|approved|posted|failed|skipped|rejected|expired` |
| mediaType | String | `image|video|none` (combat may have image) |
| mediaUrl | String | CDN URL (optional for some combat events) |
| avatarIds | [String] | One or many (combat) |
| encounterId | String | For combat events |
| templateKey | String | Name of template chosen |
| resolvedContent | String | Final tweet text |
| hash | String | sha256(mediaUrl || canonicalPayload) for dedupe |
| attempts | Number | Retry count |
| nextAttemptAt | Date | Scheduled retry time |
| lastError | String | Last failure message |
| tweetId | String | Returned X id |
| tweetUrl | String | Constructed URL |
| meta | Object | { prompt, summaryText, rounds, title } |
| createdAt | Date | Insert time |
| updatedAt | Date | Updated every state change |
| postedAt | Date | Set when status=posted |
| rejectedReason | String | Optional moderator note |

Indexes:
- Unique partial: `{ eventType:1, hash:1 }` (partialFilter: status != 'failed')
- TTL (optional): Clean old docs after 90 days (archival strategy future)
- Compound for queries: `{ status:1, createdAt:-1 }`

### 6.2 `x_post_config`
Single doc (or keyed by environment):
```jsonc
{
  "_id": "global",
  "enabled": true,
  "enableImages": true,
  "enableVideos": true,
  "enableCombat": true,
  "moderation": { "enabled": false },
  "rate": { "perHour": 8, "perDay": 30 },
  "templates": {
    "image": "{avatar_name}: {prompt}",
    "video": "New video drop: {title}",
    "combat": "{winner_name} defeated {loser_name} in {rounds} rounds!"
  },
  "updatedAt": "..."
}
```

### 6.3 `admin_audit_log` (Extended)
Add action types: `x_post_config_update`, `x_post_event_approve`, `x_post_event_reject`, `x_post_event_retry`.

## 7. Templates
Allowed placeholders per type:
- Image: `{avatar_name}`, `{prompt}`, `{short_hash}`
- Video: `{title}`, `{avatar_name?}`
- Combat: `{winner_name}`, `{loser_name}`, `{rounds}`, `{summary}`
Validation:
- Reject unknown tokens.
- Enforce max length (<= 260 chars pre-safety margin). Truncate gracefully with ellipsis.
Function signature:
```js
resolveTemplate(templateString, context) -> { text, truncated }
```

## 8. Workflow
1. Producer emits domain event.
2. `GlobalPostService.ingest(event)`:
   - Load config; if disabled for that event type -> `status=skipped` (reason stored in `lastError`).
   - Compute hash; attempt insert (unique index ensures dedupe). If duplicate, mark skipped.
   - If moderation enabled -> `pending`; else -> `approved` & enqueue.
3. Scheduler loop (every 30s):
   - Dequeue approved events whose `nextAttemptAt <= now`.
   - Check rate counters: if exceeded, requeue (defer 10m) until window free.
   - Resolve template context; call X posting adapter.
   - On success: update status=posted, store ids, metrics.
   - On transient failure: increment attempts, set backoff (1m, 5m, 30m, 2h, 6h). After 5 attempts -> failed.
4. Moderation actions move `pending` -> `approved` (enqueue) or `rejected`.
5. Retry endpoint resets `status=approved`, `attempts--` (min 0), `nextAttemptAt=now`.

## 9. Rate Limiting
Initial Implementation: Mongo counter doc with arrays of timestamps pruned; acceptable volume expected low.
Document: `_id:'global_rate' { hour: [ISOStrings], day: [ISOStrings] }` (prune >1h & >24h).
Future: Move to Redis sorted sets for O(log n) trimming.

## 10. API Design
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/x-posts/config` | Fetch config |
| PUT | `/api/admin/x-posts/config` | Update config (audit) |
| GET | `/api/admin/x-posts` | List events (filter by status, type, limit, cursor) |
| POST | `/api/admin/x-posts/:id/approve` | Approve pending |
| POST | `/api/admin/x-posts/:id/reject` | Reject with reason |
| POST | `/api/admin/x-posts/:id/retry` | Retry failed/skipped |
| POST | `/api/admin/x-posts/preview` | Preview template with sample context |
| GET | `/api/admin/x-posts/stats` | Aggregated metrics |

Payload Examples:
```http
PUT /api/admin/x-posts/config
{
  "enableImages": true,
  "rate": { "perHour": 6, "perDay": 25 },
  "templates": { "image": "{avatar_name} emerges: {prompt}" }
}
```

## 11. Admin UI
New page: `admin/x-global-posts.html` or integrated tab on dashboard.
Sections:
- Config panel (toggles, rates, templates with live preview).
- Moderation queue (pending events) with approve/reject.
- Recent Activity (posted/failed timeline).
- Metrics summary (counts, success %, queue depth).
- Retry actions.

## 12. Integration Changes
Refactor existing direct calls:
- Replace `xService.postImageToX(admin, url, content)` in scattered services with `emitDomainEvent('MEDIA.IMAGE.GENERATED', {...})`.
- Preserve avatar-personal posting (if an avatar itself is X-authorized) separately; global posting is additive (configurable future toggle to suppress duplicates).

## 13. Configuration & Env Vars
| Variable | Purpose | Default |
|----------|---------|---------|
| `GLOBAL_X_POSTING_ENABLED` | Master enable | true |
| `GLOBAL_X_POSTING_RATE_PER_HOUR` | Hour cap | 8 |
| `GLOBAL_X_POSTING_RATE_PER_DAY` | Day cap | 30 |
| `GLOBAL_X_MODERATION_ENABLED` | Pending queue gating | false |
| `GLOBAL_X_ACCOUNT_AVATAR_ID` | Source avatar identity for posting | (required) |

`configService` extension: Add `globalPosting` section read from env + config doc fallback.

## 14. Failure Handling & Retry
Backoff schedule: `[60s, 300s, 1800s, 7200s, 21600s]`.
Permanent Fail Criteria:
- HTTP 4xx (except 429) from X API.
- Auth errors after single refresh attempt.
- Media fetch 404 repeated twice.

## 15. Observability / Metrics
Counters:
- `x_post_events_ingested_total{eventType}`
- `x_post_events_posted_total{eventType}`
- `x_post_events_failed_total{eventType,reason}`
Gauges:
- `x_post_queue_depth`
- `x_post_pending_moderation`
Histogram:
- `x_post_latency_seconds` (ingest -> posted)

Expose via existing metrics endpoint (future) or admin stats route.

## 16. Security Considerations
- Enforce CSRF tokens & role checks (RBAC future) on new endpoints.
- Audit every config change & moderation decision with diff delta.
- Sanitize `prompt` & `summaryText` → strip @mentions, limit ASCII control chars.
- Template validation to prevent accidental variable injection.
- Hard cap tweet length: reserve 10 chars safety margin.

## 17. Edge Cases
| Case | Handling |
|------|----------|
| Duplicate media same hour | Skipped (hash dedupe) |
| Rate limit exceeded | Defer; attempt later |
| Moderation backlog large | Paging + metric alert |
| X token revoked | Fail events until manual re-link; surface alert banner |
| Queue on process restart | Reload `approved` & `pending` needing processing (status scan) |

## 18. Migration & Backfill
Optional script to backfill last 7 days of media/combat into `x_post_events` as `posted` for baseline metrics (exclude duplicates by hash).

## 19. Implementation Plan (Phased)
Phase 0: Schema + collections + config loader changes (shadow mode: ingest only).  
Phase 1: Queue + rate limiter + posting worker (disabled posting flag).  
Phase 2: Enable real posting for images; add metrics.  
Phase 3: Add combat + video ingestion; moderation toggle & UI.  
Phase 4: Replace scattered direct calls; deprecate legacy paths.  
Phase 5: Hardening (retry policies, RBAC integration, external queue exploration).  

## 20. Testing Strategy
Unit:
- Template resolution & placeholder validation
- Rate limiter edge windows
- Dedupe insertion (unique index conflict)
Integration:
- Event ingestion → posted success path
- Moderation approve/reject flows
- Retry after transient simulated failures
Load:
- Simulate burst (50 events) ensure compliance with limits & deferred states
Security:
- CSRF token requirement, role gating
- Attempt template injection / placeholder misuse

## 21. Open Questions
- Should combat events without generated media still post (text-only)? Proposed: allow (mediaUrl optional).
- Should we integrate content safety (NSFW detection) pre-post? (Future P2/P3).
- Multi-language template strategy (not in initial scope).

## 22. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Memory queue loss on crash | Rebuild from Mongo statuses at startup |
| Posting backlog during downtime | Startup sweep processes overdue `approved` |
| API rate changes from X | Configurable dynamic rate limits & backoff |
| Large prompt content overflow | Truncation + ellipsis + audit flag |

## 23. Minimal Pseudocode (Key Parts)
```js
// postEventEmitter.mjs
const listeners = new Map();
export function on(evt, fn){ (listeners.get(evt) || listeners.set(evt, []).get(evt)).push(fn); }
export function emit(evt, payload){ (listeners.get(evt) || []).forEach(fn => fn(payload)); }

// globalPostService.mjs
class GlobalPostService {
  constructor({ db, xService, logger, config }) { /* setup */ }
  async ingest(raw) { /* normalize, hash, insert, moderation gating */ }
  async tick() { /* dequeue, rate check, post, update */ }
}
```

## 24. Future Extensions
- External message broker (Kafka/NATS) for horizontal worker scaling.
- Cross-post adapters (e.g., Bluesky, Threads) behind polymorphic interface.
- ML summarizer to condense long combat narratives into tweet-sized updates.

## 25. Acceptance Criteria (Initial Release)
- Shadow Mode: All three event types ingested; zero runtime errors; metrics exposed.
- Active Mode: Images posted with <2% failure (excluding deliberate rejects); rate caps enforced; audit logs present.
- Moderation Enabled: Approve/Reject transitions reflected within <2s, queue depth accurate.

---
End of design. See `ENGINEERING_REPORT_ADMIN_PANEL.md` for broader platform recommendations.
