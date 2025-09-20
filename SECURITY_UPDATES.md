# Security & Architecture Updates (P0)

Date: 2025-09-20
Scope: Immediate hardening & architectural decoupling tasks implemented on branch `feature/global-x`.

## Implemented

1. CSRF Protection
   - Added `/api/admin/csrf-token` endpoint.
   - All mutating `/api/admin` routes now require `x-csrf-token` header.
2. Audit Logging (initial)
   - Introduced `AuditLogService` writing to `admin_audit_log` collection.
   - Logged X auth initiation actions (`xauth.request`, `xauth.admin.request`).
3. Central Event Dispatcher
   - Added singleton `eventBus` (`eventBus.emit(event, payload)`).
   - Avatar creation now emits `MEDIA.IMAGE.GENERATED` for downstream global posting pipeline.
4. Nonce / Replay Protection
   - Added `/api/xauth/nonce` endpoint issuing single-use nonces.
   - Wallet signed message for `/api/xauth/auth-url` must include unused `nonce` (JSON message body) consumed atomically.
5. Per-Route Admin Write Rate Limiting
   - In-memory token bucket (30 writes/min default) keyed by method + normalized path.
6. Misc
   - Added CSRF + rate limit middleware ordering before `requireSignedWrite`.
   - Added documentation file (this file) summarizing changes.

## Headers / Client Requirements
Clients performing admin writes must now send:
```
x-csrf-token: <value from /api/admin/csrf-token>
x-wallet-address: <wallet>
x-message: <signed JSON containing {"nonce":...,"ts":...}>
x-signature: <signature>
```

## Follow-Up (Not Yet Implemented)
- Extend audit coverage (config changes, collection mutations, moderation actions).
- Persist nonce store to shared cache if clustering.
- Expose metrics around rate limiter and CSRF validation failures.
- Add RBAC roles and granular permission checks.

## Notes
The event bus introduces a stable integration point for forthcoming global posting pipeline; no external consumers yet aside from placeholder.
