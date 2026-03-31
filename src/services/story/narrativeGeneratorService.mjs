/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import crypto from 'crypto';
import { parseFirstJson } from '../../utils/jsonParse.mjs';

/**
 * NarrativeGeneratorService
 * 
 * AI-powered story content generation.
 * Creates story arcs, beats, prompts, captions, and summaries using AI services.
 */
export class NarrativeGeneratorService {
  constructor({ aiService, worldContextService, storyStateService, logger }) {
    this.aiService = aiService;
    this.worldContextService = worldContextService;
    this.storyStateService = storyStateService;
    this.logger = logger || console;
    
    // Story themes
    this.themes = [
      'journey',
      'discovery',
      'celebration',
      'mystery',
      'conflict',
      'reunion',
      'adventure',
      'transformation'
    ];
    
    // Emotional tones
    this.tones = [
      'lighthearted',
      'whimsical',
      'somber',
      'tense',
      'hopeful',
      'nostalgic',
      'epic'
    ];
  }

  // ============================================================================
  // Story Arc Generation
  // ============================================================================

  /**
   * Generate a complete story arc
   * @param {Object} worldContext - Current world state
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated story arc
   */
  async generateArc(worldContext, options = {}) {
    const {
      theme = null,
      minCharacters = 1,
      maxCharacters = 3,
      minLocations = 1,
      maxLocations = 3
    } = options;
    
    try {
      this.logger.info('[NarrativeGenerator] Generating story arc...');
      
      // Select theme
      const selectedTheme = theme || this.selectTheme(worldContext);
      const selectedTone = this.selectTone(selectedTheme);
      
      // Format world context for prompt
      const contextPrompt = this.worldContextService.formatContextForPrompt(worldContext);
      
      // Generate arc using AI
      // Decide target beats: prefer explicit option, else derive from plan, else default to 12 (4 chapters)
      const beatsPerChapter = 3;
      const derivedBeats = options?.plan?.chapters?.length
        ? options.plan.chapters.length * beatsPerChapter
        : undefined;
      const targetBeats = options?.targetBeats ?? derivedBeats ?? 12;

      const arcPrompt = this._buildArcPrompt(contextPrompt, {
        theme: selectedTheme,
        tone: selectedTone,
        minCharacters,
        maxCharacters,
        minLocations,
        maxLocations,
        targetBeats
      });
      
      const response = await this.aiService.chat([
        { role: 'user', content: arcPrompt }
      ], {
        temperature: 0.8, // Slightly lower to stay concise
        // Prefer a strong structured model if available; provider will fallback if not
        model: 'anthropic/claude-sonnet-4',
        // Coerce JSON-only output when provider supports it
        response_format: { type: 'json_object' }
      });
      
  // Parse AI response (metadata only; beats generated later)
  const arcData = this._parseArcResponse(response, worldContext);
      
      // Enrich with metadata
      arcData.theme = selectedTheme;
      arcData.emotionalTone = selectedTone;
  arcData.plannedBeats = targetBeats;
      arcData.status = 'planning';
      arcData.startedAt = new Date();
      arcData.estimatedCompletionDate = this._estimateCompletionDate(targetBeats);
      arcData.metadata = {
        generatedBy: 'auto',
        triggerEvent: worldContext.opportunities?.[0]?.type || 'scheduled'
      };
      
      this.logger.info(`[NarrativeGenerator] Generated arc: "${arcData.title}"`);
      
      return arcData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating arc:', error);
      throw error;
    }
  }

