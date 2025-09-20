# Admin Panel Engineering Assessment

Date: 2025-09-20
Scope: Current admin panel implementation under `/admin` and related backend routes/services.

## 1. Architecture Overview
- Delivery: Static HTML pages (`src/services/web/public/admin/*.html`) served by Express app (`app.js`) behind wallet/session gated middleware.
- Auth Flow: Phantom (wallet) connection -> signature verification -> session cookie (`authToken`, SameSite=Lax, Secure in prod) storing user object with `isAdmin` boolean.
- Frontend Scripts: Page-scoped ES Modules (e.g. `admin-dashboard.js`, `avatar-management.js`, `guild-settings.js`, `entity-management.js`, `x-account-management.js`, `admin-settings.js`, `admin-collections.js`). These make REST calls to `/api/admin/*` & `/api/xauth/admin/*`.
- Services Involved: `configService`, `xService`, avatar, video, battle/combat, collections, tool services.
- Feature Flags (per guild): `breeding`, `combat`, `itemCreation` read via `ConfigService` & guild config docs.
- X Integration: Admin can link an avatar to X; scattered auto-post triggers in avatar creation, chat image posting, combat tools, video job finalization.
- Configuration: `ConfigService` merges env + default JSON + user overrides; simple deep merge, no schema validation.

## 2. Security & Authentication
Strengths:
- Clear gating for `/admin` and `/api/admin/*`.
- Uses HTTPS-only cookies in production.
- Signature verification for wallet-based flows.

Weaknesses / Gaps:
1. No CSRF protection (relying only on SameSite=Lax). 
2. Binary privilege model (`isAdmin`) – lacks granular RBAC (moderator vs system admin).
3. No per-endpoint rate limits for admin writes (global rate limit only).
4. Sparse audit logging (insufficient traceability of destructive actions & X linkage changes).
5. Potential replay attack risk if wallet signatures lack nonces / single-use semantics.
6. Lack of MFA / 2FA for high-impact actions.
7. Insufficient validation & sanitization of admin-supplied template/prompt inputs.
8. X OAuth token lifecycle & refresh resiliency not surfaced to admins (visibility gap).

## 3. UX & Functional Observations
Issues / Opportunities:
- Fragmented static pages; no shared state or client-side router -> inconsistent UX.
- Missing global search & bulk operations (avatars/items/locations).
- Limited analytics (only counters; no trend charts, failure ratios, posting success metrics).
- No realtime updates (relies on manual refresh/polling rather than WebSockets/SSE).
- Lack of moderation workflow for outbound content (auto-post risk).
- Minimal accessibility (ARIA labels, keyboard navigation not evident).
- Error handling inconsistent (raw errors vs silent failures).
- Prompt customization lacks preview/testing sandbox.
- X posting success/failure feedback not surfaced.

## 4. Performance & Maintainability
Findings:
- Scattered cross-cutting concern: X posting logic duplicated across multiple services; no central event bus.
- Guild config caching lacks TTL / invalidation, risking stale data.
- Custom deep merge without schema validation or type safety (plain JS).
- Potential N+1 reads for listing endpoints (needs index & pagination review).
- Build: Webpack config exists; review needed for tree-shaking/code splitting (admin bundles separated?).
- Lack of centralized logging format; hinders correlation & metrics extraction.
- Missing structured typing (TypeScript) leading to drift risk.

## 5. Prioritized Recommendations
### P0 (Immediate: Security / Architecture)
1. CSRF tokens on all mutating admin endpoints.
2. Audit Log: append-only `admin_audit_log` collection for create/update/delete, X OAuth link/unlink, config changes.
3. Central Event Dispatcher for media/combat/video events decoupling posting from feature logic.
4. Add nonce + expiration + single-use enforcement for wallet signature login.
5. Per-route admin write rate limiting (e.g., 30/min burst, token bucket).

