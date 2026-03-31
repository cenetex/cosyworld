# Swarm Avatar API

Chat with AI avatars using an OpenAI-compatible API.

## Quick Start

```bash
curl https://swarm.rati.chat/api/v1/chat/completions \
  -H "Authorization: Bearer sk-rati-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "avatar:rati",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Base URL

```
https://swarm.rati.chat/api/v1
```

## Authentication

All requests require an API key in the `Authorization` header:

```
Authorization: Bearer sk-rati-xxxxx
```

API keys are prefixed with `sk-rati-` and are scoped to either:
- **All avatars** (`*`) - Access any public avatar
- **Specific avatar** - Access only one avatar

---

## Endpoints

### List Models

```http
GET /v1/models
```

Returns all avatars available to your API key.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "avatar:rati",
      "object": "model",
      "created": 1706644800,
      "owned_by": "swarm",
      "capabilities": { "voice": true },
      "avatar": {
        "name": "Rati",
        "description": "A helpful AI assistant",
        "profile_image": "https://cdn.rati.chat/avatars/rati/profile.png"
      }
    }
  ],
  "energy": {
    "current": 8.5,
    "max": 10,
    "refill_rate": 1,
    "next_refill_minutes": 42
  }
}
```

The `energy` field shows the API key holder's current energy balance. Energy is consumed when making chat requests (1⚡ for text, 2⚡ for audio).

---

### Get Model Details

```http
GET /v1/models/{model_id}
```

Get detailed information about a specific avatar.

**Example:**
```bash
curl https://swarm.rati.chat/api/v1/models/avatar:rati \
  -H "Authorization: Bearer sk-rati-xxxxx"
```

**Response:**
```json
{
  "id": "avatar:rati",
  "object": "model",
  "capabilities": { "voice": true },
  "avatar": {
    "id": "rati",
    "name": "Rati",
    "description": "A helpful AI assistant",
    "profile_image": "https://cdn.rati.chat/avatars/rati/profile.png",
    "character_reference": "https://cdn.rati.chat/avatars/rati/character.png",
    "platforms": {
      "telegram": { "username": "ratibot", "home_channel": "https://t.me/ratichat" },
      "twitter": { "username": "rati_ai" },
      "discord": null
    },
    "voice": { "style": "voice-clone" },
    "sticker_pack": { "name": "rati_stickers", "title": "Rati Stickers", "count": 12 }
  },
  "energy": {
    "current": 8.5,
    "max": 10,
    "refill_rate": 1,
    "next_refill_minutes": 42,
    "costs": {
      "text": 1,
      "audio": 2
    }
  }
}
```

The `energy.costs` field shows how much energy each request type consumes.

---

### Chat Completions

```http
POST /v1/chat/completions
```

Generate a chat response from an avatar.

**Request Body:**
```json
{
  "model": "avatar:rati",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What's the weather like?"}
  ],
  "temperature": 0.8,
  "max_tokens": 1024,
  "include_audio": false
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | ✓ | Avatar ID: `avatar:name` or just `name` |
| `messages` | array | ✓ | Conversation history |
| `temperature` | number | | Creativity (0-2), default varies by avatar |
| `max_tokens` | number | | Max response length |
| `include_audio` | boolean | | Generate voice audio with response |

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1706644800,
  "model": "avatar:rati",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I don't have access to real-time weather data, but I'd be happy to chat about anything else!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 30,
    "total_tokens": 55
  }
}
```

---

## Voice Audio

Avatars with voice capabilities can generate spoken audio responses.

### Check Voice Support

1. Call `GET /v1/models` and check `capabilities.voice`
2. Or call `GET /v1/models/{model_id}` for detailed voice info

### Request Audio

Add `"include_audio": true` to your chat request:

```bash
curl https://swarm.rati.chat/api/v1/chat/completions \
  -H "Authorization: Bearer sk-rati-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "avatar:rati",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "include_audio": true
  }'
```

**Response with audio:**
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?",
      "audio": {
        "url": "https://cdn.rati.chat/voice/abc123.wav",
        "format": "wav",
        "duration_ms": 2500
      }
    }
  }]
}
```

The `audio.url` is a temporary signed URL valid for ~1 hour.

---

## SDK Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-rati-xxxxx",
    base_url="https://swarm.rati.chat/api/v1"
)

response = client.chat.completions.create(
    model="avatar:rati",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk-rati-xxxxx',
  baseURL: 'https://swarm.rati.chat/api/v1',
});

const response = await client.chat.completions.create({
  model: 'avatar:rati',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

### cURL

```bash
curl https://swarm.rati.chat/api/v1/chat/completions \
  -H "Authorization: Bearer sk-rati-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "avatar:rati",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Error Handling

**Error Response Format:**
```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

| Status | Type | Description |
|--------|------|-------------|
| 401 | `authentication_error` | Missing or invalid API key |
| 402 | `insufficient_energy` | Not enough energy to process request |
| 403 | `permission_error` | API key doesn't have access to this avatar |
| 404 | `not_found` | Avatar not found |
| 400 | `invalid_request_error` | Malformed request body |
| 500 | `server_error` | Internal error |

---

## Energy System

Each API key has an energy balance that's consumed when making requests:

| Request Type | Energy Cost |
|--------------|-------------|
| Text chat completion | 1⚡ |
| Audio chat completion | 2⚡ |

Energy automatically refills over time based on your key's configuration.

**Checking Energy:**
```bash
# Get energy status with model list
curl https://swarm.rati.chat/api/v1/models \
  -H "Authorization: Bearer sk-rati-xxxxx"
```

**Response includes:**
```json
{
  "energy": {
    "current": 8.5,
    "max": 10,
    "refill_rate": 1,
    "next_refill_minutes": 42
  }
}
```

| Field | Description |
|-------|-------------|
| `current` | Current energy balance |
| `max` | Maximum energy capacity |
| `refill_rate` | Energy restored per refill interval |
| `next_refill_minutes` | Minutes until next refill |
| `costs` | Energy cost per request type (in `/v1/models/{id}` response) |

If you don't have enough energy, requests will return a `402 Payment Required` error.

---

## Rate Limits

API keys have configurable rate limits:
- Requests per minute
- Requests per day

Rate limit info is returned in response headers when limits are approached.

---

## Getting an API Key

Contact the Swarm team or use the admin dashboard to generate an API key.

---

## Support

- **Documentation:** https://docs.rati.chat
- **Discord:** https://discord.gg/swarm
- **Issues:** https://github.com/atimics/aws-swarm/issues
