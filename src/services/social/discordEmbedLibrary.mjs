/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

function splitDescription(text) {
  if (!text) return { firstSentence: '', rest: '' };

  // Match the first sentence considering ellipses, multiple punctuation, and trailing quotes/parens
  const match = text.match(/([\s\S]*?[.!?]+(?:\.{2,}|[!?]+)?(?:['"”’)]*)\s*)([\s\S]*)/);

  if (!match) return { firstSentence: text.trim(), rest: '' };

  return {
    firstSentence: match[1].trim(),
    rest: match[2].trim()
  };
}

function buildViewButton(url, label = 'View Details') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

function buildProfileTriggerButton(id, label = 'View Full Profile', type = 'avatar') {
  const prefix = ['avatar', 'item', 'location'].includes(type) ? type : 'avatar';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`view_full_${prefix}_${id}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Build a sleek mini avatar embed for movement or notifications.
 */
export function buildMiniAvatarEmbed(avatar, message = '') {
  const text = message || `${avatar.name} has arrived!`;

  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const randomSentence = sentences[Math.floor(Math.random() * sentences.length)].trim();

  const { firstSentence, rest: _rest } = splitDescription(randomSentence);

  const embed = new EmbedBuilder()
    .setColor('#00b0f4')
    .setAuthor({ name: `${avatar.emoji || ''} ${avatar.name}`, iconURL: avatar.imageUrl })
    .setDescription(firstSentence)
    .setThumbnail(avatar.imageUrl)
    .setFooter({ text: 'Movement Update', iconURL: avatar.imageUrl });

  const button = buildProfileTriggerButton(avatar._id);
  return { embed, components: [button] };
}

/**
 * Build a sleek full avatar profile embed.
 * @param {Object} avatar - The avatar object
 * @param {Object} options - Additional options
 * @param {Object} [options.aiService] - Optional AI service instance with modelConfig
 */
export function buildFullAvatarEmbed(avatar, options = {}) {
  const aiService = options.aiService;

  let rarity = avatar.rarity;

  if ((!rarity || rarity === 'undefined') && aiService && avatar.model) {
    const modelEntry = aiService.modelConfig?.find(m => m.model === avatar.model);
    if (modelEntry) {
      rarity = modelEntry.rarity;
    }
  }

  rarity = rarity || 'undefined';

  const rarityColors = {
    legendary: '#FFD700',
    rare: '#1E90FF',
    uncommon: '#32CD32',
    common: '#A9A9A9',
    undefined: '#808080'
  };

  const color = rarityColors[rarity.toLowerCase()] || '#5865F2';

  const tierMap = { 
    legendary: 'S', 
    rare: 'A', 
    uncommon: 'B', 
    common: 'C',
    undefined: 'U' };
  const tier = tierMap[rarity.toLowerCase()] || 'U';

  const { firstSentence, rest: _rest } = splitDescription(avatar.short_description || avatar.description || 'No description.');

  const _url = options.viewDetailsUrl || `${process.env.BASE_URL}/avatar.html?id=${avatar._id}`;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${avatar.emoji || ''} ${avatar.name}`)
    .setDescription(firstSentence)
    .setThumbnail(avatar.imageUrl)
    .addFields(
      { name: 'Model', value: `${avatar.model} (Tier ${tier})` || 'N/A', inline: true },
      { name: 'Summonsday', value: avatar.summonsday || 'N/A', inline: true },
    )
    .setFooter({ text: `RATi Avatar: ${avatar.name}`, iconURL: avatar.imageUrl });

  if (avatar.stats) {
    const { strength, dexterity, constitution, intelligence, wisdom, charisma, hp } = avatar.stats;
    const conMod = Math.floor((constitution - 10) / 2);
    const maxHp = 10 + conMod;
    const dexMod = Math.floor((dexterity - 10) / 2);
    const ac = 10 + dexMod;
    const statsStr = `🛡️ AC ${ac}  ❤️ HP ${hp}/${maxHp}\n⚔️ ${strength} 🏃 ${dexterity} 🩸 ${constitution}\n🧠 ${intelligence} 🌟 ${wisdom} 💬 ${charisma}`;
    embed.addFields({ name: 'Stats', value: statsStr, inline: false });
  }

  if (avatar.inventory && avatar.inventory.length > 0) {
    const invList = avatar.inventory.map(i => `• ${i.name}`).join('\n');
    embed.addFields({ name: '🎒 Inventory', value: invList.length > 1000 ? invList.slice(0, 997) + '...' : invList, inline: false });
  }

  if (avatar.traits) {
    try {
      let traitStr = '';
      if (Array.isArray(avatar.traits)) {
        traitStr = avatar.traits.map(t => {
          if (typeof t === 'string') return t;
            if (!t) return '';
            const k = t.trait_type || t.type || t.key || t.name || 'Trait';
            const v = t.value || t.val || t.trait || t.name || '';
            return `${k}: ${v}`;
        }).filter(Boolean).join('\n');
      } else if (typeof avatar.traits === 'object') {
        traitStr = Object.entries(avatar.traits).map(([k,v]) => `${k}: ${v}`).join('\n');
      } else if (typeof avatar.traits === 'string') {
        traitStr = avatar.traits;
      }
      if (traitStr.length > 1024) traitStr = traitStr.slice(0, 1021) + '...';
      if (traitStr.trim()) embed.addFields({ name: '🧬 Traits', value: traitStr, inline: false });
  } catch {
      // swallow trait formatting errors
    }
  }

  if (avatar.nft) {
    const nftLines = [];
    if (avatar.nft.collection) nftLines.push(`Collection: ${avatar.nft.collection}`);
    if (avatar.nft.tokenId || avatar.nft.mint) nftLines.push(`Token: ${avatar.nft.tokenId || avatar.nft.mint}`);
    if (avatar.nft.chain) nftLines.push(`Chain: ${avatar.nft.chain}`);
    const nftVal = nftLines.join('\n') || 'NFT Linked';
    embed.addFields({ name: '📦 NFT', value: nftVal.slice(0, 1024), inline: true });
  }

  if (_rest) {
    embed.addFields({ name: 'More Info', value: _rest, inline: false });
  }

  const buttons = [];
  try {
    const mint = avatar?.nft?.mint || avatar?.nft?.tokenId || avatar?.nft?.id || avatar?.nft?.originalMint;
    const chain = (avatar?.nft?.chain || '').toLowerCase();
    if (chain === 'solana' && mint && typeof mint === 'string') {
      const meUrl = `https://magiceden.io/item-details/${mint}`;
      buttons.push(buildViewButton(meUrl, 'Magic Eden'));
    }
  } catch (_err) { /* ignore */ }

  // Intentionally no fallback internal link per new spec.
  return { embed, components: buttons };
}

/**
 * Build a sleek mini location embed.
 */
export function buildMiniLocationEmbed(location) {
  const rarityColors = { legendary: '#FFD700', rare: '#1E90FF', uncommon: '#32CD32', common: '#A9A9A9', undefined: '#808080' };
  const rarity = location.rarity || 'undefined';
  const color = rarityColors[rarity.toLowerCase()] || '#5865F2';
  const { firstSentence, rest: _rest2 } = splitDescription(location.description || 'No description.');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(location.name)
    .setDescription(firstSentence)
    .setImage(location.imageUrl)
    .setFooter({ text: 'Location Info' });

  const button = buildProfileTriggerButton(location._id, 'View Full Location', 'location');
  return { embed, components: [button] };
}

/**
 * Build a sleek full location embed.
 */
export function buildFullLocationEmbed(location, items = [], avatars = []) {
  const rarityColors = { legendary: '#FFD700', rare: '#1E90FF', uncommon: '#32CD32', common: '#A9A9A9', undefined: '#808080' };
  const rarity = location.rarity || 'undefined';
  const color = rarityColors[rarity.toLowerCase()] || '#5865F2';
  const { firstSentence, rest } = splitDescription(location.description || 'No description.');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(location.name)
    .setDescription(firstSentence)
    .setImage(location.imageUrl)
    .addFields(
      { name: 'Rarity', value: rarity, inline: true },
      { name: 'Items', value: `${items.length}`, inline: true },
      { name: 'Avatars', value: `${avatars.length}`, inline: true }
    )
    .setFooter({ text: 'Location Info' });

  if (rest) {
    embed.addFields({ name: 'More Info', value: rest, inline: false });
  }

  const viewUrl = `${process.env.BASE_URL}/location.html?id=${location._id}`;
  const button = buildViewButton(viewUrl);
  return { embed, components: [button] };
}

/**
 * Build a sleek mini item embed.
 */
export function buildMiniItemEmbed(item) {
  const rarityColors = { legendary: '#FFD700', rare: '#1E90FF', uncommon: '#32CD32', common: '#A9A9A9', undefined: '#808080' };
  const rarity = item.rarity || 'undefined';
  const color = rarityColors[rarity.toLowerCase()] || '#5865F2';
  const { firstSentence, rest: _rest3 } = splitDescription(item.description || 'No description.');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(item.name)
    .setThumbnail(item.imageUrl)
    .setDescription(firstSentence)
    .setFooter({ text: 'Item Info' });

  const button = buildProfileTriggerButton(item._id, 'View Full Item', 'item');
  return { embed, components: [button] };
}

/**
 * Build a sleek full item embed.
 */
export function buildFullItemEmbed(item) {
  const rarityColors = { legendary: '#FFD700', rare: '#1E90FF', uncommon: '#32CD32', common: '#A9A9A9', undefined: '#808080' };
  const rarity = item.rarity || 'undefined';
  const color = rarityColors[rarity.toLowerCase()] || '#5865F2';
  const { firstSentence, rest } = splitDescription(item.description || 'No description.');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(item.name)
    .setThumbnail(item.imageUrl)
    .setDescription(firstSentence)
    .addFields(
      { name: 'Type', value: item.type || 'Unknown', inline: true },
      { name: 'Rarity', value: rarity, inline: true }
    )
    .setFooter({ text: 'Item Info' });

  if (item.properties) {
    const props = Object.entries(item.properties).map(([k, v]) => `**${k}:** ${v}`).join('\n');
    embed.addFields({ name: 'Properties', value: props || 'None', inline: false });
  }

  if (rest) {
    embed.addFields({ name: 'More Info', value: rest, inline: false });
  }

  const url = `${process.env.BASE_URL}/item.html?id=${item._id}`;
  const button = buildViewButton(url);
  return { embed, components: [button] };
}
