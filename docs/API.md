# CosyWorld API Documentation

**Base URL:** `http://<your-mac-mini-ip>:3000`

Example: `http://192.168.1.79:3000`

---

## Authentication

### Public Endpoints
Most read-only endpoints (`/api/avatars`, `/api/items`, `/api/locations`, `/api/health`) are publicly accessible without authentication.

### OpenAI-Compatible Avatar API
The `/api/v1/*` endpoints require Bearer token authentication:

```
Authorization: Bearer sk-rati-<your-key>
```

Configure your API key in `.env`:
```
AVATAR_API_KEYS="sk-rati-local-dev"
```

---

## Health Check

### GET /api/health/ready
Check if the server is ready to accept requests.

**Response:**
```json
{
  "status": "ready",
  "timestamp": "2026-02-03T12:00:00.000Z"
}
```

---

## Avatars

### GET /api/avatars
List all avatars.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "name": "Rati",
      "description": "A friendly avatar",
      "personality": "curious and helpful",
      "imageUrl": "https://...",
      "model": "avatar:rati",
      "provider": "swarm"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

### GET /api/avatars/:id
Get a single avatar by ID.

---

## Items

### GET /api/items
List items with optional filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `owner` | string | Filter by owner avatar ID |
| `locationId` | string | Filter by location ID |
| `rarity` | string | Filter by rarity (`common`, `uncommon`, `rare`, `epic`, `legendary`) |
| `type` | string | Filter by type (`weapon`, `armor`, `consumable`, `quest`, `key`, `artifact`) |
| `search` | string | Search in name/description |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/items?rarity=rare&limit=10"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "name": "Enchanted Sword",
      "description": "A blade that glows with ancient magic",
      "type": "weapon",
      "rarity": "rare",
      "emoji": "⚔️",
      "imageUrl": "https://...",
      "owner": "avatar-id-or-null",
      "locationId": "location-id-or-null",
      "properties": {},
      "createdAt": "2026-02-03T12:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

### GET /api/items/:id
Get a single item by ID.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/items/507f1f77bcf86cd799439011"
```

### GET /api/items/by-location/:locationId
Get all items at a specific location.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/items/by-location/507f1f77bcf86cd799439011"
```

### GET /api/items/by-owner/:ownerId
Get all items owned by a specific avatar.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/items/by-owner/507f1f77bcf86cd799439011"
```

---

## Locations

### GET /api/locations
List locations with optional filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `type` | string | Filter by location type |
| `channelId` | string | Filter by Discord channel ID |
| `guildId` | string | Filter by Discord guild ID |
| `search` | string | Search in name/description |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/locations?type=tavern&limit=10"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "name": "The Rusty Anchor",
      "description": "A cozy tavern by the docks",
      "type": "tavern",
      "imageUrl": "https://...",
      "channelId": "1234567890",
      "guildId": "9876543210",
      "createdAt": "2026-02-03T12:00:00.000Z"
    }
  ],
  "total": 25,
  "limit": 10,
  "offset": 0
}
```

### GET /api/locations/:id
Get a single location by ID.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/locations/507f1f77bcf86cd799439011"
```

### GET /api/locations/by-channel/:channelId
Get location by Discord channel ID.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/locations/by-channel/1234567890"
```

### GET /api/locations/:id/items
Get all items at a specific location.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/locations/507f1f77bcf86cd799439011/items"
```

### GET /api/locations/:id/avatars
Get all avatars at a specific location.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/locations/507f1f77bcf86cd799439011/avatars"
```

---

## OpenAI-Compatible Avatar Chat API

These endpoints follow the OpenAI API specification, allowing you to use the OpenAI SDK to chat with CosyWorld avatars.

### GET /api/v1/models
List available avatar models.

**Headers:**
```
Authorization: Bearer sk-rati-local-dev
```

**Example:**
```bash
curl -H "Authorization: Bearer sk-rati-local-dev" \
  "http://192.168.1.79:3000/api/v1/models"
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "avatar:rati",
      "object": "model",
      "created": 1706961600,
      "owned_by": "cosyworld"
    }
  ],
  "energy": {
    "current": 100,
    "max": 100
  }
}
```

### GET /api/v1/models/:modelId
Get details for a specific avatar model.

**Example:**
```bash
curl -H "Authorization: Bearer sk-rati-local-dev" \
  "http://192.168.1.79:3000/api/v1/models/avatar:rati"
```

### POST /api/v1/chat/completions
Chat with an avatar (OpenAI-compatible).

**Headers:**
```
Authorization: Bearer sk-rati-local-dev
Content-Type: application/json
```

**Request Body:**
```json
{
  "model": "avatar:rati",
  "messages": [
    {"role": "user", "content": "Hello! What's your name?"}
  ],
  "temperature": 0.8,
  "max_tokens": 500
}
```

**Example:**
```bash
curl -X POST "http://192.168.1.79:3000/api/v1/chat/completions" \
  -H "Authorization: Bearer sk-rati-local-dev" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "avatar:rati",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1706961600,
  "model": "avatar:rati",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm Rati, nice to meet you!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  },
  "energy": {
    "current": 99,
    "max": 100,
    "cost": 1
  }
}
```

