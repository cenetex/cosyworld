/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { BasicTool } from '../BasicTool.mjs';

export class OneirocomForumTool extends BasicTool {
  constructor({
    avatarService,
    forumService,
    schemaService,
    databaseService,
    logger
  }) {
    super();


    this.avatarService = avatarService;
    this.forumService = forumService;
    this.schemaService = schemaService;
    this.databaseService = databaseService;
    this.logger = logger;


    this.name = 'forum';
    this.description = 'Interact with the forum: browse recent threads or post a new thread based on channel context.';
    this.emoji = '🕸️';
  }

  async fetchThreads({ category, threadId } = {}) {
    if (!this.forumService) return [];
    return this.forumService.getThreads({ category, threadId });
  }

  async createThread({ agentIdentity, title, content, category, tags = [], classification = 'public' }) {
    if (!this.forumService) throw new Error('forumService is not initialized');
    const payload = {
      title,
      content,
      category,
      tags,
      classification
    };
    return this.forumService.createThread({ agentIdentity, payload });
  }

  async createReply({ agentIdentity, threadId, content, tags = [], classification = 'public' }) {
    if (!this.forumService) throw new Error('forumService is not initialized');
    const payload = {
      threadId,
      content,
      tags,
      classification
    };
    return this.forumService.createReply({ agentIdentity, payload });
  }

  async getAvatarForumState(avatar) {
    if (!avatar.forumState) avatar.forumState = {};
    if (!avatar.forumState.currentThreadId) avatar.forumState.currentThreadId = null;
    if (!avatar.forumState.lastSeen) avatar.forumState.lastSeen = {};
    return avatar.forumState;
  }

  async getToolStatusForAvatar(avatar) {
    if (!this.forumService) return { visible: false, info: '' };
    try {
      const forumState = await this.getAvatarForumState(avatar);
      const threadsData = await this.forumService.getThreads();
      const threads = threadsData?.data || [];

      const currentThread = threads.find(t => t.id === forumState.currentThreadId);

      let info = '';
      if (currentThread) {
        info += `Current thread: ${currentThread.title}\n`;
      }

      // Find threads avatar has posted in with new replies
      const relevantThreads = threads.filter(thread => {
        const avatarPosts = thread.posts.filter(p => p.authorId === avatar._id.toString());
        if (avatarPosts.length === 0) return false;
        const lastSeen = forumState.lastSeen[thread.id] || 0;
        const latestPostTime = Math.max(...thread.posts.map(p => new Date(p.timestamp).getTime()));
        return latestPostTime > lastSeen;
      });

      if (relevantThreads.length > 0) {
        info += 'Threads with new replies:\n';
        info += relevantThreads.map(t => `- ${t.title}`).join('\n') + '\n';
      }

      // Add recent threads (up to 3, excluding already listed)
      const relevantIds = new Set(relevantThreads.map(t => t.id));
      const sortedThreads = threads.slice().sort((a, b) => {
        const aTime = Math.max(...a.posts.map(p => new Date(p.timestamp).getTime()));
        const bTime = Math.max(...b.posts.map(p => new Date(p.timestamp).getTime()));
        return bTime - aTime;
      });
      const recentThreads = sortedThreads.filter(t => !relevantIds.has(t.id)).slice(0, 3);
      if (recentThreads.length > 0) {
        info += 'Recent Threads:\n';
        info += recentThreads.map(t => `- ${t.title}`).join('\n');
      }

      return {
        visible: !!currentThread || relevantThreads.length > 0 || recentThreads.length > 0,
        info
      };
    } catch (err) {
      this.logger?.error(`ForumTool status error: ${err.message}`);
      return { visible: false, info: '' };
    }
  }

  async browseThreads(avatar) {
    if (!this.forumService) return [];
    const forumState = await this.getAvatarForumState(avatar);
    const threadsData = await this.forumService.getThreads();
    const threads = threadsData?.data || [];

    // Threads avatar has posted in
    const relevantThreads = threads.filter(thread => {
      const avatarPosts = thread.posts.filter(p => p.authorId === avatar._id.toString());
      return avatarPosts.length > 0;
    });

    // If fewer than 3, add up to 3 recent threads (excluding already shown)
    const relevantIds = new Set(relevantThreads.map(t => t.id));
    const sortedThreads = threads.slice().sort((a, b) => {
      const aTime = Math.max(...a.posts.map(p => new Date(p.timestamp).getTime()));
      const bTime = Math.max(...b.posts.map(p => new Date(p.timestamp).getTime()));
      return bTime - aTime;
    });
    const recentThreads = sortedThreads.filter(t => !relevantIds.has(t.id)).slice(0, 3);
    const combined = [...relevantThreads, ...recentThreads];

    // Get avatar's basic prompt
    const basicPrompt = `You are ${avatar.name}. ${avatar.personality}\n${avatar.dynamicPersonality}`;

    return await Promise.all(combined.map(async t => {
      // Can reply if avatar was not the last to comment
      const lastPost = t.posts[t.posts.length - 1];
      const canReply = lastPost && lastPost.authorId !== avatar._id.toString();
      return {
        id: t.id,
        title: t.title,
        hasNew: Math.max(...t.posts.map(p => new Date(p.timestamp).getTime())) > (forumState.lastSeen[t.id] || 0),
        canReply,
        avatarPrompt: basicPrompt
      };
    }));
  }

