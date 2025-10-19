# Guild Authorization Security Fixes

## Issue
The bot was processing messages and creating database entries (locations, etc.) in **unauthorized Discord servers** before checking guild authorization status.

## Root Cause
In `messageHandler.mjs`, the authorization check was happening **after** several database operations:
1. ❌ Message saved to database
2. ❌ Image analysis performed
3. ❌ Location potentially created
4. ✅ Authorization check (too late!)

## Fixes Applied

### 1. Message Handler (`src/services/chat/messageHandler.mjs`)
**Changed:** Moved guild authorization check to **first line** of `_handleMessageInner()`

**Before:**
```javascript
async _handleMessageInner(message) {
  // Cache message
  // Save message to database ❌
  // Image analysis ❌
  // ... other operations ...
  // Check authorization ✅ (too late)
}
```

**After:**
```javascript
async _handleMessageInner(message) {
  // ✅ Check authorization FIRST
  if (!message.guild) return;
  if (!(await this.isGuildAuthorized(message))) {
    this.logger.warn(`Guild ${message.guild.name} (${message.guild.id}) not authorized - ignoring message.`);
    return;
  }
  // Now safe to process message
  // Cache message
  // Save message to database
  // Image analysis
}
```

### 2. Interaction Handler (`src/services/social/discordService.mjs`)
**Added:** Authorization check for button interactions (profile views)

```javascript
this.client.on('interactionCreate', async interaction => {
  // ✅ Check guild authorization
  if (interaction.guild) {
    const isAuthorized = await checkGuildAuthorization(interaction.guild.id);
    if (!isAuthorized) return;
  }
  // Handle interaction
});
```

### 3. Thread Handler (`src/services/social/discordService.mjs`)
**Added:** Authorization check before moving avatars into threads

```javascript
this.client.on('threadCreate', async thread => {
  // ✅ Check guild authorization
  const isAuthorized = await checkGuildAuthorization(thread.guild.id);
  if (!isAuthorized) return;
  // Move avatar to thread
});
```

## Impact

### Protected Operations
Now **NO operations** occur in unauthorized guilds:
- ✅ Message saving blocked
- ✅ Location creation blocked
- ✅ Avatar summoning blocked
- ✅ Tool execution blocked
- ✅ Image analysis blocked
- ✅ X posting blocked
- ✅ Profile interactions blocked
- ✅ Thread avatar movement blocked

### Authorization Flow
```
Discord Event
    ↓
Check Guild Authorization ← FIRST STEP
    ↓
Authorized? → Yes → Process normally
    ↓
    No → Log warning & EXIT (no database changes)
```

## Testing Recommendations

1. **Verify unauthorized guild behavior:**
   - Join bot to test server
   - Do NOT authorize the server
   - Send messages
   - Verify: No locations created, no responses

2. **Verify authorized guild behavior:**
   - Authorize a test server via `/admin/servers`
   - Send messages
   - Verify: Normal bot operation

3. **Check logs:**
   - Look for: `Guild <name> (<id>) not authorized - ignoring message`
   - Ensure no database operations before this log

## Related Files
- `src/services/chat/messageHandler.mjs` - Main message processing
- `src/services/social/discordService.mjs` - Discord event handlers
- `src/services/web/public/js/admin-servers.js` - Admin UI for authorization
- `src/services/web/public/admin/servers.html` - Admin UI page

## Future Improvements
1. Consider adding a rate-limited notification to unauthorized guilds explaining they need authorization
2. Add metrics to track blocked messages from unauthorized guilds
3. Consider auto-detecting frequently used guilds and suggesting authorization to admins
