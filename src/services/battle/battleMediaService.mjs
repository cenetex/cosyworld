/**
 * BattleMediaService
 * Generates battle scene images and optional short video clips based on attack outcomes.
 */
import axios from 'axios';

export class BattleMediaService {
  constructor({ logger, aiService, googleAIService, s3Service, veoService }) {
    this.logger = logger || console;
    this.aiService = aiService;
    this.googleAIService = googleAIService; // optional fallback
    this.s3Service = s3Service; // required for image downloads and hosting URLs
    this.veoService = veoService; // optional video generation

    // Feature toggles
    const env = (k, d) => (process.env[k] ?? d);
    this.enableCriticalHitVideo = env('BATTLE_VIDEO_CRITICAL_ENABLED', 'true') === 'true';
    this.enableDeathVideo = env('BATTLE_VIDEO_DEATH_ENABLED', 'true') === 'true';
    this.criticalHitVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_CRITICAL_CHANCE', '0.5')) || 0.5));
    this.deathVideoChance = Math.max(0, Math.min(1, parseFloat(env('BATTLE_VIDEO_DEATH_CHANCE', '1')) || 1));
  }

  _buildScenePrompt(attacker, defender, result, location) {
    const base = {
      dead: `Final blow moment: ${attacker.name} defeats ${defender.name}. BOTH characters visible in the same shot, decisive impact, dramatic particles, 16:9 widescreen. Do NOT render a solo portrait; include both fighters.${location?.name ? ` Setting: ${location.name}.` : ''}` ,
      knockout: `Knockout moment: ${attacker.name} drops ${defender.name}. BOTH characters visible in the same shot, dramatic impact, 16:9 widescreen. No solo portraits.${location?.name ? ` Setting: ${location.name}.` : ''}` ,
      hit: `Cinematic strike: ${attacker.name} hits ${defender.name}. BOTH characters visible in the same shot, dynamic action, 16:9 widescreen. No solo portraits.${location?.name ? ` Setting: ${location.name}.` : ''}`,
      miss: `Dramatic near-miss: ${attacker.name}'s attack narrowly misses ${defender.name}. BOTH characters visible in the same shot, tense motion blur, defensive dodge, 16:9 widescreen. No solo portraits.${location?.name ? ` Setting: ${location.name}.` : ''}`
    };
    if (result?.result === 'dead') return base.dead;
    if (result?.result === 'knockout') return base.knockout;
    if (result?.result === 'miss') return base.miss;
    return base.hit;
  }

  async _downloadAsBase64(url) {
    if (!url || !this.s3Service) return null;
    try {
      const buf = await this.s3Service.downloadImage(url);
      return buf?.toString('base64') || null;
    } catch (e) {
      this.logger?.warn?.(`[BattleMedia] s3 download failed: ${e.message}`);
      // Fallback: fetch via HTTP if URL is external
      try {
        if (/^https?:\/\//i.test(url)) {
          const resp = await axios.get(url, { responseType: 'arraybuffer' });
          return Buffer.from(resp.data).toString('base64');
        }
      } catch (e2) {
        this.logger?.warn?.(`[BattleMedia] http download failed: ${e2.message}`);
      }
      return null;
    }
  }

  async _composeOrGenerateImage(images, scenePrompt) {
    // Try primary provider first, fallback to googleAIService
    const tryProvider = async (provider) => {
      if (!provider) return null;
      try {
        if (typeof provider.composeImageWithGemini === 'function') {
          const composed = await provider.composeImageWithGemini(images, scenePrompt);
          if (composed) return composed;
        }
      } catch (e) {
        this.logger?.warn?.(`[BattleMedia] compose attempt failed: ${e.message}`);
      }
      try {
        if (typeof provider.generateImage === 'function') {
          const prompt = `${scenePrompt}`;
          const gen = await provider.generateImage(prompt);
          if (gen) return gen;
        }
      } catch (e) {
        this.logger?.warn?.(`[BattleMedia] generate attempt failed: ${e.message}`);
      }
      return null;
    };

    let imageUrl = await tryProvider(this.aiService);
    if (!imageUrl) imageUrl = await tryProvider(this.googleAIService);
    return imageUrl;
  }

  async _maybeGenerateVideo({ attacker, defender, result, imageUrl }) {
    const isCritical = !!result?.critical;
    const isDeath = result?.result === 'dead';
  const isKnockout = result?.result === 'knockout';
  const wantCriticalVideo = this.enableCriticalHitVideo && isCritical && Math.random() < this.criticalHitVideoChance;
  const wantDeathVideo = this.enableDeathVideo && isDeath && Math.random() < this.deathVideoChance;
  // Always try to generate a video on knockouts if video service is available
  const wantKnockoutVideo = !!this.veoService && isKnockout;
  const allowVideo = !!this.veoService && (wantCriticalVideo || wantDeathVideo || wantKnockoutVideo);

    if (!imageUrl || !allowVideo) return null;
    if (this.veoService?.checkRateLimit && !this.veoService.checkRateLimit()) return null;

    try {
      const sceneBuf = await this.s3Service.downloadImage(imageUrl);
      const baseImages = [{ data: sceneBuf.toString('base64'), mimeType: 'image/png', label: 'scene' }];
      let prompt = `Explosive critical hit by ${attacker.name} against ${defender.name}, dynamic camera, sparks, energy burst.`;
      if (isDeath) {
        prompt = `Cinematic slow-motion final blow as ${attacker.name} defeats ${defender.name}. Epic, dramatic, particle effects.`;
      } else if (isKnockout) {
        prompt = `Cinematic knockout moment as ${attacker.name} drops ${defender.name}. Impact, slow motion, dramatic particles.`;
      }
      const videos = await this.veoService.generateVideosFromImages({ prompt, images: baseImages });
      return Array.isArray(videos) ? videos[0] : null;
    } catch (e) {
      this.logger?.warn?.(`[BattleMedia] video generation failed: ${e.message}`);
      return null;
    }
  }

