# Conversation Manager

## Overview
The ConversationManager orchestrates the flow of messages between users and AI avatars. It manages the conversation lifecycle, including message processing, response generation, narrative development, and channel context management.

## Functionality
- **Response Generation**: Creates context-aware avatar responses to user messages
- **Narrative Generation**: Periodically generates character reflections and development 
- **Channel Context**: Maintains and updates conversation history and summaries
- **Permission Management**: Ensures the bot has necessary channel permissions
- **Rate Limiting**: Implements cooldown mechanisms to prevent response spam

## Implementation
The ConversationManager extends BasicService and requires several dependencies for its operation. It manages cooldowns, permission checks, and orchestrates the process of generating and sending responses.

```javascript
export class ConversationManager extends BasicService {
  constructor(container) {
    super(container, [
      'discordService',
      'avatarService',
      'aiService',
    ]);

    this.GLOBAL_NARRATIVE_COOLDOWN = 60 * 60 * 1000; // 1 hour
    this.lastGlobalNarrativeTime = 0;
    this.channelLastMessage = new Map();
    this.CHANNEL_COOLDOWN = 5 * 1000; // 5 seconds
    this.MAX_RESPONSES_PER_MESSAGE = 2;
    this.channelResponders = new Map();
    this.requiredPermissions = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageWebhooks'];
   
    this.db = services.databaseService.getDatabase();
  }
  
  // Methods...
}
```

### Key Methods

#### `generateNarrative(avatar)`
Periodically generates personality development and narrative reflection for an avatar. This enables characters to "think" about their experiences and evolve over time.

#### `getChannelContext(channelId, limit)`
Retrieves recent message history for a channel, using database records when available and falling back to Discord API when needed.

#### `getChannelSummary(avatarId, channelId)`
Maintains and updates AI-generated summaries of channel conversations to provide context without using excessive token count.

#### `sendResponse(channel, avatar)`
Orchestrates the full response generation flow:
1. Checks permissions and cooldowns
2. Gathers context and relevant information
3. Assembles prompts and generates AI response
4. Processes any commands in the response
5. Sends the response to the channel

#### `removeAvatarPrefix(response, avatar)`
Cleans up responses that might include the avatar's name as a prefix.

## Rate Limiting Implementation
The service implements several rate limiting mechanisms:
- **Global narrative cooldown** (1 hour): Prevents excessive narrative generation across all channels
- **Per-channel response cooldown** (5 seconds): Prevents individual avatars from responding too quickly
- **Bot reply rate limiting** (10 seconds, configurable): Enforces a minimum time between ANY bot replies in the same channel, preventing bots from overwhelming channels with rapid-fire responses
- **Maximum responses per message** (2): Limits how many avatars can respond to a single trigger

### Bot Reply Rate Limiting
To prevent channels from being overwhelmed by bot activity, the ConversationManager tracks the last bot message timestamp per channel and enforces a configurable cooldown period before allowing the next bot reply.

**Configuration:**
```env
# Minimum milliseconds between bot replies in the same channel
# Default: 10000 (10 seconds)
BOT_REPLY_COOLDOWN_MS=10000
```

This rate limit applies to ALL bot responses in a channel, regardless of which avatar is responding. It ensures:
- Channels remain readable and not flooded with bot messages
- Users have time to read and respond between bot messages
- Bot-to-bot cascades are naturally throttled
- More natural conversation pacing

**Implementation Details:**
- Tracked via `channelLastBotMessage` Map (channelId -> timestamp)
- Updated immediately after successful message send
- Can be overridden with `overrideCooldown` option when needed
- Logs remaining cooldown time when rate limit is active

## Active Avatar Management

The system now limits each channel to a maximum of 8 active avatars to prevent channels from being overwhelmed. This is managed through the `channel_avatar_presence` collection.

### How It Works

1. **Active Limit**: Only up to 8 avatars can be "active" in a channel at once
2. **Automatic Rotation**: When an inactive avatar is mentioned or summoned, it becomes active
3. **Stale Removal**: The stalest active avatar (least recently active) is automatically deactivated
4. **Activity Tracking**: Every time an avatar speaks, their activity timestamp is updated

### Configuration

```env
# Maximum active avatars per channel
# Default: 8
MAX_ACTIVE_AVATARS_PER_CHANNEL=8
```

### Database Schema

The `channel_avatar_presence` collection tracks:
- `channelId`: Discord channel ID
- `avatarId`: Avatar ObjectId
- `isActive`: Boolean indicating if avatar is active in this channel
- `lastActivityAt`: Timestamp of last activity (speaking or being mentioned)
- `activatedAt`: When the avatar was activated in this channel
- `deactivatedAt`: When the avatar was deactivated (if applicable)

**Indexes:**
- Unique compound index on `(channelId, avatarId)`
- Compound index on `(channelId, isActive, lastActivityAt)` for efficient queries
- Index on `lastActivityAt` for staleness queries

## Dependencies
- DiscordService: For Discord interactions
- AvatarService: For avatar data, updates, and active avatar management
- AIService: For generating AI responses
- DatabaseService: For persistence
- PromptService: For generating structured prompts