  /**
   * Build prompt for arc generation
   * @private
   */
  _buildArcPrompt(contextPrompt, options) {
    return `You are the master storyteller for CosyWorld, a whimsical digital realm.

${contextPrompt}

Create an engaging story arc METADATA with the following parameters (do NOT include the beats content):
- Theme: ${options.theme}
- Emotional Tone: ${options.tone}
- Characters: ${options.minCharacters}-${options.maxCharacters} avatars from the list above
- Locations: ${options.minLocations}-${options.maxLocations} locations
- Planned Story Beats: ${options.targetBeats} scenes (this is a number only; beats will be generated later)

REQUIREMENTS:
1. Select avatars that fit the theme and would have interesting dynamics
2. Choose locations that enhance the narrative
3. Keep the tone ${options.tone} throughout
4. Keep output concise; only include METADATA fields, not the story beats themselves

CRITICAL JSON FORMATTING:
- Respond with ONLY valid JSON
- NO markdown code blocks, NO extra text
- Ensure ALL strings are properly closed with quotes
- Ensure ALL arrays are properly closed with ]
- Ensure ALL objects are properly closed with }
- NO trailing commas
- Keep descriptions SHORT (under 200 chars) to avoid truncation

{
  "title": "Evocative, specific arc title (3-6 words, no generic phrases; do NOT use 'CosyWorld' or 'A Day in ...')",
  "theme": "${options.theme}",
  "emotionalTone": "${options.tone}",
  "characters": [
    {
      "avatarId": "use actual _id from avatar list",
      "avatarName": "avatar name",
      "role": "protagonist",
      "characterArc": "Brief character arc"
    }
  ],
  "locations": [
    {
      "locationId": "use actual _id or null",
      "locationName": "location name",
      "significance": "Brief significance"
    }
  ]
}

Keep ALL text concise. Respond ONLY with the JSON object above.`;
  }

  /**
   * Parse AI response into arc structure
   * @private
   * @param {string} response - AI response text
   * @param {Object} worldContext - World context for fallback
   */
  _parseArcResponse(response, worldContext) {
    try {
      // OpenRouter service returns plain string; guard for envelope-shaped objects
      const rawText = typeof response === 'string' 
        ? response 
        : (response?.text || String(response || ''));

      const arcData = parseFirstJson(rawText);

      // Validate required fields (beats are NOT required here)
      if (!arcData || !arcData.title) {
        throw new Error('Missing required fields in arc data');
      }

      // Ensure arrays exist
      if (!Array.isArray(arcData.characters)) arcData.characters = [];
      if (!Array.isArray(arcData.locations)) arcData.locations = [];

      return arcData;

    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error parsing arc response:', error.message);
      const preview = typeof response === 'string' ? response : (response?.text || '') ;
      if (preview) {
        this.logger.error('[NarrativeGenerator] Raw response:', preview.substring(0, 500));
      }
      // Return a fallback arc structure with real avatars from world context
      return this._getFallbackArc(worldContext);
    }
  }