  async generateForAttack({ attacker, defender, result, location }) {
    try {
      if (!this.s3Service) return null; // media disabled
      if (!result || !attacker || !defender) return null;
  // Allow image generation for misses too so the UI always has a battle scene frame
  if (!['hit','knockout','dead','miss'].includes(result.result)) return null;

  const scenePrompt = this._buildScenePrompt(attacker, defender, result, location);

      const images = [];
      const a64 = await this._downloadAsBase64(attacker.imageUrl);
      if (a64) images.push({ data: a64, mimeType: 'image/png', label: 'attacker' });
      const d64 = await this._downloadAsBase64(defender.imageUrl);
      if (d64) images.push({ data: d64, mimeType: 'image/png', label: 'defender' });
      const locUrl = location?.imageUrl;
      const l64 = await this._downloadAsBase64(locUrl);
      if (l64) images.push({ data: l64, mimeType: 'image/png', label: 'location' });
      images.splice(3);

      const imageUrl = await this._composeOrGenerateImage(images, scenePrompt);
      const videoUrl = await this._maybeGenerateVideo({ attacker, defender, result, imageUrl });

  if (!imageUrl && !videoUrl) return null;
  // Return media only; callers are responsible for embedding
  return { imageUrl, videoUrl };
    } catch (e) {
      this.logger?.warn?.(`[BattleMedia] generateForAttack error: ${e.message}`);
      return null;
    }
  }

  /**
   * Generate a pre-fight "Avatar vs Avatar" poster at a location (16:9, both visible, bold typography).
   */
  async generateFightPoster({ attacker, defender, location }) {
    try {
      if (!this.s3Service) return null;
      if (!attacker || !defender) return null;
      const locName = location?.name || location?.title || 'Unknown Arena';
      const scenePrompt = `${attacker.name} vs ${defender.name} — at ${locName}. BOTH fighters visible in one shot, bold typography, cinematic lighting, 16:9 widescreen. Avoid solo portrait — include both characters with the setting.`;

      const images = [];
      const a64 = await this._downloadAsBase64(attacker.imageUrl);
      if (a64) images.push({ data: a64, mimeType: 'image/png', label: 'attacker' });
      const d64 = await this._downloadAsBase64(defender.imageUrl);
      if (d64) images.push({ data: d64, mimeType: 'image/png', label: 'defender' });
      const l64 = await this._downloadAsBase64(location?.imageUrl);
      if (l64) images.push({ data: l64, mimeType: 'image/png', label: 'location' });
      images.splice(3);

      const imageUrl = await this._composeOrGenerateImage(images, scenePrompt);
      if (!imageUrl) return null;
      return { imageUrl };
    } catch (e) {
      this.logger?.warn?.(`[BattleMedia] generateFightPoster error: ${e.message}`);
      return null;
    }
  }

  /**
   * Generate media for the combat summary. Always attempts an image of the climactic moment
   * (winner vs loser in one 16:9 shot). If outcome is 'knockout' or 'dead' and a video service
   * is available, also attempts a short video clip.
   *
   * @param {Object} params
   * @param {Object} params.winner - The winner combatant { name, imageUrl }
   * @param {Object} params.loser - The loser combatant { name, imageUrl }
   * @param {('dead'|'knockout'|'win')} params.outcome - Final outcome for the loser
   * @param {Object} [params.location] - Optional location { name, imageUrl }
   * @returns {Promise<{ imageUrl: string|null, videoUrl: string|null }|null>}
   */
  async generateSummaryMedia({ winner, loser, outcome, location }) {
    try {
      if (!this.s3Service) return null;
      if (!winner || !loser) return null;

      const scenePrompt = (() => {
        const loc = location?.name || location?.title;
        const base = `${winner.name || 'Winner'} stands over ${loser.name || 'Opponent'} in the decisive moment. BOTH characters visible in one dramatic 16:9 shot, strong lighting, dynamic composition. Avoid solo portrait.`;
        const withLoc = loc ? `${base} Setting: ${loc}.` : base;
        if (outcome === 'dead') return `Final victory: ${withLoc} Emphasize the finishing blow impact and particles.`;
        if (outcome === 'knockout') return `Knockout victory: ${withLoc} Emphasize the KO impact and motion.`;
        return `Victory standoff: ${withLoc} Emphasize closure and tension release.`;
      })();

      const images = [];
      const w64 = await this._downloadAsBase64(winner.imageUrl);
      if (w64) images.push({ data: w64, mimeType: 'image/png', label: 'winner' });
      const l64 = await this._downloadAsBase64(loser.imageUrl);
      if (l64) images.push({ data: l64, mimeType: 'image/png', label: 'loser' });
      const loc64 = await this._downloadAsBase64(location?.imageUrl);
      if (loc64) images.push({ data: loc64, mimeType: 'image/png', label: 'location' });
      images.splice(3);

      const imageUrl = await this._composeOrGenerateImage(images, scenePrompt);

      // For summary, attempt a video if knockout/death occurred
      let videoUrl = null;
      if (imageUrl && (outcome === 'dead' || outcome === 'knockout')) {
        const fauxResult = { result: outcome, critical: false };
        videoUrl = await this._maybeGenerateVideo({ attacker: winner, defender: loser, result: fauxResult, imageUrl });
      }

      if (!imageUrl && !videoUrl) return null;
      return { imageUrl, videoUrl };
    } catch (e) {
      this.logger?.warn?.(`[BattleMedia] generateSummaryMedia error: ${e.message}`);
      return null;
    }
  }
}

export default BattleMediaService;
