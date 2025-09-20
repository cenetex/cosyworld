# Memory v2 — Durable, Queryable Avatar Memory

Goal: Give avatars durable, queryable, and size-bounded memory using vector search and summarization—without blowing up Mongo or latency.

## Architecture

- EmbeddingService (provider-agnostic)
  - Providers: google, openrouter; fallback: local hash-embeddings
  - In-memory SHA1 cache for cost control
- Storage: MongoDB collection `memories`
  - Schema
    - avatarId: ObjectId|string
    - guildId: string|null
    - ts: Date
    - kind: 'chat'|'event'|'fact'|'summary'
    - text: string
    - embedding: number[]
    - weight: number (default 1.0)
  - Indexes
    - { avatarId: 1, ts: -1 }
    - Optional Atlas Vector Search index on `embedding`
- Read/Write API (MemoryService)
  - write(): embed + insert + cap enforcement (drop oldest low-weight)
  - query(): embed + vector/top-k retrieval + recency/weight scoring
  - getMemories(): compatibility wrapper used by PromptService
- Nightly summarization + pruning (SchedulingService task)
  - Summarize oldest low-weight memories into 1–2 sentence summaries
  - Replace originals with a single boosted-weight summary
  - Apply time-decay: weight *= DECAY_RATE^(weeks)

## Flow

Write path
1) Embed text -> vector
2) Insert { avatarId, guildId, ts, kind, text, embedding, weight: 1.0 }
3) Enforce MEMORY_MAX_ITEMS per avatar by dropping lowest weight, oldest first

Read path
1) Embed query text
2) Vector search top-k for avatarId
3) Optional minWeight filter + recency bias.

Summarization
1) For each avatar: fetch oldest N low-weight memories
2) Summarize via cheap model into 1–2 sentences
3) Replace originals with one summary doc (kind:'summary', weight boosted)
4) Apply decay

## Config

Environment (see .env.example):
- MEMORY_V2_ENABLED=true
- MEMORY_PROVIDER=google|openrouter|local
- EMBEDDING_MODEL=text-embedding-004|text-embedding-3-small|nomic-embed-text
- MEMORY_MAX_ITEMS=500
- MEMORY_TOPK=12
- MEMORY_DECAY_RATE=0.95  # per week

## Mongo Index

Minimum:
- db.memories.createIndex({ avatarId: 1, ts: -1 })

Optional (Atlas Vector Search):
- Create Search index with vector field `embedding` (numDimensions per model)

## Rollback

- MEMORY_V2_ENABLED=false returns to v1 behavior
- Migration script keeps original docs; summaries write as new docs with kind:'summary'