  /**
   * Get fallback arc if AI generation fails
   * @private
   */
  _getFallbackArc(worldContext) {
    // Build a more distinctive fallback title
    const pick = (arr) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
    const protagonist = worldContext?.avatars && worldContext.avatars.length ? worldContext.avatars[0] : null;
    const loc = worldContext?.locations && worldContext.locations.length ? worldContext.locations[0] : null;

    const firstWord = (s) => {
      if (!s) return null;
      const parts = String(s).trim().split(/\s+/);
      // Skip leading articles
      const skip = new Set(['the','a','an']);
      for (const p of parts) {
        if (!skip.has(p.toLowerCase())) return p;
      }
      return parts[0] || null;
    };

    let fallbackTitle = null;
    const pName = firstWord(protagonist?.name);
    const lName = firstWord(loc?.name);
    if (pName && lName) fallbackTitle = `${pName} at ${lName}`;
    else if (pName) fallbackTitle = `${pName}'s Journey`;

    if (!fallbackTitle) {
      const themeTitles = {
        journey: ['Footsteps Beyond', 'Paths Unfolding', 'Crossing Thresholds'],
        discovery: ['Secrets of Eldrador', 'Whispers in the Grove', 'Moonlit Revelations'],
        celebration: ['Lanterns in Bloom', 'Festival of Echoes', 'Songs of the Vale'],
        mystery: ['Shadows and Sigils', 'The Hidden Map', 'Veil of Echoes'],
        conflict: ['Storm at the Gates', 'Fractures of Fate', 'Clash in the Ruins'],
        reunion: ['Embers Reignited', 'Return to the Grove', 'Threads Rewoven'],
        adventure: ['Compass of Starlight', 'The Luminous Trail', 'Beyond the Hollow'],
        transformation: ['Becoming Luminous', 'The Turning of Leaves', 'Chrysalis Dawn']
      };
      const themed = pick(themeTitles.discovery);
      fallbackTitle = themed || 'Whispers of the Vale';
    }
    // Try to use real avatars from world context
    const characters = [];
    if (worldContext?.avatars && worldContext.avatars.length > 0) {
      const avatar = worldContext.avatars[0];
      characters.push({
        avatarId: avatar._id.toString(),
        avatarName: avatar.name + (avatar.emoji ? ' ' + avatar.emoji : ''),
        role: 'protagonist',
        characterArc: 'Discovers the wonders of CosyWorld'
      });
    }
    
    // Try to use real locations
    const locations = [];
    if (worldContext?.locations && worldContext.locations.length > 0) {
      const location = worldContext.locations[0];
      locations.push({
        locationId: location._id ? location._id.toString() : null,
        locationName: location.name,
        significance: 'The starting point of the adventure'
      });
    }
    
    return {
      title: fallbackTitle,
      theme: 'discovery',
      emotionalTone: 'lighthearted',
      characters,
      locations,
      beats: [
        {
          id: crypto.randomUUID(), // Add GUID to fallback beat
          sequenceNumber: 1,
          type: 'setup',
          description: 'The sun rises over CosyWorld, bringing new possibilities.',
          location: locations[0]?.locationName || 'The Town Square',
          characters: characters.map(c => c.avatarName),
          visualPrompt: 'A whimsical town square at sunrise, warm golden light, cheerful atmosphere, fantasy art style',
          captionHint: 'A new day begins'
        }
      ]
    };
  }

  // ============================================================================
  // Story Beat Generation
  // ============================================================================

  /**
   * Ensure beat has a unique ID
   * @private
   * @param {Object} beatData - Beat data
   * @returns {Object} Beat data with guaranteed ID
   */
  _ensureBeatId(beatData) {
    if (!beatData.id) {
      beatData.id = crypto.randomUUID();
      this.logger.debug(`[NarrativeGenerator] Added ID to beat: ${beatData.id}`);
    }
    return beatData;
  }

