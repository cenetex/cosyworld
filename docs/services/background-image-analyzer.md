# Background Image Analyzer

## Overview

The Background Image Analyzer is a service that asynchronously processes image descriptions for messages containing images. It uses URL hashing to avoid duplicate analysis and stores results in a persistent cache.

## Features

- **Asynchronous Processing**: Images are analyzed in the background without blocking message handling
- **URL-based Deduplication**: Uses SHA-256 hashing to avoid analyzing the same image multiple times
- **Persistent Cache**: Results are stored in MongoDB for fast retrieval
- **Event-Driven**: Listens to `MESSAGE.CREATED` events to process new images automatically
- **Backfill Support**: Can retroactively analyze images from existing messages
- **Status Tracking**: Monitors processing status (completed, processing, failed)

## Architecture

```
┌─────────────────┐
│ Discord Message │
│  (with images)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│ ConversationManager │
│ (fast path - no AI) │
└────────┬────────────┘
         │
         │ emits MESSAGE.CREATED
         ▼
┌──────────────────────────┐
│ BackgroundImageAnalyzer  │
│ - Hash URL               │
│ - Check cache            │
│ - Analyze if needed      │
│ - Store result           │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────┐
│ image_analysis_cache │
│ { urlHash, desc }    │
└──────────────────────┘
```

## Database Schema

### Collection: `image_analysis_cache`

```javascript
{
  _id: ObjectId,
  urlHash: String,         // SHA-256 hash of image URL (unique index)
  url: String,             // Original image URL
  description: String,     // AI-generated description
  status: String,          // 'processing' | 'completed' | 'failed'
  messageId: String,       // Optional message ID
  createdAt: Date,
  startedAt: Date,
  analyzedAt: Date,
  failedAt: Date,
  error: String            // Error message if failed
}
```

### Indexes

- `{ urlHash: 1 }` - Unique, fast lookups by hash
- `{ url: 1 }` - Lookup by URL
- `{ analyzedAt: -1 }` - Sort by analysis time
- `{ status: 1 }` - Filter by status

## Usage

### Automatic Processing

The analyzer automatically processes new images when messages are created:

```javascript
// In ConversationManager
eventBus.emit('MESSAGE.CREATED', { message: formattedMsg });
```

### Manual Backfill

Process existing messages with unanalyzed images:

```bash
# Backfill 100 messages (default)
node scripts/backfill-image-descriptions.mjs

# Backfill 500 messages
node scripts/backfill-image-descriptions.mjs 500
```

### Get Cached Description

```javascript
const analyzer = container.resolve('backgroundImageAnalyzer');
const description = await analyzer.getCachedAnalysis(imageUrl);
```

### Check if Already Analyzed

```javascript
const isAnalyzed = await analyzer.isAnalyzed(imageUrl);
```

### Get Statistics

```javascript
const stats = await analyzer.getStats();
// Returns: { total, completed, processing, failed, queueSize }
```

## Performance Impact

### Before (Synchronous Analysis)

- **Channel context fetch**: 10-50+ seconds (with images)
- **Blocking**: User waits for all AI calls to complete
- **Duplicate work**: Same image analyzed multiple times

### After (Background Analysis)

- **Channel context fetch**: <1 second
- **Non-blocking**: User gets immediate response
- **Efficient**: Images analyzed once and cached
- **Background processing**: 1-5 seconds per image (async)

## Configuration

### Environment Variables

- `OPENROUTER_CHAT_MODEL` - AI model for image analysis
- `GOOGLE_AI_CHAT_MODEL` - Fallback model

### Batch Processing

The backfill processes images in batches of 5 to avoid overwhelming the AI service:

```javascript
const batchSize = 5;
// 1 second delay between batches
```

## Monitoring

### Log Messages

```
[BackgroundImageAnalyzer] Indexes created
[BackgroundImageAnalyzer] Analyzed abc12345... - success
[BackgroundImageAnalyzer] Already cached def67890...
[BackgroundImageAnalyzer] Backfilling 42 messages
```

### Error Handling

- Failed analyses are marked with `status: 'failed'` and `error` field
- Processing queue prevents duplicate concurrent analysis
- Gracefully handles missing AI service

## Integration Points

### ConversationManager

- Emits `MESSAGE.CREATED` events
- Enriches messages with cached descriptions (non-blocking)

### DatabaseService

- Creates required indexes on startup

### Container

- Auto-discovers and initializes the service
- Resolves on startup to activate event listeners

## API Reference

### `BackgroundImageAnalyzer`

#### Methods

##### `hashUrl(url)`
Generate SHA-256 hash of URL for deduplication.

##### `isAnalyzed(url)`
Check if image has been analyzed.

##### `getCachedAnalysis(url)`
Get cached description for URL.

##### `analyzeAndCache(url, messageId)`
Analyze image and store result in cache.

##### `backfillImageDescriptions(limit)`
Batch process unanalyzed images from messages.

##### `getStats()`
Get cache statistics (total, completed, processing, failed).

##### `updateMessageDescription(messageId, imageUrl, description)`
Update message with image description.

#### Events

##### Listens: `MESSAGE.CREATED`
Triggered when new messages with images are created.

```javascript
{
  message: {
    messageId: String,
    primaryImageUrl: String,
    imageUrls: String[],
    hasImages: Boolean
  }
}
```

## Future Enhancements

- [ ] Retry failed analyses automatically
- [ ] Support for multiple image descriptions per message
- [ ] Image similarity detection to avoid analyzing duplicates
- [ ] Admin dashboard for monitoring
- [ ] Configurable AI prompts per guild
- [ ] Priority queue for user-owned avatar images
- [ ] Webhook notifications for analysis completion

## Troubleshooting

### Images not being analyzed

1. Check if BackgroundImageAnalyzer is initialized:
   ```javascript
   container.resolve('backgroundImageAnalyzer')
   ```

2. Verify event emission:
   ```javascript
   // Should see in logs
   [ConversationManager] Event emit failed: ...
   ```

3. Check database indexes:
   ```javascript
   db.image_analysis_cache.getIndexes()
   ```

### Slow backfill

- Reduce batch size in `backfillImageDescriptions`
- Check AI service rate limits
- Verify database connection

### Cache not being used

- Check if messages have `primaryImageUrl` field
- Verify `enrichMessagesWithCachedDescriptions` is called
- Check for URL hash mismatches

## Migration

If you have existing messages with inline image descriptions, you can migrate them:

```javascript
// Run once to populate cache from existing descriptions
const messages = await db.collection('messages')
  .find({ imageDescription: { $exists: true, $ne: null } })
  .toArray();

for (const msg of messages) {
  const urlHash = crypto.createHash('sha256')
    .update(msg.primaryImageUrl)
    .digest('hex');
  
  await db.collection('image_analysis_cache').updateOne(
    { urlHash },
    {
      $set: {
        url: msg.primaryImageUrl,
        description: msg.imageDescription,
        status: 'completed',
        analyzedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
}
```
