/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// services/entity/itemService.mjs
import { ObjectId } from 'mongodb';
import { SchemaValidator } from '../../utils/schemaValidator.mjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * ItemService
 * Handles creation, lookup, ownership, crafting, and metadata of items.
 * Dependencies are injected by Awilix (CLASSIC mode).
 */
export class ItemService {
  /*─────────────────────────  Constructor  ─────────────────────────*/
  constructor({
    logger,
    schemaService,
    databaseService,
    discordService,
    configService,
    memoryService,
    aiService
  }) {
    /* keep a reference to every dependency */
    Object.assign(this, {
      logger: logger ?? console,
      schemaService,
      dbService: databaseService,
      discordService,
      configService,
      memoryService,
      aiService
    });

    this.itemCreationLimit      = 8;
    this.CURRENT_SCHEMA_VERSION = '1.0.0';
    this.schemaValidator        = new SchemaValidator();
  }

  /*──────────────────────  Private DB helpers  ─────────────────────*/
  #items;          // cached Mongo collection

  async items() {
    if (!this.#items) {
      const db = await this.dbService.getDatabase();
      if (!db) throw new Error('Database connection unavailable');
      this.#items = db.collection('items');
      await this.#ensureIndexes();
    }
    return this.#items;
  }

  async #ensureIndexes() {
    //await this.#items.createIndex({ uuid: 1 }, { unique: true }); // Ensure UUID uniqueness
    await this.#items.createIndex({ owner: 1 });
    await this.#items.createIndex({ locationId: 1 });
  }

  /*─────────────────────────  Small helpers  ───────────────────────*/
  #cleanName = str => str.replace(/['"]/g, '').trim().slice(0, 50);
  #allowedTypes = ['weapon', 'armor', 'consumable', 'quest', 'key', 'artifact'];
  #rarities     = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  #today() { const d = new Date(); d.setHours(0,0,0,0); return d; }

  /*──────────────────────  Generation helpers  ─────────────────────*/
  async #generateImage(name, desc) {
    return this.schemaService.generateImage(`${name}: ${desc}`, '1:1');
  }

  async #executePipeline(prompt, schema) {
    return this.schemaService.executePipeline({ prompt, schema })
      .catch(err => { this.logger.error(err); return null; });
  }

  /*────────────────────────  Core methods  ─────────────────────────*/

  /**
   * Finds an item by key or creates it via LLM pipeline.
   */
  async findOrCreateItem(name, locationId) {
    const items = await this.items();

    // Per-day creation guard
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const created = await items.countDocuments({ createdAt: { $gte: today } });
    if (created >= this.itemCreationLimit) return null;

    // Use schemaService pipeline to generate fresh item
    const prompt = `Generate item JSON for fantasy game: "${name}" …`;
    const itemSchema = {/* …same schema as before… */};

    const data = await this.schemaService.executePipeline({ prompt, schema: itemSchema })
      .catch(e => { this.logger.error(e); return null; });
    if (!data) return null;

    const cleanName = this.#cleanName(data.name);
    const imageUrl = await this.schemaService.generateImage(
      `${cleanName}: ${data.description}`, '1:1'
    );

    const now = new Date();
    const newItem = {
      uuid: uuidv4(), // Generate a unique identifier
      name: cleanName,
      description: data.description.trim(),
      type: this.#allowedTypes.includes(data.type) ? data.type : 'artifact',
      rarity: data.rarity,
      properties: data.properties ?? {},
      imageUrl,
      owner: null,
      locationId,
      createdAt: now,
      updatedAt: now,
      version: this.CURRENT_SCHEMA_VERSION
    };

    const { insertedId } = await items.insertOne(newItem);
    newItem._id = insertedId;
    return newItem;
  }

  /** Fetch item by id (string or ObjectId) */
  async getItem(id) {
    const objId = typeof id === 'string' ? new ObjectId(id) : id;
    return (await this.items()).findOne({ _id: objId });
  }

  /** Assigns item ownership to avatar */
  async assignItemToAvatar(avatarId, item) {
    const res = await (await this.items()).updateOne(
      { _id: item._id },
      { $set: { owner: avatarId, locationId: null, updatedAt: new Date() } }
    );
    return res.modifiedCount > 0;
  }

  /** Drops item at location */
  async dropItem(_, item, locationId) {
    const res = await (await this.items()).updateOne(
      { _id: item._id },
      { $set: { owner: null, locationId, updatedAt: new Date() } }
    );
    return res.modifiedCount > 0;
  }

  /** Avatar takes item from location */
  async takeItem(avatar, itemName, locationId) {
    const itemsCol = await this.items();
    const item = await itemsCol.findOne({
      key: itemName.toLowerCase(), locationId, owner: null
    });
    if (!item) return null;
    return (await this.assignItemToAvatar(avatar._id, item))
      ? await itemsCol.findOne({ _id: item._id })
      : null;
  }

  /** Search loose items in location */
  async searchItems(locationId, query) {
    const regex = new RegExp(query, 'i');
    return (await this.items())
      .find({ locationId, owner: null, $or: [{ name: regex }, { description: regex }] })
      .toArray();
  }

  /*──────────────────────────  Use item  ──────────────────────────*/
  async useItem(avatar, item, channelId) {
    const channel  = await this.discordService.client.channels.fetch(channelId);
    const messages = await channel.messages.fetch({ limit: 10 });
    const context  = messages.map(m => `${m.author.username}: ${m.content}`).join('\n');

    await this.memoryService.addMemory(item._id, `Used by ${avatar.name}\nContext:\n${context}`);

    const memoryHistory = await this.memoryService.getMemories(item._id, 10);
    const summary       = memoryHistory.map(m => m.memory).join('\n');

    const resp = await this.aiService.chat([
      { role: 'system', content: `You are the spirit of the item ${item.name}.` },
      { role: 'user',   content: `Memory:\n${summary}\nRespond to acknowledge use.` }
    ], { model: avatar.model, max_tokens: 100 });

    await this.discordService.sendAsWebhook(
      channelId,
      resp || `The ${item.name} glows faintly.`,
      item
    );

    return `-# [ ${item.name} used by ${avatar.name} in ${channel.name}. ]`;
  }

  /*──────────────────── Crafting (combine items) ───────────────────*/
  async createCraftedItem(inputItems, creatorId) {
    const itemsCol = await this.items();
    if ((await itemsCol.countDocuments({ createdAt: { $gte: this.#today() } })) >= this.itemCreationLimit) return null;

    /* Ensure matching evolution level */
    const lvl = (inputItems[0].evolutionLevel || 1);
    if (inputItems.some(i => (i.evolutionLevel || 1) !== lvl)) return null;

    /* Roll rarity */
    const roll = Math.ceil(Math.random() * 20);
    if (roll === 1) {      // crit fail – burn one item
      await itemsCol.deleteOne({ _id: inputItems[0]._id });
      return null;
    }
    const rarity = roll === 20 ? 'legendary'
                 : roll >= 18 ? 'rare'
                 : roll >= 13 ? 'uncommon'
                 : 'common';

    /* Gen via LLM */
    const names  = inputItems.map(i => i.name).join(', ');
    const prompt = `Combine: ${names}. Output new level ${lvl+1} item JSON.`;
    const schema = {
      name: 'rati-item',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: this.#allowedTypes },
          rarity: { type: 'string', enum: this.#rarities },
          properties: { type: 'object' }
        },
        required: ['name','description','type','rarity','properties'],
        additionalProperties: false
      }
    };
    const data = await this.#executePipeline(prompt, schema);
    if (!data) return null;

    const cleanName = this.#cleanName(data.name);
    const imageUrl  = await this.#generateImage(cleanName, data.description);
    const now       = new Date();

    const newItem = {
      key: cleanName.toLowerCase(),
      name: cleanName,
      description: data.description.trim(),
      type: data.type,
      rarity,
      properties: data.properties ?? {},
      imageUrl,
      creator: creatorId,
      owner: creatorId,
      locationId: null,
      createdAt: now,
      updatedAt: now,
      version: this.CURRENT_SCHEMA_VERSION,
      evolutionLevel: lvl + 1,
      sourceItemIds: inputItems.map(i => i._id)
    };

    const { insertedId } = await itemsCol.insertOne(newItem);
    newItem._id = insertedId;

    // burn source items
    await itemsCol.deleteMany({ _id: { $in: inputItems.map(i => i._id) } });
    return newItem;
  }

  /*─────────────────────────  Metadata  ───────────────────────────*/
  generateRatiMetadata(item, storageUris = {}) {
    return {
      tokenId:    item._id.toString(),
      name:       item.name,
      description:item.description,
      media:      { image: item.imageUrl, video: item.videoUrl ?? null },
      attributes: [
        { trait_type: 'Type',   value: item.type },
        { trait_type: 'Rarity', value: item.rarity }
      ],
      signature: null,
      storage:   storageUris,
      evolution: {
        level: item.evolutionLevel ?? 1,
        previous: item.sourceItemIds ?? [],
        timestamp: item.updatedAt
      }
    };
  }

  /*──────────────────── misc convenience ───────────────────*/
  getItemsDescription(avatar) {
    return (avatar.items ?? []).map(i => i.name).join(', ');
  }

  /** optional explicit init if you don't trust lazy getter */
  async initializeDatabase() { await this.items(); }
}
