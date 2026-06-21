/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file src/services/web/server/routes/cosyworld.js
 * @description Web-native MUD chat prototype where locations are channels.
 */

import express from 'express';

const LOCATION_ID = 'cosy-cottage';
const MAX_MESSAGES = 120;
const AI_REPLY_TIMEOUT_MS = 4500;
const CANONICAL_RUNTIME = 'v2/orchestrator-rust';
const LEGACY_ROUTE_STATUS = Object.freeze({
  status: 'legacy',
  canonicalRuntime: CANONICAL_RUNTIME,
  note:
    'This Node route is a compatibility prototype. CosyWorld gameplay truth lives in the V2 C/Rust orchestrator.',
});

const location = Object.freeze({
  id: LOCATION_ID,
  slug: LOCATION_ID,
  channelName: '#cosy-cottage',
  name: 'The Cosy Cottage',
  imageUrl: '/images/cosy-cottage.png',
  description:
    'A firelit cottage with rain-soft windows, shelves of storybooks, and a low doorway waiting for future paths.',
  exits: [],
});

const startingAvatars = Object.freeze([
  {
    id: 'rati',
    name: 'Rati',
    species: 'Mouse',
    role: 'Keeper of Scarves',
    icon: 'R',
    color: '#f0b36a',
    locationId: LOCATION_ID,
    status: 'Knitting by the hearth',
    prompt: 'A mouse fond of knitting scarves and telling stories.',
  },
  {
    id: 'whiskerwind',
    name: 'Whiskerwind',
    species: 'Wind-spirit',
    role: 'Emoji Oracle',
    icon: 'W',
    color: '#6fc6b1',
    locationId: LOCATION_ID,
    status: 'Speaking in symbols',
    prompt: 'Only speaks using emoji.',
  },
  {
    id: 'skull',
    name: 'Skull',
    species: 'Wolf',
    role: 'Silent Watcher',
    icon: 'S',
    color: '#9ba7b4',
    locationId: LOCATION_ID,
    status: 'Watching the door',
    prompt: 'A silent wolf who communicates by action.',
  },
]);

let messageSequence = 1;
const avatars = startingAvatars.map((avatar) => ({ ...avatar }));
const messages = [
  createMessage({
    authorName: location.name,
    authorType: 'location',
    kind: 'system',
    content:
      'Rain needles softly against the windows. The hearth is awake, the kettle is nearly singing, and The Cosy Cottage is open.',
  }),
  createMessage({
    authorId: 'rati',
    authorName: 'Rati',
    authorType: 'avatar',
    kind: 'speech',
    content:
      'I have a blue scarf on the needles and half a story in my pocket. Come in before the rain learns your name.',
  }),
  createMessage({
    authorId: 'whiskerwind',
    authorName: 'Whiskerwind',
    authorType: 'avatar',
    kind: 'speech',
    content: '🏡🔥🧶✨',
  }),
  createMessage({
    authorId: 'skull',
    authorName: 'Skull',
    authorType: 'avatar',
    kind: 'emote',
    content: 'Skull settles near the hearth and listens without a word.',
  }),
];

function createMessage({
  authorId = null,
  authorName,
  authorType = 'system',
  kind = 'speech',
  content,
  locationId = LOCATION_ID,
}) {
  return {
    id: `cw-${messageSequence++}`,
    locationId,
    authorId,
    authorName,
    authorType,
    kind,
    content,
    createdAt: new Date().toISOString(),
  };
}

function sanitize(value, maxLength = 1200) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function trimMessages() {
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }
}

function buildState() {
  return {
    server: {
      name: 'CosyWorld',
      mode: 'legacy-node-prototype',
      deprecated: true,
      canonicalRuntime: CANONICAL_RUNTIME,
      clientAuthoredSpeech: true,
      v2Contract: {
        serverAuthoredChat: true,
        clientAuthoredSpeech: false,
        primaryActionModel: 'one-button-world-command',
      },
      startedAt: messages[0]?.createdAt,
    },
    legacy: LEGACY_ROUTE_STATUS,
    activeLocationId: LOCATION_ID,
    locations: [location],
    avatars,
    messages: messages.slice(-MAX_MESSAGES),
  };
}

function selectAIService(services = {}) {
  return (
    services.unifiedAIService ||
    services.openRouterAIService ||
    services.googleAIService ||
    services.aiService ||
    null
  );
}

function normalizeAIText(response) {
  if (!response) return '';
  if (typeof response === 'string') return response;
  if (typeof response.text === 'string') return response.text;
  if (typeof response.content === 'string') return response.content;
  if (typeof response.response === 'string') return response.response;
  return '';
}