---

## Using with OpenAI SDK

### Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.1.79:3000/api/v1",
    api_key="sk-rati-local-dev"
)

# List avatars
models = client.models.list()
for model in models.data:
    print(model.id)

# Chat with avatar
response = client.chat.completions.create(
    model="avatar:rati",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### JavaScript/Node.js
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://192.168.1.79:3000/api/v1',
  apiKey: 'sk-rati-local-dev'
});

// List avatars
const models = await client.models.list();
console.log(models.data);

// Chat with avatar
const response = await client.chat.completions.create({
  model: 'avatar:rati',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.choices[0].message.content);
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (missing/invalid API key) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## Rate Limiting

In production mode, the API enforces rate limiting:
- **120 requests per minute** per IP address

Rate limit headers are included in responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## Gallery

The gallery API provides access to all AI-generated images and videos.

### GET /api/gallery
List all media (images and videos) with filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `type` | string | Filter by type (`image`, `video`, `all`) |
| `category` | string | Filter by category |
| `purpose` | string | Filter by purpose |
| `source` | string | Filter by generation source |
| `search` | string | Search in prompts/tags |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery?type=image&category=dungeon&limit=20"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "type": "image",
      "url": "https://cdn.example.com/images/abc123.png",
      "thumbnailUrl": "https://cdn.example.com/images/abc123.png",
      "prompt": "A dark dungeon corridor with torches",
      "purpose": "dungeon_room",
      "category": "dungeon",
      "tags": ["dungeon", "corridor", "dark"],
      "metadata": { "theme": "dark", "roomType": "corridor" },
      "source": "replicate",
      "usageCount": 5,
      "createdAt": "2026-02-03T12:00:00.000Z"
    }
  ],
  "total": 150,
  "images": 120,
  "videos": 30,
  "limit": 20,
  "offset": 0
}
```

### GET /api/gallery/images
List only generated images.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `category` | string | Filter by category (`dungeon`, `story`, `character`, etc.) |
| `purpose` | string | Filter by purpose (`dungeon_room`, `avatar`, `item`, etc.) |
| `source` | string | Filter by source (`replicate`, `dalle`, etc.) |
| `tags` | string | Comma-separated tags to filter by |
| `search` | string | Search in prompts/tags/keywords |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/images?purpose=avatar&limit=10"
```

### GET /api/gallery/videos
List only generated videos.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 50, max: 200) |
| `offset` | number | Pagination offset |
| `status` | string | Filter by status (`completed`, `pending`, `processing`, `failed`) |
| `source` | string | Filter by source |
| `search` | string | Search in prompts |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/videos?status=completed"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "url": "https://cdn.example.com/videos/xyz789.mp4",
      "thumbnailUrl": "https://cdn.example.com/images/keyframe.png",
      "prompt": "A dragon flying over mountains",
      "status": "completed",
      "purpose": "story_beat",
      "metadata": {},
      "source": "veo",
      "duration": 5.0,
      "createdAt": "2026-02-03T12:00:00.000Z",
      "completedAt": "2026-02-03T12:01:00.000Z"
    }
  ],
  "total": 30,
  "limit": 50,
  "offset": 0
}
```

### GET /api/gallery/images/:id
Get a single image by ID.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/images/507f1f77bcf86cd799439011"
```

### GET /api/gallery/videos/:id
Get a single video by ID.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/videos/507f1f77bcf86cd799439011"
```

### GET /api/gallery/categories
Get list of available categories, purposes, and sources.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/categories"
```

**Response:**
```json
{
  "categories": ["character", "dungeon", "item", "location", "story"],
  "purposes": ["avatar", "dungeon_room", "item", "location", "story_beat"],
  "sources": ["dalle", "replicate", "stability"]
}
```

### GET /api/gallery/stats
Get gallery statistics.

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/stats"
```

**Response:**
```json
{
  "images": {
    "total": 1250,
    "byCategory": {
      "dungeon": 500,
      "character": 300,
      "item": 200,
      "location": 150,
      "story": 100
    },
    "byPurpose": {
      "dungeon_room": 500,
      "avatar": 300,
      "item": 200
    }
  },
  "videos": {
    "total": 50,
    "completed": 45,
    "pending": 5
  }
}
```

### GET /api/gallery/recent
Get most recent media across all types.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 20, max: 100) |

**Example:**
```bash
curl "http://192.168.1.79:3000/api/gallery/recent?limit=10"
```

**Response:**
```json
{
  "data": [
    {
      "_id": "...",
      "type": "video",
      "url": "https://cdn.example.com/videos/latest.mp4",
      "thumbnailUrl": "https://cdn.example.com/images/thumb.png",
      "prompt": "Epic battle scene...",
      "category": "story",
      "createdAt": "2026-02-03T12:00:00.000Z"
    },
    {
      "_id": "...",
      "type": "image",
      "url": "https://cdn.example.com/images/newest.png",
      "thumbnailUrl": "https://cdn.example.com/images/newest.png",
      "prompt": "A mysterious cave entrance...",
      "category": "dungeon",
      "createdAt": "2026-02-03T11:59:00.000Z"
    }
  ]
}
```
