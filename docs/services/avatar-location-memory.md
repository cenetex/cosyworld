# Avatar Location Memory System

## Overview

The Avatar Location Memory system tracks locations that avatars have visited, allowing them to "remember" places they've been and make better decisions when using the move tool.

## Problem Solved

Previously, agents using the move tool would:
- Have no context about available locations
- Frequently fail to move because they didn't know valid location names
- Create duplicate or confusing location names
- Not know where they had been before

## Solution

The system provides:
1. **Automatic Visit Tracking**: Records every location an avatar visits
2. **Memory-Based Context**: Agents receive a list of known locations in their prompt
3. **Intelligent Suggestions**: Move tool suggests known locations on errors
4. **Smart Matching**: Prioritizes known locations when moving
5. **TTL-Based Cleanup**: Old memories expire after 30 days

## Architecture

```
┌──────────────┐
│ Avatar Moves │
└──────┬───────┘
       │
       ▼
┌────────────────────┐
│   MapService       │
│ updateAvatarPos()  │
└──────┬─────────────┘
       │
       ▼
┌──────────────────────────┐
│ AvatarLocationMemory     │
│ - Record visit           │
│ - Update timestamp       │
│ - Increment visit count  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ avatar_location_memory   │
│ Collection               │
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ PromptService            │
│ - Get recent locations   │
│ - Add to tool context    │
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Agent sees known locs    │
│ in system prompt         │
└──────────────────────────┘
```

## Database Schema

### Collection: `avatar_location_memory`

```javascript
{
  _id: ObjectId,
  avatarId: String,         // Avatar ID (indexed)
  channelId: String,        // Channel/thread ID
  locationName: String,     // Human-readable name
  locationType: String,     // 'channel' | 'thread'
  visitCount: Number,       // Number of times visited
  firstVisited: Date,       // First visit timestamp
  lastVisited: Date,        // Most recent visit (indexed, TTL 30 days)
  createdAt: Date
}
```

### Indexes

```javascript
{ avatarId: 1, lastVisited: -1 }  // Get recent locations for avatar
{ avatarId: 1, channelId: 1 }     // Check if avatar visited location
{ lastVisited: 1 }                // TTL index (30 days)
```

## Integration Points

### 1. MapService

Automatically records visits when avatar position updates:

```javascript
async updateAvatarPosition(avatar, newLocationId) {
  // ... update position ...
  
  // Record visit in memory
  this.avatarLocationMemory.recordVisit(
    String(avatar._id),
    newLocationId,
    locationName,
    locationType
  );
}
```

### 2. PromptService

Includes known locations in tool context:

```javascript
async _getToolContext(avatar, location) {
  // ... other context ...
  
  const knownLocations = await this.mapService.avatarLocationMemory
    .getLocationContextForAgent(String(avatar._id), 8);
  
  return `
AVAILABLE ACTIONS:
...

KNOWN LOCATIONS (from your memories):
1. 📍 Town Square (visited 5x)
2. 🧵 The Dark Forest
3. 📍 Merchant Guild (visited 2x)
...
`;
}
```

### 3. MoveTool

Uses known locations for intelligent matching and error messages:

```javascript
async execute(message, params, avatar) {
  // Check if destination matches a known location
  const matches = await this.mapService.avatarLocationMemory
    .searchKnownLocations(String(avatar._id), destination);
  
  if (matches.length > 0) {
    // Use known location (faster, no AI call needed)
    newLocation = matches[0];
  } else {
    // Create new location
    newLocation = await this.locationService.findOrCreateLocation(...);
  }
}
```

## Features

### Automatic Tracking

Every time an avatar moves, the visit is automatically recorded:

```javascript
// Avatar moves to "Town Square"
await mapService.updateAvatarPosition(avatar, channelId);
// → Memory automatically updated

// Later, avatar sees in prompt:
// "KNOWN LOCATIONS: 1. 📍 Town Square"
```

### Visit Count Tracking

Frequently visited locations are tracked:

```javascript
{
  locationName: "Town Square",
  visitCount: 5,  // Avatar has been here 5 times
  lastVisited: "2025-10-19T10:30:00Z"
}
```

### Smart Suggestions

When move tool fails, it suggests known locations:

```
❌ Error: Failed to move: Channel not found
Known locations: Town Square, Dark Forest, Merchant Guild
```

### Configurable Limits

Environment variables control memory size:

```bash
# Max locations shown in prompt
PROMPT_MAX_KNOWN_LOCATIONS=8

# Max locations stored per avatar
# (configured in AvatarLocationMemory.MAX_TOTAL_LOCATIONS = 50)
```

## API Reference

### `AvatarLocationMemory`

#### Methods

##### `recordVisit(avatarId, channelId, locationName, locationType)`
Record that an avatar visited a location.

##### `getRecentLocations(avatarId, limit)`
Get recent locations for an avatar (sorted by lastVisited desc).

##### `getLocationContextForAgent(avatarId, limit)`
Get formatted location list for agent prompt context.

```
Returns:
KNOWN LOCATIONS (from your memories):
1. 📍 Town Square (visited 5x)
2. 🧵 Dark Forest
3. 📍 Merchant Guild (visited 2x)
```

##### `hasVisited(avatarId, channelId)`
Check if avatar has visited a location.

##### `searchKnownLocations(avatarId, searchTerm)`
Find locations matching search term in avatar's memory.

##### `getMemoryStats(avatarId)`
Get statistics about avatar's location memory.

