# Location Duplicates Fix

## Problem
The LocationService was creating multiple location records for the same Discord channel/thread, leading to duplicate entries in the database.

## Root Causes

### 1. No Database Uniqueness Constraint
- The `locations` collection had no unique index on `channelId`
- MongoDB allowed multiple documents with the same `channelId` to be inserted

### 2. Race Conditions in `getLocationByChannelId`
- Used `insertOne()` instead of `updateOne()` with `upsert`
- Concurrent requests could both find no location, then both insert
- No atomic check-and-create operation

### 3. Missing Service Initialization
- LocationService had no `initializeDatabase()` method to create indexes on startup
- Even with upsert, without unique index, duplicates were possible

## Solution

### 1. Added Unique Index on channelId
**File**: `src/services/location/locationService.mjs`

```javascript
async initializeDatabase() {
  await this.ensureDbConnection();
  
  try {
    // Create unique index on channelId to prevent duplicates
    await this.db.collection('locations').createIndex(
      { channelId: 1 },
      { unique: true, background: true }
    );
    console.log('LocationService: Created unique index on channelId');
  } catch (error) {
    // Index might already exist
    if (error.code !== 85 && error.code !== 86) {
      console.warn('LocationService: Failed to create index:', error.message);
    }
  }
}
```

### 2. Fixed Race Condition in getLocationByChannelId
**File**: `src/services/location/locationService.mjs`

**Before:**
```javascript
await this.db.collection('locations').insertOne(location);
```

**After:**
```javascript
// Use updateOne with upsert to prevent race condition duplicates
await this.db.collection('locations').updateOne(
  { channelId },
  { 
    $set: location,
    $setOnInsert: { createdAt: new Date().toISOString() }
  },
  { upsert: true }
);

// Fetch the location again to ensure we have the correct _id
location = await this.db.collection('locations').findOne({ channelId });
```

### 3. Improved findOrCreateLocation Upsert
**File**: `src/services/location/locationService.mjs`

Changed from using `$set` with the entire document to using separate `$set` and `$setOnInsert` operators:

```javascript
await this.db.collection('locations').updateOne(
  { channelId: thread.id },
  { 
    $set: {
      name: locationDocument.name,
      description: locationDocument.description,
      imageUrl: locationDocument.imageUrl,
      type: locationDocument.type,
      parentId: locationDocument.parentId,
      updatedAt: locationDocument.updatedAt,
      version: locationDocument.version
    },
    $setOnInsert: {
      createdAt: locationDocument.createdAt
    }
  },
  { upsert: true }
);
```

This ensures `createdAt` is only set on initial insert, not on updates.

### 4. Added Service Initialization in Container
**File**: `src/container.mjs`

Added initialization call after avatarLocationMemory:

```javascript
// Initialize LocationService indexes to prevent duplicate locations
try {
  if (container.registrations.locationService) {
    const locService = container.resolve('locationService');
    await locService.initializeDatabase(); // Create unique index on channelId
    console.log('[container] LocationService indexes initialized.');
  }
} catch (e) {
  console.warn('[container] Failed to initialize LocationService:', e.message);
}
```

### 5. Created Cleanup Script
**File**: `scripts/deduplicate-locations.mjs`

A utility script to:
- Identify existing duplicate locations by channelId
- Keep the oldest record (by createdAt timestamp)
- Delete newer duplicates
- Create unique index if missing

**Usage:**
```bash
# Dry run (shows what would be deleted)
node scripts/deduplicate-locations.mjs

# Execute the cleanup
node scripts/deduplicate-locations.mjs --execute
```

## Testing

1. **Start the application** - The unique index will be created automatically
2. **Run the cleanup script** - Remove any existing duplicates:
   ```bash
   node scripts/deduplicate-locations.mjs --execute
   ```
3. **Verify** - Try creating a location with the same channelId twice:
   - First attempt: succeeds
   - Second attempt: updates existing record (no duplicate)

## Benefits

1. **Database Integrity** - Unique index enforces one location per channel at DB level
2. **Atomic Operations** - upsert prevents race conditions
3. **Backward Compatible** - Existing code continues to work
4. **Clean Data** - Cleanup script removes existing duplicates
5. **Future Proof** - Impossible to create duplicates going forward

## Related Files Modified

- `src/services/location/locationService.mjs` - Added initializeDatabase(), fixed upsert operations
- `src/container.mjs` - Added LocationService initialization
- `scripts/deduplicate-locations.mjs` - New cleanup utility script

## Related to Previous Fix

This fix is independent of but complements the previous MoveTool fix:
- **MoveTool fix**: Made updateAvatarPosition return the avatar object
- **Location fix**: Prevents duplicate location records

Both fixes improve data integrity and prevent confusing errors for users.
