/**
 * DMTool
 *
 * Player-facing control surface for the Dungeon Master persona.
 * Lets the DM (bot) adjust tone per-channel/thread, roll dice, ask questions,
 * and send "secrets" (private messages) to players.
 */

import { BasicTool } from '../BasicTool.mjs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { DiceService } from '../../battle/diceService.mjs';

function normalizePreset(preset) {
  return String(preset || '').trim().toLowerCase();
}

function parseDiceExpression(expr) {
  // Minimal: supports d20, 1d20, 2d6+3, 1d8-1
  const raw = String(expr || '').trim().toLowerCase();
  if (!raw) return null;

  const cleaned = raw.replace(/\s+/g, '');

  // Allow "d20" shorthand
  const m1 = cleaned.match(/^d(\d+)([+-]\d+)?$/);
  if (m1) {
    return { count: 1, sides: Number(m1[1]), mod: m1[2] ? Number(m1[2]) : 0, raw };
  }

  const m2 = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (m2) {
    return { count: Number(m2[1]), sides: Number(m2[2]), mod: m2[3] ? Number(m2[3]) : 0, raw };
  }

  return null;
}

export class DMTool extends BasicTool {
  constructor({ logger, dmProfileService, discordService }) {
    super();
    this.logger = logger || console;
    this.dmProfileService = dmProfileService;
    this.discordService = discordService;

    this.name = 'dm';
    this.description = 'Adjust the Dungeon Master persona, roll dice, and ask/whisper';
    this.isDndTool = true;
    this.replyNotification = true;
    this.cooldownMs = 1000;

    this.diceService = new DiceService();
  }

  getUsage() {
    return 'dm [menu|tone <preset>|roll <dice>|ask <question>|secret]';
  }

  async execute(message, params, avatar) {
    const sub = String(params?.[0] || 'menu').toLowerCase();
    const channelId = message?.channelId || message?.channel?.id;

    if (sub === 'menu' || sub === 'status') {
      return await this._menu({ channelId });
    }

    if (sub === 'tone') {
      const preset = normalizePreset(params?.[1]);
      if (!preset) return this._error('Pick a tone: epic, grim, whimsical, sardonic.');
      return await this._setTone({ channelId, preset });
    }

    if (sub === 'roll') {
      const expr = params?.slice(1).join(' ');
      return await this._roll({ channelId, expr, avatar });
    }

    if (sub === 'ask') {
      const question = params?.slice(1).join(' ').trim();
      if (!question) return this._error('Ask what? Example: `dm ask Which door do you open?`');
      return await this._ask({ message, channelId, avatar, question });
    }

    if (sub === 'secret') {
      // UX: button opens modal; this path is for legacy/manual use.
      // `dm secret <text>` will whisper to the invoker via DM if possible.
      const secret = params?.slice(1).join(' ').trim();
      if (!secret) {
        return {
          embeds: [
            new EmbedBuilder()
              .setAuthor({ name: '🎲 The Dungeon Master' })
              .setTitle('🤫 Secrets')
              .setDescription('Use the **Send Secret** button from the DM menu, or run `dm secret <message>` to receive a private whisper.')
              .setColor(0x7C3AED),
          ],
        };
      }
      return await this._whisperSelf({ message, avatar, secret });
    }

    return await this._menu({ channelId });
  }