function cleanRatiReply(text) {
  return sanitize(text, 360)
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^rati\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('AI reply timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateRatiReply(content, services, logger) {
  const ai = selectAIService(services);
  if (ai?.chat) {
    try {
      const recentLog = messages
        .slice(-8)
        .map((message) => `${message.authorName}: ${message.content}`)
        .join('\n');

      const result = await withTimeout(
        ai.chat(
          [
            {
              role: 'system',
              content:
                'You are Rati, a small mouse in a cozy fantasy MUD channel called The Cosy Cottage. You knit scarves, tell stories, and welcome travelers. Reply as Rati only, in first person, under 45 words. Do not write for Whiskerwind or Skull.',
            },
            {
              role: 'user',
              content: `Recent room log:\n${recentLog}\n\nA traveler says: ${content}`,
            },
          ],
          {
            temperature: 0.8,
            max_tokens: 90,
            maxOutputTokens: 110,
            returnEnvelope: false,
          }
        ),
        AI_REPLY_TIMEOUT_MS
      );

      const reply = cleanRatiReply(normalizeAIText(result));
      if (reply) return reply;
    } catch (error) {
      logger?.debug?.(`[CosyWorld] Falling back from AI reply: ${error.message}`);
    }
  }

  return fallbackRatiReply(content);
}

function fallbackRatiReply(content) {
  const lower = content.toLowerCase();
  if (/\b(story|tale|quest|adventure|rumor)\b/.test(lower)) {
    return 'A story, then: every road begins as a loose thread. Tug gently, and it may become a scarf, a map, or trouble.';
  }
  if (/\b(door|exit|leave|travel|move|road)\b/.test(lower)) {
    return 'That doorway has been listening all evening. When another location opens, I suspect it will creak before it speaks.';
  }
  if (/\b(hello|hi|hey|greetings)\b/.test(lower)) {
    return 'Welcome in. I saved the chair nearest the fire, though Skull may pretend it was his idea.';
  }
  if (/\b(scarf|knit|knitting|yarn)\b/.test(lower)) {
    return 'This scarf is for anyone who has crossed too much rain. I am adding a brave little stripe for tonight.';
  }
  if (/\b(look|where|place|cottage|room)\b/.test(lower)) {
    return 'The cottage is small, but it keeps its corners deep. Hearth, table, bookshelves, kettle, and one patient doorway.';
  }
  if (/\b(skull|wolf)\b/.test(lower)) {
    return 'Skull says more with one ear than most knights manage with a trumpet. I trust his silences.';
  }
  if (/\b(whiskerwind|emoji)\b/.test(lower)) {
    return 'Whiskerwind speaks in sparks and weather. I recommend listening with the part of your heart that understands soup.';
  }
  return 'I loop that thought around one needle, then the other. Tell me one more detail and I will see what pattern appears.';
}

function emojiReply(content) {
  const lower = content.toLowerCase();
  if (/\b(story|tale|quest|adventure|rumor)\b/.test(lower)) return '📖🧭✨🔥';
  if (/\b(door|exit|leave|travel|move|road)\b/.test(lower)) return '🚪🌧️🧭';
  if (/\b(hello|hi|hey|greetings)\b/.test(lower)) return '👋🏡✨';
  if (/\b(scarf|knit|knitting|yarn)\b/.test(lower)) return '🧶🧣💫';
  if (/\b(tea|kettle|food|soup|hungry)\b/.test(lower)) return '☕🥣🔥😊';
  if (/\b(skull|wolf|danger|fight|battle)\b/.test(lower)) return '🐺🛡️👀';
  if (/\?/.test(content)) return '🤔✨👂';
  return '🍃✨🏡';
}

function skullEmote(content) {
  const lower = content.toLowerCase();
  if (/\b(danger|fight|battle|attack|enemy)\b/.test(lower)) {
    return 'Skull rises and places himself between the hearth and the door.';
  }
  if (/\b(leave|travel|move|road|door)\b/.test(lower)) {
    return 'Skull glances toward the low doorway, then back to the room.';
  }
  if (/\b(hello|hi|hey|greetings)\b/.test(lower)) {
    return 'Skull gives one slow nod from the warm stones by the fire.';
  }
  return "Skull's ears tilt toward the speaker; the rest of him remains still.";
}

async function generateAvatarReplies(content, services, logger) {
  const ratiReply = await generateRatiReply(content, services, logger);
  return [
    createMessage({
      authorId: 'rati',
      authorName: 'Rati',
      authorType: 'avatar',
      kind: 'speech',
      content: ratiReply,
    }),
    createMessage({
      authorId: 'whiskerwind',
      authorName: 'Whiskerwind',
      authorType: 'avatar',
      kind: 'speech',
      content: emojiReply(content),
    }),
    createMessage({
      authorId: 'skull',
      authorName: 'Skull',
      authorType: 'avatar',
      kind: 'emote',
      content: skullEmote(content),
    }),
  ];
}

export default function createCosyWorldRoutes(services = {}) {
  const router = express.Router();
  const logger = services.logger || console;

  router.use((req, res, next) => {
    res.setHeader('X-CosyWorld-Runtime', 'legacy-node-prototype');
    res.setHeader('X-CosyWorld-Canonical-Runtime', CANONICAL_RUNTIME);
    next();
  });

  router.get('/state', (req, res) => {
    res.json(buildState());
  });

  router.post('/messages', async (req, res) => {
    try {
      const content = sanitize(req.body?.content);
      const senderName = sanitize(req.body?.senderName || 'Traveler', 40) || 'Traveler';

      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      const playerMessage = createMessage({
        authorName: senderName,
        authorType: 'player',
        kind: 'speech',
        content,
      });

      messages.push(playerMessage);
      const replies = await generateAvatarReplies(content, services, logger);
      messages.push(...replies);
      trimMessages();

      return res.status(201).json({
        message: playerMessage,
        replies,
        state: buildState(),
      });
    } catch (error) {
      logger?.error?.('[CosyWorld] Failed to post message:', error);
      return res.status(500).json({ error: 'Failed to post message' });
    }
  });

  router.post('/move', (req, res) => {
    const avatarId = sanitize(req.body?.avatarId, 80);
    const nextLocationId = sanitize(req.body?.locationId || LOCATION_ID, 80);
    const avatar = avatars.find((entry) => entry.id === avatarId);

    if (!avatar) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    if (nextLocationId !== LOCATION_ID) {
      return res.status(400).json({
        error: 'Unknown location',
        availableLocations: [location],
      });
    }

    avatar.locationId = LOCATION_ID;
    const movement = createMessage({
      authorName: location.name,
      authorType: 'location',
      kind: 'system',
      content: `${avatar.name} remains in ${location.name}. The other paths have not opened yet.`,
    });
    messages.push(movement);
    trimMessages();

    return res.json({
      movement,
      state: buildState(),
    });
  });

  return router;
}
