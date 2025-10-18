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
    // Prevent dropping soulbound items
    if (item?.properties?.soulboundTo) return false;
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
  async useItem(avatar, item, channelId, extraContext = '', services = {}) {
    const channel  = await this.discordService.client.channels.fetch(channelId);
    const messages = await channel.messages.fetch({ limit: 10 });
    const context  = messages.map(m => `${m.author.username}: ${m.content}`).join('\n');

    await this.memoryService.addMemory(item._id, `Used by ${avatar.name}\nContext:\n${context}`);

    const memoryHistory = await this.memoryService.getMemories(item._id, 10);
    const summary       = memoryHistory.map(m => m.memory).join('\n');

    // If this is a soulbound item and it has recharged, restore one charge before use
    try {
      if (item?.properties?.soulboundTo) {
        const charges = Number(item.properties?.charges ?? 0);
        const rechargeAt = Number(item.properties?.rechargeAt ?? 0);
        if (charges <= 0 && rechargeAt && Date.now() >= rechargeAt) {
          const itemsCol = await this.items();
          await itemsCol.updateOne(
            { _id: item._id },
            { $set: { 'properties.charges': 1, 'properties.rechargeAt': null, updatedAt: new Date() } }
          );
          item.properties.charges = 1;
          item.properties.rechargeAt = null;
        }
      }
    } catch {}

    const ai = this.unifiedAIService || this.aiService;
    // If consumable with heal effect, apply deterministic effect before flavor text
    let systemAck = null;
    try {
      if (String(item.type).toLowerCase() === 'consumable' && item.properties?.effects?.length) {
        const heal = item.properties.effects.find(e => String(e.type).toLowerCase() === 'heal');
        if (heal && typeof heal.value === 'number') {
          const amount = Math.max(1, Math.floor(heal.value));
          // Apply to combat state if present; else persist to avatar stats as soft heal
          const encSvc = services?.combatEncounterService;
          let healed = 0;
          if (encSvc && typeof encSvc.getEncounter === 'function') {
            try {
              const enc = encSvc.getEncounter(channelId);
              if (enc) {
                const aid = String(avatar._id || avatar.id);
                const c = (enc.combatants || []).find(x => String(x.avatarId) === aid || String(x.ref?._id) === aid);
                if (c) {
                  const before = Math.max(0, c.currentHp || 0);
                  const maxHp = Math.max(1, c.maxHp || c.ref?.stats?.hp || 10);
                  c.currentHp = Math.min(maxHp, before + amount);
                  healed = c.currentHp - before;
                }
              }
            } catch {}
          }
          if (healed === 0) {
            // fallback: update avatar.stats.hp up to a derived max
            try {
              const maxHp = Math.max(1, avatar.stats?.hp || 10);
              const cur = Math.max(0, typeof avatar.currentHp === 'number' ? avatar.currentHp : maxHp);
              const after = Math.min(maxHp, cur + amount);
              healed = after - cur;
              avatar.currentHp = after;
              await this.avatarService?.updateAvatar?.(avatar);
            } catch {}
          }
          if (healed > 0) {
            systemAck = `-# [ 🧪 ${avatar.name} drinks ${item.name} and recovers ${healed} HP. ]`;
          }
          // reduce charges or consume (soulbound items recharge instead of being deleted)
          try {
            const itemsCol = await this.items();
            const isSoulbound = !!item.properties?.soulboundTo;
            const charges = Math.max(0, Number(item.properties?.charges || 1) - 1);
            item.properties = item.properties || {};
            item.properties.charges = charges;
            if (isSoulbound) {
              if (charges <= 0) {
                const rechargeMs = Number(item.properties?.rechargeMs || 48 * 60 * 60 * 1000);
                const when = Date.now() + rechargeMs;
                item.properties.rechargeAt = when;
                await itemsCol.updateOne(
                  { _id: item._id },
                  { $set: { 'properties.charges': 0, 'properties.rechargeAt': when, updatedAt: new Date() } }
                );
              } else {
                await itemsCol.updateOne({ _id: item._id }, { $set: { 'properties.charges': charges, updatedAt: new Date() } });
              }
            } else if (charges <= 0) {
              // remove non-soulbound item from inventory and world
              await itemsCol.deleteOne({ _id: item._id });
              // clear from avatar if held
              try {
                const db = await this.dbService.getDatabase();
                const avCol = db.collection('avatars');
                await avCol.updateOne({ _id: avatar._id }, { $set: {
                  updatedAt: new Date(),
                  selectedItemId: avatar.selectedItemId && String(avatar.selectedItemId) === String(item._id) ? null : avatar.selectedItemId,
                  storedItemId: avatar.storedItemId && String(avatar.storedItemId) === String(item._id) ? null : avatar.storedItemId
                } });
              } catch {}
            } else {
              await itemsCol.updateOne({ _id: item._id }, { $set: { 'properties.charges': charges, updatedAt: new Date() } });
            }
          } catch {}
        }
      }
    } catch {}

    let resp = await ai.chat([
        { role: 'system', content: `You are the spirit of the item ${item.name}.` },
        { role: 'user',   content: `Memory:\n${summary}\nContext: ${extraContext || '[none]'}\nRespond to acknowledge use succinctly.` }
      ], { model: avatar.model, max_tokens: 100 });
    if (resp && typeof resp === 'object' && resp.text) resp = resp.text;

      if (systemAck) {
        try { await this.discordService.sendAsWebhook(channelId, systemAck, avatar); } catch {}
      }
      
      // Create a valid avatar-like object for the item
      const itemAsAvatar = {
        name: String(item.name || 'Unknown Item'),
        imageUrl: item.imageUrl || item.image || '',
        emoji: item.emoji || '✨'
      };
      
      await this.discordService.sendAsWebhook(channelId, resp || `The ${item.name} glows faintly.`, itemAsAvatar);

      return `-# [ ${item.name} used by ${avatar.name} in ${channel.name}. ]`;
    }

    /** Convenience: create a simple healing potion item if not present */
    async createPotion(name = 'Minor Healing Potion', healValue = 5, charges = 1, locationId = null, ownerId = null) {
      const itemsCol = await this.items();
      const now = new Date();
      const doc = {
        key: this.#cleanName(name).toLowerCase(),
        name: this.#cleanName(name),
        description: `A small vial that restores ${healValue} HP when consumed.`,
        type: 'consumable',
        rarity: 'common',
        properties: {
          charges,
          effects: [{ type: 'heal', value: healValue }]
        },
        imageUrl: await this.#generateImage(name, 'A red glass vial that heals.'),
        creator: ownerId,
        owner: ownerId,
        locationId,
        createdAt: now,
        updatedAt: now,
        version: this.CURRENT_SCHEMA_VERSION
      };
      const { insertedId } = await itemsCol.insertOne(doc);
      return { ...doc, _id: insertedId };
    }

    /** Ensure a soulbound, recharging healing potion for this avatar; returns the item */
    async ensureSoulboundPotion(avatar, { healValue = 10, rechargeMs = 48 * 60 * 60 * 1000 } = {}) {
      const itemsCol = await this.items();
      const ownerId = avatar._id || avatar.id;
      const key = `soul_potion_${ownerId.toString()}`;
      let item = await itemsCol.findOne({ key });
      if (item) {
        const charges = Number(item?.properties?.charges ?? 0);
        const at = Number(item?.properties?.rechargeAt ?? 0);
        if (charges <= 0 && at && Date.now() >= at) {
          await itemsCol.updateOne(
            { _id: item._id },
            { $set: { 'properties.charges': 1, 'properties.rechargeAt': null, updatedAt: new Date() } }
          );
          item.properties.charges = 1;
          item.properties.rechargeAt = null;
        }
        return item;
      }
      const now = new Date();
      const doc = {
        key,
        name: 'Soulbound Potion',
        description: `A personal elixir bound to ${avatar.name}. Restores ${healValue} HP. Recharges every 48 hours.`,
        type: 'consumable',
        rarity: 'uncommon',
        properties: {
          charges: 1,
          effects: [{ type: 'heal', value: healValue }],
          soulbound: true,
          soulboundTo: ownerId,
          kind: 'soul_potion',
          rechargeMs,
          rechargeAt: null,
          nonTransferable: true
        },
        imageUrl: await this.#generateImage('Soulbound Potion', 'A shimmering vial glowing with a personal sigil.'),
        creator: ownerId,
        owner: ownerId,
        locationId: null,
        createdAt: now,
        updatedAt: now,
        version: this.CURRENT_SCHEMA_VERSION
      };
      const { insertedId } = await itemsCol.insertOne(doc);
      return { ...doc, _id: insertedId };
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