  async _menu({ channelId }) {
    const profile = await this.dmProfileService?.getProfileForChannel?.(channelId);
    const tone = profile?.tonePreset || 'epic';

    const embed = new EmbedBuilder()
      .setAuthor({ name: '🎲 The Dungeon Master' })
      .setTitle('🎛️ DM Persona')
      .setDescription(
        `**Current Tone:** ${tone}\n\n` +
          'Change the DM voice for this channel/thread. Tone affects narration, prompts, and how the DM frames choices.'
      )
      .setColor(0x7C3AED);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dnd_dm_tone_epic').setLabel('Epic').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dnd_dm_tone_grim').setLabel('Grim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dnd_dm_tone_whimsical').setLabel('Whimsical').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('dnd_dm_tone_sardonic').setLabel('Sardonic').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dnd_dm_secret').setLabel('Send Secret').setEmoji('🤫').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dnd_dm_roll_d20').setLabel('Roll d20').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
  }

  async _setTone({ channelId, preset }) {
    const profile = await this.dmProfileService?.setTonePresetForChannel?.(channelId, preset);

    const embed = new EmbedBuilder()
      .setAuthor({ name: '🎲 The Dungeon Master' })
      .setTitle('✅ Tone Updated')
      .setDescription(`The DM shifts their voice to **${profile?.tonePreset || preset}**.`)
      .setColor(0x10B981);

    return { embeds: [embed], components: (await this._menu({ channelId }))?.components };
  }

  async _roll({ channelId: _channelId, expr, avatar }) {
    const parsed = parseDiceExpression(expr || 'd20');
    if (!parsed || !Number.isFinite(parsed.count) || !Number.isFinite(parsed.sides) || parsed.sides <= 1) {
      return this._error('Invalid roll. Examples: `dm roll d20`, `dm roll 2d6+1`');
    }

    const count = Math.max(1, Math.min(20, parsed.count));
    const sides = Math.max(2, Math.min(1000, parsed.sides));

    const rolls = [];
    for (let i = 0; i < count; i++) {
      rolls.push(this.diceService.rollDie(sides));
    }

    const sum = rolls.reduce((a, b) => a + b, 0);
    const total = sum + (parsed.mod || 0);

    const roller = avatar?.name ? `**${avatar.name}**` : 'An adventurer';

    const embed = new EmbedBuilder()
      .setAuthor({ name: '🎲 The Dungeon Master' })
      .setTitle('🎲 Dice Roll')
      .setDescription(`${roller} rolls **${parsed.raw || expr || 'd20'}** → **${total}**`) 
      .addFields(
        { name: 'Rolls', value: rolls.join(', '), inline: true },
        { name: 'Modifier', value: String(parsed.mod || 0), inline: true }
      )
      .setColor(0x3B82F6);

    return { embeds: [embed] };
  }

  async _ask({ message, channelId: _channelId, avatar: _avatar, question }) {
    // Post publicly to the channel/thread to drive the "DM: What do you do?" loop.
    const embed = new EmbedBuilder()
      .setAuthor({ name: '🎲 The Dungeon Master' })
      .setTitle('What do you do?')
      .setDescription(`*${question}*`)
      .setColor(0x7C3AED);

    // If this tool is invoked from a button interaction, the response would be ephemeral.
    // To ensure the question appears in the channel, we send directly.
    if (message?.channel?.send) {
      await message.channel.send({ embeds: [embed] });
      return { _handled: true };
    }

    return { embeds: [embed] };
  }

  async _whisperSelf({ message, avatar: _avatar, secret }) {
    const userId = message?.author?.id;
    if (!userId || !this.discordService?.client?.users?.fetch) {
      // Fallback: return message (often ephemeral in button flow)
      return {
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: '🎲 The Dungeon Master' })
            .setTitle('🤫 A Secret')
            .setDescription(`*${secret}*`)
            .setColor(0x7C3AED),
        ],
      };
    }

    try {
      const user = await this.discordService.client.users.fetch(userId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: '🎲 The Dungeon Master' })
            .setTitle('🤫 A Secret, Just for You')
            .setDescription(`*${secret}*`)
            .setColor(0x7C3AED),
        ],
      });

      const name = _avatar?.name ? `**${_avatar.name}**` : 'adventurer';
      return {
        embeds: [
          new EmbedBuilder()
            .setAuthor({ name: '🎲 The Dungeon Master' })
            .setTitle('✅ Secret Sent')
            .setDescription(`A private whisper has been delivered to ${name}.`)
            .setColor(0x10B981),
        ],
      };
    } catch (e) {
      this.logger?.debug?.(`[DMTool] Failed to DM user: ${e.message}`);
      return this._error('I could not send you a DM (privacy settings?).');
    }
  }

  _error(msg) {
    return {
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: '🎲 The Dungeon Master' })
          .setTitle('⚠️ DM')
          .setDescription(msg)
          .setColor(0xF59E0B),
      ],
    };
  }
}

export default DMTool;