### P1 (Short Term)
6. Role-Based Access Control (RBAC) roles: `system_admin`, `content_admin`, `moderator`, `viewer`.
7. Posting Template System with placeholder validation & preview endpoint.
8. Job / Queue status UI (media generation, posting queue, failure retries).
9. Config schema validation (Zod/AJV) applied at load; fail fast.
10. TTL or version-based invalidation for guild config cache.

### P2 (Medium Term)
11. Consolidate admin UI (SPA or microfrontend) with shared state, component library.
12. Bulk operations & search (Elasticsearch or Mongo text indexes + UI filters).
13. Analytics dashboards (time-series metrics, posting success, combat frequency).
14. Accessibility improvements & standardized notification system.
15. Incremental TypeScript adoption for core services.

### P3 (Strategic)
16. External message queue (Redis Streams / NATS / Kafka) for scalable posting & background jobs.
17. Moderation workflow (approve/deny pending media) integrated with ML toxicity checks.
18. Multi-tenant isolation architecture preparation.

## 6. Global X Posting (Summary – Full spec in `FEATURE_DESIGN_GLOBAL_X_POSTING.md`)
Introduce a centralized global posting pipeline with event ingestion, moderation, rate limiting, dedupe, retry logic, and admin controls.

## 7. Risk Matrix (High-Level)
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| CSRF exploitation | Session abuse/data change | Medium | Add CSRF tokens & origin checks |
| Overposting spam | Account suspension | Medium | Central rate limiter & queue |
| Token replay / hijack | Unauthorized admin access | Low-Med | Nonce & expiry enforcement |
| Duplicate code paths for posting | Bugs & drift | High | Central posting service |
| Stale guild config | Incorrect feature gating | Medium | TTL + cache bust endpoint |

## 8. Metrics & Observability (Initial Set)
- `admin_api_requests_total{route,method,status}`
- `x_post_events_total{type,status}`
- `media_generation_duration_seconds` histogram
- `posting_queue_depth` gauge
- `guild_config_cache_hits_total` / `misses_total`

## 9. Suggested Phased Execution (Abbrev.)
Phase 0: Security hardening (CSRF, audit, signature nonce)
Phase 1: Event dispatcher + global posting shadow mode
Phase 2: Admin UI for queue/config + enable posting (images)
Phase 3: Combat/video integration + moderation workflow
Phase 4: Analytics, dashboards, refactor scattered posting calls
Phase 5: Message queue adoption + scalability tuning

## 10. Acceptance Criteria (Initial Milestones)
- P0 complete: All admin writes require CSRF token; audit log entries visible; signature replay blocked.
- Posting shadow mode: Events stored, zero external posts, metrics exposed.
- Enable global posting: <2% failure rate, rate limits enforced, dedupe proven.

## 11. Implementation Notes / Quick Wins
- Reuse existing logger with structured wrapper (`logger.info({ evt:'post_event', ...})`).
- Create utility: `emitDomainEvent(type, payload)` with simple subscriber registry.
- Use Mongo unique compound index on `(eventType, hash)` for dedupe.
- Introduce `config/schema/*.js` with Zod objects & one validation pass.

## 12. Open Questions
- Should avatar-specific X posting and global posting co-exist (dual posts) or prefer one? (Proposed: configurable per event). 
- Retention policy for `x_post_events` (proposal: 90 days + archive job).
- Multi-language template support needed?

## 13. Appendix: File Touch List (Projected)
- New: `src/services/posting/globalPostService.mjs`
- New: `src/services/posting/postEventEmitter.mjs`
- New: `src/services/posting/templates.mjs`
- New: `src/services/web/server/routes/adminXPosts.js`
- Modify: `avatarService.mjs`, `videoJobService.mjs`, combat tools to emit events.
- Modify: `configService.mjs` to load global posting config or delegate to new config doc.

---
For full feature design details see: `FEATURE_DESIGN_GLOBAL_X_POSTING.md`.