  /**
   * Generate a title card beat for the story arc
   * Title cards appear every 9 beats (3 chapters) and summarize the story so far
   * @param {Object} arc - Current story arc
   * @param {Object} _worldContext - Current world state (reserved for future use)
   * @returns {Promise<Object>} Generated title card beat
   */
  async generateTitleCard(arc, _worldContext) {
    try {
      const nextBeatNumber = (arc.beats?.length || 0) + 1;
      const totalBeats = arc.beats?.length || 0;
      const chaptersCompleted = Math.floor(totalBeats / 3);
      
      this.logger.info(`[NarrativeGenerator] Generating title card for arc "${arc.title}" at beat ${nextBeatNumber} (after ${chaptersCompleted} chapters)`);
      
      // Create a summary of the story so far
      const recentBeats = arc.beats?.slice(-9) || []; // Last 9 beats (3 chapters)
      const storySummary = recentBeats.length > 0
        ? recentBeats.map((b, i) => `${i + 1}. ${b.description}`).join('\n')
        : 'The story begins...';
      
      const titleCardPrompt = `You are creating a title card for CosyWorld story arc.

STORY ARC: "${arc.title}"
Theme: ${arc.theme}
Emotional Tone: ${arc.emotionalTone}

CHAPTERS COMPLETED: ${chaptersCompleted}
TOTAL BEATS SO FAR: ${totalBeats}

STORY SO FAR:
${storySummary}

CHARACTERS:
${arc.characters.map(c => `- ${c.avatarName} (${c.role})`).join('\n')}

LOCATIONS:
${arc.locations.map(l => `- ${l.locationName}`).join('\n')}

Create a title card with:
1. A SHORT title (maximum 8 words, preferably 3-5 words) - NOT the arc title, create a new evocative chapter title
2. A compelling 2-3 sentence summary of what has happened and what's coming
3. A rich visual prompt for an iconic establishing shot

Respond ONLY with valid JSON:
{
  "sequenceNumber": ${nextBeatNumber},
  "type": "title",
  "title": "Short evocative chapter title (3-8 words maximum)",
  "description": "2-3 sentences summarizing the story so far and setting up what's next",
  "location": "primary location from arc",
  "characters": ["all main character names"],
  "visualPrompt": "Epic establishing shot showcasing the story's key characters and setting. Cinematic composition, dramatic lighting, rich atmosphere. Include: ${arc.characters.map(c => c.avatarName).join(', ')}. Setting: ${arc.locations[0]?.locationName || 'CosyWorld'}. Style: ${arc.emotionalTone} and ${arc.theme} themed, fantasy art, title card quality",
  "emotionalNote": "This is a ${arc.emotionalTone} ${arc.theme} story"
}`;

      const response = await this.aiService.chat([
        { role: 'user', content: titleCardPrompt }
      ], {
        temperature: 0.7 // Slightly lower for more consistent title cards
      });
      
      // Parse the response
      const titleCardData = this._parseBeatResponse(response, nextBeatNumber);
      
      // Ensure type is set to 'title'
      titleCardData.type = 'title';
      
      // Ensure beat has ID
      this._ensureBeatId(titleCardData);
      
      this.logger.info(`[NarrativeGenerator] Generated title card: "${titleCardData.description.substring(0, 60)}..."`);
      
      return titleCardData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating title card:', error);
      // Fallback title card
      const nextBeatNumber = (arc.beats?.length || 0) + 1;
      return this._ensureBeatId({
        id: crypto.randomUUID(),
        sequenceNumber: nextBeatNumber,
        type: 'title',
        title: arc.title,
        description: `A ${arc.theme} tale unfolds in CosyWorld, where ${arc.characters.map(c => c.avatarName).join(' and ')} embark on a ${arc.emotionalTone} journey.`,
        location: arc.locations[0]?.locationName || 'CosyWorld',
        characters: arc.characters.map(c => c.avatarName),
        visualPrompt: `Epic title card for ${arc.title}. Featuring ${arc.characters.map(c => c.avatarName).join(', ')} in ${arc.locations[0]?.locationName || 'a magical world'}. Cinematic composition, ${arc.emotionalTone} atmosphere, fantasy art style, dramatic lighting`,
        emotionalNote: `A ${arc.emotionalTone} ${arc.theme} tale`
      });
    }
  }

  /**
   * Generate the next beat in a story arc
   * @param {Object} arc - Current story arc
   * @param {Object} worldContext - Current world state (with channel summaries)
   * @param {Object} chapterOptions - Chapter context for beat generation
   * @param {Object} chapterOptions.chapterContext - Plan context for current chapter
   * @param {number} chapterOptions.beatInChapter - Position of beat within chapter (1-3)
   * @param {number} chapterOptions.totalBeatsInChapter - Total beats in chapter (usually 3)
   * @param {Array} chapterOptions.previousBeats - Previously generated beats in this chapter
   * @returns {Promise<Object>} Generated beat
   */
  async generateBeat(arc, worldContext, chapterOptions = {}) {
    try {
      const nextBeatNumber = (arc.beats?.length || 0) + 1;
      const chapterContext = chapterOptions.chapterContext || null;
      const evolvingContext = chapterOptions.evolvingContext || null;
      const beatInChapter = chapterOptions.beatInChapter || 1;
      const previousBeatsInChapter = chapterOptions.previousBeats || [];
      
      if (chapterContext) {
        this.logger.info(`[NarrativeGenerator] Generating beat ${nextBeatNumber} (Chapter ${chapterContext.currentChapter + 1}, Beat ${beatInChapter}/3) for arc "${arc.title}"`);
      } else {
        this.logger.info(`[NarrativeGenerator] Generating beat ${nextBeatNumber} for arc "${arc.title}"`);
      }
      
      // Build beat prompt with chapter context
      const beatPrompt = this._buildBeatPrompt(
        arc, 
        nextBeatNumber, 
        worldContext, 
        chapterContext,
        beatInChapter,
        previousBeatsInChapter,
        evolvingContext
      );
      
      const response = await this.aiService.chat([
        { role: 'user', content: beatPrompt }
      ], {
        temperature: 0.85
      });
      
      // Parse beat response
      const beatData = this._parseBeatResponse(response, nextBeatNumber);
      
      // Ensure beat has ID
      this._ensureBeatId(beatData);
      
      this.logger.info(`[NarrativeGenerator] Generated beat ${nextBeatNumber}: "${beatData.description.substring(0, 50)}..."`);
      
      return beatData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating beat:', error);
      throw error;
    }
  }