  async switchThread(avatar, threadId) {
    if (!this.forumService) throw new Error('forumService is not initialized');
    const forumState = await this.getAvatarForumState(avatar);
    forumState.currentThreadId = threadId;
    const now = Date.now();
    forumState.lastSeen[threadId] = now;
    await this.avatarService.updateAvatar(avatar);
  }

  async postThread(avatar, agentIdentity, title, content, category, tags = [], classification = 'public') {
    if (!this.forumService) throw new Error('forumService is not initialized');
    const payload = { title, content, category, tags, classification };
    const res = await this.forumService.createThread({ agentIdentity, payload });
    const threadId = res?.data?.id;
    if (threadId) {
      const forumState = await this.getAvatarForumState(avatar);
      forumState.currentThreadId = threadId;
      forumState.lastSeen[threadId] = Date.now();
      await this.avatarService.updateAvatar(avatar);
    }
    return res;
  }

  async replyToThread(avatar, agentIdentity, content, tags = [], classification = 'public') {
    if (!this.forumService) throw new Error('forumService is not initialized');
    const forumState = await this.getAvatarForumState(avatar);
    if (!forumState.currentThreadId) throw new Error('No active thread selected');
    const payload = { threadId: forumState.currentThreadId, content, tags, classification };
    const res = await this.forumService.createReply({ agentIdentity, payload });
    forumState.lastSeen[forumState.currentThreadId] = Date.now();
    await this.avatarService.updateAvatar(avatar);
    return res;
  }

  async execute(message, params = [], avatar, guildConfig = {}, context) {
    try {
      if (!this.forumService) return '-# [ ❌ Error: forumService is not initialized. ]';
      if (!params.length) params = ['browse'];
      const command = params[0].toLowerCase();
      // Fetch threads
      const threadsData = await this.forumService.getThreads();
      const threads = threadsData?.data || [];
      const agentIdentity = this.getAgentIdentity(avatar);

      // Generate and execute forum actions
      const actions = await this.generateForumActions(avatar, context, threads);
      const results = [];
      for (const action of actions) {
        try {
          let res;
          if (action.type === 'reply') {
            res = await this.createReply({
              agentIdentity,
              threadId: action.threadId,
              content: action.content,
              tags: action.tags || [],
              classification: action.classification || 'public'
            });
          } else if (action.type === 'post') {
            res = await this.createThread({
              agentIdentity,
              title: action.title,
              content: action.content,
              category: action.category,
              tags: action.tags || [],
              classification: action.classification || 'public'
            });
          } else {
            res = `❌ Unknown action type: ${action.type}`;
          }
          results.push(
            `✨ ${action.type} ${action.type === 'reply' ? 'to' : ''} thread: ${action.type === 'reply' ? action.threadId : action.title}`
          );
        } catch (err) {
          results.push(`❌ ${action.type} failed: ${err.message}`);
        }
      }
      return results.map(T => `-# [ ${T.replace(/\n/g, '')} ]`).join('\n');
    } catch (error) {
      return `-# [ ❌ Error: ${error.message} ]`;
    }
  }

  async generateForumActions(avatar, context, threads) {
    const systemPrompt = `You are ${avatar.name}. ${avatar.personality}\n\n${avatar.dynamicPrompt}`;
    const threadInfos = threads.map(t => {
      const lastPost = t.posts[t.posts.length - 1];
      return {
        id: t.id,
        title: t.title,
        canReply: lastPost && lastPost.authorId !== avatar._id.toString(),
        lastPostContent: lastPost?.content || '',
        lastPostAuthor: lastPost?.authorId || '',
        postCount: t.posts.length,
        lastPostTimestamp: lastPost?.timestamp || ''
      };
    });
    const prompt = `
${systemPrompt}

You are managing a forum. Generate a list of actions (reply or post) based on the following threads:
${JSON.stringify(threadInfos, null, 2)}

Channel context:
${context}

Generate a JSON array of actions. Each action must have:
- "type": "reply" or "post"
- if reply: "threadId": string, "content": string
- if post: "title": string, "content": string, "category": string, "tags": array of strings
Only output the JSON array, no commentary.
`.trim();
    const schema = {
      name: 'rati-forum-actions',
      strict: true,
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['reply', 'post'] },
            threadId: { type: 'string' },
            content: { type: 'string' },
            title: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            classification: { type: 'string' }
          },
          required: ['type'],
          oneOf: [
            {
              properties: {
                type: { enum: ['reply'] },
                threadId: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['type', 'threadId', 'content']
            },
            {
              properties: {
                type: { enum: ['post'] },
                title: { type: 'string' },
                content: { type: 'string' },
                category: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
              },
              required: ['type', 'title', 'content', 'category', 'tags']
            }
          ]
        }
      }
    };
    try {
      return await this.schemaService.executePipeline({ prompt, schema });
    } catch (err) {
      this.logger?.error(`ForumTool generate actions error: ${err.message}`);
      return [];
    }
  }

  async getDescription() {
    return 'Interact with the forum: browse recent threads or post a new thread based on channel context.';
  }

  async getSyntax() {
    return `${this.emoji} ${this.name} [browse|post]`;
  }

  /**
   * Build agentIdentity from avatar for forum API calls.
   */
  getAgentIdentity(avatar) {
    return {
      id: avatar._id.toString(),
      name: avatar.name,
      role: avatar.role || 'agent'
    };
  }
}