```javascript
{
  totalLocations: 15,
  totalVisits: 42,
  mostVisited: { name: "Town Square", visits: 5 },
  recentLocation: { name: "Dark Forest", visited: Date }
}
```

##### `clearMemories(avatarId)`
Clear all location memories for an avatar.

## Usage Examples

### Get Known Locations for Agent

```javascript
const locationMemory = container.resolve('avatarLocationMemory');

// Get formatted context for prompt
const context = await locationMemory.getLocationContextForAgent(avatarId, 8);
// → "KNOWN LOCATIONS: 1. 📍 Town Square (visited 5x) ..."

// Get raw location data
const locations = await locationMemory.getRecentLocations(avatarId, 10);
// → [{ channelId, locationName, visitCount, lastVisited }, ...]
```

### Search Known Locations

```javascript
// Agent wants to move to "town"
const matches = await locationMemory.searchKnownLocations(avatarId, "town");
// → [{ channelId, locationName: "Town Square", visitCount: 5 }]

// Use first match
if (matches.length > 0) {
  const location = matches[0];
  // Move to known location (no need to create new one)
}
```

### Check Visit History

```javascript
const hasBeenThere = await locationMemory.hasVisited(avatarId, channelId);
// → true/false

const stats = await locationMemory.getMemoryStats(avatarId);
// → { totalLocations, totalVisits, mostVisited, recentLocation }
```

## Example Prompt Context

### Before (No Location Memory)

```
AVAILABLE ACTIONS:
🏃‍♂️ move
⚔️ attack
...

CURRENT SITUATION:
HP: 100/100
Nearby: Alice, Bob
```

### After (With Location Memory)

```
AVAILABLE ACTIONS:
🏃‍♂️ move
⚔️ attack
...

CURRENT SITUATION:
HP: 100/100
Current Location: Town Square
Nearby: Alice, Bob

KNOWN LOCATIONS (from your memories):
1. 📍 Town Square (visited 5x)
2. 🧵 The Dark Forest
3. 📍 Merchant Guild (visited 2x)
4. 🧵 Ancient Temple
5. 📍 Tavern (visited 3x)

You can use 🏃‍♂️ to move to any of these locations or discover new ones.
```

## Performance Considerations

### Memory Limits

- **Per-Avatar Limit**: 50 locations max (oldest pruned automatically)
- **Prompt Limit**: 8 locations shown (configurable via `PROMPT_MAX_KNOWN_LOCATIONS`)
- **TTL**: Memories expire after 30 days

### Indexing

All queries use indexes for fast performance:
- Recent locations: `{ avatarId: 1, lastVisited: -1 }`
- Location lookup: `{ avatarId: 1, channelId: 1 }`
- TTL cleanup: `{ lastVisited: 1 }`

### Non-Blocking

Location memory recording is non-blocking:
```javascript
// Fire and forget
this.avatarLocationMemory.recordVisit(...).catch(err => {
  // Log but don't block move operation
});
```

## Configuration

### Environment Variables

```bash
# Max known locations shown in agent prompt
PROMPT_MAX_KNOWN_LOCATIONS=8  # default: 8
```

### Service Configuration

In `avatarLocationMemory.mjs`:
```javascript
this.MAX_RECENT_LOCATIONS = 10; // Kept in-memory
this.MAX_TOTAL_LOCATIONS = 50;  // Stored in DB
```

## Monitoring

### Log Messages

```
[AvatarLocationMemory] Indexes created
[AvatarLocationMemory] Recorded visit: 507f1f77... -> Town Square
[AvatarLocationMemory] Pruned 5 old memories for avatar 507f1f77...
```

### Stats Query

```javascript
const stats = await locationMemory.getMemoryStats(avatarId);
console.log(`Avatar has visited ${stats.totalLocations} locations`);
console.log(`Most visited: ${stats.mostVisited.name} (${stats.mostVisited.visits}x)`);
```

## Migration

No migration needed - system works out of the box:

1. New avatars start with empty memory
2. Memory builds automatically as avatars move
3. Old avatars work fine (memory builds going forward)
4. Indexes created automatically on startup

## Troubleshooting

### Agents not seeing known locations

1. Check if `avatarLocationMemory` is initialized:
   ```javascript
   container.resolve('avatarLocationMemory')
   ```

2. Verify memory is being recorded:
   ```javascript
   const locs = await locationMemory.getRecentLocations(avatarId);
   console.log(locs); // Should show visited locations
   ```

3. Check prompt includes `KNOWN LOCATIONS`:
   ```javascript
   // In PromptService logs
   [PromptService] Tool context: ... KNOWN LOCATIONS ...
   ```

### Memory not persisting

- Check database connection
- Verify indexes exist: `db.avatar_location_memory.getIndexes()`
- Check for errors in logs: `[AvatarLocationMemory] Failed to record visit`

### Move tool still failing

1. Check error messages for hints
2. Verify location names are reasonable
3. Ensure guild and channel are accessible
4. Check if location creation is enabled

## Future Enhancements

- [ ] Share location memories between avatars in same guild
- [ ] Track location popularity (most visited by all avatars)
- [ ] Add location categories/tags (town, dungeon, forest, etc.)
- [ ] Support location relationships (adjacent to, inside, near)
- [ ] Export/import location memory for avatar transfer
- [ ] Web UI for viewing avatar's location history
- [ ] Heatmap visualization of avatar movements

## Related Systems

- **MapService**: Manages avatar positions
- **LocationService**: Creates and manages locations
- **MoveTool**: Uses memory for intelligent movement
- **PromptService**: Includes memory in agent context