  /**
   * Build prompt for beat generation
   * Uses channel summaries for world context
   * @private
   */
  _buildBeatPrompt(arc, beatNumber, worldContext, chapterContext = null, beatInChapter = 1, previousBeatsInChapter = [], evolvingContext = null) {
    const previousBeats = arc.beats || [];
    const totalBeats = arc.plannedBeats || 5;
    const beatType = this._determineBeatType(beatNumber, totalBeats);
    
    let prompt = `You are continuing a story in CosyWorld.

STORY ARC: "${arc.title}"
Theme: ${arc.theme}
Emotional Tone: ${arc.emotionalTone}

CHARACTERS:
${arc.characters.map(c => `- ${c.avatarName} (${c.role}): ${c.characterArc}`).join('\n')}

LOCATIONS:
${arc.locations.map(l => `- ${l.locationName}: ${l.significance}`).join('\n')}
`;

    // Add evolving context (character/location history)
    if (evolvingContext) {
      prompt += `\n--- STORY CONTINUITY ---\n`;
      
      // Add character history
      if (evolvingContext.characters && evolvingContext.characters.length > 0) {
        for (const char of evolvingContext.characters) {
          if (char.previousRoles && char.previousRoles.length > 0) {
            prompt += `${char.avatarName} has previously been: ${char.previousRoles.join(', ')}\n`;
          }
        }
        prompt += '\n';
      }
      
      // Add relevant history
      if (evolvingContext.relevantHistory && evolvingContext.relevantHistory.summary) {
        prompt += evolvingContext.relevantHistory.summary + '\n\n';
      }
      
      // Add world context
      if (evolvingContext.worldContext && evolvingContext.worldContext.summary) {
        prompt += evolvingContext.worldContext.summary + '\n\n';
      }
      
      // Add continuity notes
      if (evolvingContext.continuityNotes && evolvingContext.continuityNotes.length > 0) {
        prompt += `IMPORTANT CONTINUITY:\n${evolvingContext.continuityNotes.join('\n')}\n\n`;
      }
    }

    // Add chapter context if available
    if (chapterContext && chapterContext.chapterInfo) {
      prompt += `
CURRENT CHAPTER (${chapterContext.currentChapter + 1}/${chapterContext.totalChapters}): "${chapterContext.chapterInfo.title}"
Chapter Plan: ${chapterContext.chapterInfo.summary}
Overall Plan Theme: ${chapterContext.theme}

THIS CHAPTER'S BEATS:
${chapterContext.chapterInfo.beats.map((b, i) => `Beat ${i + 1}: ${b}`).join('\n')}

GENERATING: Beat ${beatInChapter} of 3 in this chapter
`;

      // Show previously generated beats in this chapter
      if (previousBeatsInChapter.length > 0) {
        prompt += `\nBEATS GENERATED SO FAR IN THIS CHAPTER:\n`;
        prompt += previousBeatsInChapter.map((b, i) => 
          `Beat ${i + 1}: ${b.description}`
        ).join('\n\n');
        prompt += '\n';
      }
    }

    // Add world context from channel summaries
    if (worldContext.metaSummary) {
      prompt += `\nCURRENT WORLD STATE:\n${worldContext.metaSummary}\n`;
    }

    if (worldContext.channelSummaries && worldContext.channelSummaries.length > 0) {
      prompt += `\nRECENT ACTIVITY BY CHANNEL:\n`;
      worldContext.channelSummaries.slice(0, 3).forEach(summary => {
        prompt += `- ${summary.platform} (${summary.channelName}): ${summary.recentThemes.join(', ')}\n`;
        if (summary.summary) {
          prompt += `  ${summary.summary.substring(0, 150)}...\n`;
        }
      });
      prompt += '\n';
    }

    // Add previous beats from the full arc
    if (previousBeats.length > 0) {
      prompt += `\nPREVIOUS BEATS IN ARC:\n`;
      const recentBeats = previousBeats.slice(-3); // Last 3 beats for context
      prompt += recentBeats.map((b, i) => `Beat ${previousBeats.length - recentBeats.length + i + 1} (${b.type}): ${b.description}`).join('\n\n');
      prompt += '\n';
    }

    // Add legacy opportunities if available
    if (worldContext.opportunities && worldContext.opportunities.length > 0) {
      prompt += `\nRECENT WORLD EVENTS:\n`;
      prompt += worldContext.opportunities.slice(0, 3).map(o => `- ${o.description}`).join('\n');
      prompt += '\n';
    }

    prompt += `
Generate Beat ${beatNumber} of ${totalBeats}:
- This should be a ${beatType} beat
- Continue naturally from previous beats
${chapterContext?.chapterInfo?.beats?.[beatInChapter - 1] ? `- Align with the chapter plan for beat ${beatInChapter}: "${chapterContext.chapterInfo.beats[beatInChapter - 1]}"` : ''}
${previousBeatsInChapter.length > 0 ? `- Build upon the previous ${previousBeatsInChapter.length} beat(s) in this chapter to create a cohesive narrative` : ''}
- Show character development and story progression
- Incorporate themes and events from the world state summaries
- Create a visually compelling scene

Respond ONLY with valid JSON:
{
  "sequenceNumber": ${beatNumber},
  "type": "${beatType}",
  "description": "2-3 sentences describing what happens",
  "location": "location name from arc",
  "characters": ["character names involved"],
  "visualPrompt": "Detailed image generation prompt with rich visual details, atmosphere, lighting, character appearance, setting, mood, art style",
  "emotionalNote": "The emotional quality of this moment"
}

Make this beat advance the story meaningfully while maintaining emotional resonance${chapterContext ? ' and chapter coherence' : ''}.`;

    return prompt;
  }

  /**
   * Determine beat type based on position in arc
   * @private
   */
  _determineBeatType(beatNumber, totalBeats) {
    if (beatNumber === 1) return 'setup';
    if (beatNumber === totalBeats) return 'resolution';
    if (beatNumber === totalBeats - 1) return 'climax';
    return 'development';
  }

  /**
   * Parse beat response
   * @private
   */
  _parseBeatResponse(response, beatNumber) {
    try {
      const text = response.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in beat response');
      }
      
      const beatData = JSON.parse(jsonMatch[0]);
      beatData.sequenceNumber = beatNumber;
      // Add unique GUID for reliable identification
      beatData.id = crypto.randomUUID();
      
      return beatData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error parsing beat:', error);
      return this._ensureBeatId({
        id: crypto.randomUUID(),
        sequenceNumber: beatNumber,
        type: 'development',
        description: 'The story continues in CosyWorld...',
        location: 'Unknown',
        characters: [],
        visualPrompt: 'A scene from CosyWorld, whimsical fantasy art',
        emotionalNote: 'Continuing the journey'
      });
    }
  }

  // ============================================================================
  // Caption Generation
  // ============================================================================

  /**
   * Generate caption for posted beat image/video
   * @param {Object} beat - Story beat
   * @param {Object} arc - Story arc
   * @param {string} _mediaUrl - Generated media URL (unused, for future reference)
   * @returns {Promise<string>}
   */
  async generateCaption(beat, arc, _mediaUrl) {
    try {
      const captionPrompt = `Generate a narrative caption for this story beat in CosyWorld.

STORY: "${arc.title}"
Theme: ${arc.theme}
Tone: ${arc.emotionalTone}

BEAT ${beat.sequenceNumber}:
${beat.description}

Location: ${beat.location}
Characters: ${beat.characters.join(', ')}
Emotional Note: ${beat.emotionalNote || 'Continuing the journey'}

Write a caption that:
1. Is 1-3 sentences
2. Maintains the ${arc.emotionalTone} tone
3. Advances the narrative
4. Makes readers feel engaged with the story

Caption:`;

      const response = await this.aiService.chat([
        { role: 'user', content: captionPrompt }
      ], {
        temperature: 0.8
      });
      
      return response.trim().replace(/^["']|["']$/g, ''); // Remove quotes if present
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating caption:', error);
      return `${beat.description}\n\n#CosyWorld`;
    }
  }

  // ============================================================================
  // Summarization
  // ============================================================================

  /**
   * Generate summary of completed arc
   * @param {Object} arc - Completed story arc
   * @returns {Promise<string>}
   */
  async summarizeArc(arc) {
    try {
      const summaryPrompt = `Summarize this completed story arc from CosyWorld.

STORY: "${arc.title}"
Theme: ${arc.theme}
Emotional Tone: ${arc.emotionalTone}

BEATS:
${arc.beats.map((b, i) => `Beat ${i + 1} (${b.type}): ${b.description}`).join('\n\n')}

Create a 2-3 sentence summary that captures:
1. The essence of the story
2. Key character developments
3. The emotional journey
4. Impact on the world

Summary:`;

      const response = await this.aiService.chat([
        { role: 'user', content: summaryPrompt }
      ], {
        temperature: 0.7
      });
      
      return response.trim();
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating summary:', error);
      return `${arc.title}: A ${arc.theme} story in CosyWorld featuring ${arc.characters?.length || 0} characters across ${arc.beats?.length || 0} chapters.`;
    }
  }

  // ============================================================================
  // Theme & Tone Selection
  // ============================================================================

  /**
   * Select appropriate theme based on world context
   * @param {Object} worldContext - World state
   * @returns {string}
   */
  selectTheme(worldContext) {
    const opportunities = worldContext.opportunities || [];
    
    // Check for specific opportunities
    for (const opp of opportunities) {
      if (opp.type === 'new_arrivals') return 'journey';
      if (opp.type === 'conflict') return 'conflict';
      if (opp.type === 'popular_locations') return 'discovery';
    }
    
    // Random selection from available themes
    return this.themes[Math.floor(Math.random() * this.themes.length)];
  }

  /**
   * Select emotional tone based on theme
   * @param {string} theme - Story theme
   * @returns {string}
   */
  selectTone(theme) {
    const toneMap = {
      'journey': 'hopeful',
      'discovery': 'whimsical',
      'celebration': 'lighthearted',
      'mystery': 'tense',
      'conflict': 'epic',
      'reunion': 'nostalgic',
      'adventure': 'epic',
      'transformation': 'hopeful'
    };
    
    return toneMap[theme] || 'whimsical';
  }

  /**
   * Estimate completion date for arc
   * @private
   * @param {number} totalBeats - Number of beats in arc
   * @returns {Date}
   */
  _estimateCompletionDate(totalBeats) {
    // Estimate 12 hours between beats on average
    const hoursPerBeat = 12;
    const totalHours = totalBeats * hoursPerBeat;
    
    const completionDate = new Date();
    completionDate.setHours(completionDate.getHours() + totalHours);
    
    return completionDate;
  }
}

export default NarrativeGeneratorService;
