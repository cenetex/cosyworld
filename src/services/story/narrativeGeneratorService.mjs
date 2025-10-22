/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

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
      maxLocations = 3,
      targetBeats = 5
    } = options;
    
    try {
      this.logger.info('[NarrativeGenerator] Generating story arc...');
      
      // Select theme
      const selectedTheme = theme || this.selectTheme(worldContext);
      const selectedTone = this.selectTone(selectedTheme);
      
      // Format world context for prompt
      const contextPrompt = this.worldContextService.formatContextForPrompt(worldContext);
      
      // Generate arc using AI
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
        temperature: 0.9, // Higher creativity for story generation
        max_tokens: 3000
      });
      
      // Parse AI response
      const arcData = this._parseArcResponse(response);
      
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

Create an engaging story arc with the following parameters:
- Theme: ${options.theme}
- Emotional Tone: ${options.tone}
- Characters: ${options.minCharacters}-${options.maxCharacters} avatars from the list above
- Locations: ${options.minLocations}-${options.maxLocations} locations
- Story Beats: ${options.targetBeats} progressive scenes

REQUIREMENTS:
1. Select avatars that fit the theme and would have interesting dynamics
2. Choose locations that enhance the narrative
3. Plan ${options.targetBeats} beats with clear progression (setup → development → climax → resolution)
4. Each beat should be visually compelling and emotionally resonant
5. Keep the tone ${options.tone} throughout

CRITICAL JSON FORMATTING:
- Respond with ONLY valid JSON
- NO markdown code blocks, NO extra text
- Ensure ALL strings are properly closed with quotes
- Ensure ALL arrays are properly closed with ]
- Ensure ALL objects are properly closed with }
- NO trailing commas
- Keep descriptions SHORT (under 200 chars) to avoid truncation

{
  "title": "A captivating story title",
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
  ],
  "beats": [
    {
      "sequenceNumber": 1,
      "type": "setup",
      "description": "Brief description",
      "location": "location name",
      "characters": ["character names"],
      "visualPrompt": "Image prompt",
      "captionHint": "Brief caption"
    }
  ]
}

Keep ALL text concise. Respond ONLY with the JSON object above.`;
  }

  /**
   * Parse AI response into arc structure
   * @private
   */
  _parseArcResponse(response) {
    try {
      // Extract JSON from response
      let text = response.trim();
      
      // Try to extract JSON block if wrapped in markdown
      if (text.includes('```json')) {
        const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonBlock) {
          text = jsonBlock[1];
        }
      } else if (text.includes('```')) {
        const codeBlock = text.match(/```\s*([\s\S]*?)\s*```/);
        if (codeBlock) {
          text = codeBlock[1];
        }
      }
      
      // Extract JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      // Try to fix common JSON issues
      let jsonText = jsonMatch[0];
      
      // Remove trailing commas before closing braces/brackets
      jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
      
      // Try to fix truncated strings (common issue)
      // If we have an unterminated string at the end, try to close it
      const unclosedStringMatch = jsonText.match(/"[^"]*$/);
      if (unclosedStringMatch) {
        this.logger.warn('[NarrativeGenerator] Detected truncated string, attempting to fix');
        jsonText = jsonText.replace(/"[^"]*$/, '');
        // Remove trailing comma or colon
        jsonText = jsonText.replace(/[,:]\s*$/, '');
      }
      
      // Try to close unclosed arrays/objects
      let openBraces = (jsonText.match(/\{/g) || []).length;
      let closeBraces = (jsonText.match(/\}/g) || []).length;
      let openBrackets = (jsonText.match(/\[/g) || []).length;
      let closeBrackets = (jsonText.match(/\]/g) || []).length;
      
      if (openBrackets > closeBrackets) {
        this.logger.warn('[NarrativeGenerator] Closing unclosed arrays');
        jsonText += ']'.repeat(openBrackets - closeBrackets);
      }
      
      if (openBraces > closeBraces) {
        this.logger.warn('[NarrativeGenerator] Closing unclosed objects');
        jsonText += '}'.repeat(openBraces - closeBraces);
      }
      
      const arcData = JSON.parse(jsonText);
      
      // Validate required fields
      if (!arcData.title || !arcData.beats) {
        throw new Error('Missing required fields in arc data');
      }
      
      // Ensure characters array exists and is valid
      if (!arcData.characters || !Array.isArray(arcData.characters)) {
        arcData.characters = [];
      }
      
      // Ensure locations array exists
      if (!arcData.locations || !Array.isArray(arcData.locations)) {
        arcData.locations = [];
      }
      
      return arcData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error parsing arc response:', error.message);
      this.logger.error('[NarrativeGenerator] Raw response:', response.substring(0, 500));
      // Return a fallback arc structure
      return this._getFallbackArc();
    }
  }

  /**
   * Get fallback arc if AI generation fails
   * @private
   */
  _getFallbackArc() {
    return {
      title: 'A Day in CosyWorld',
      theme: 'discovery',
      emotionalTone: 'lighthearted',
      characters: [],
      locations: [],
      beats: [
        {
          sequenceNumber: 1,
          type: 'setup',
          description: 'The sun rises over CosyWorld, bringing new possibilities.',
          location: 'The Town Square',
          characters: [],
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
   * Generate the next beat in a story arc
   * @param {Object} arc - Current story arc
   * @param {Object} worldContext - Current world state
   * @returns {Promise<Object>} Generated beat
   */
  async generateBeat(arc, worldContext) {
    try {
      const nextBeatNumber = (arc.beats?.length || 0) + 1;
      
      this.logger.info(`[NarrativeGenerator] Generating beat ${nextBeatNumber} for arc "${arc.title}"`);
      
      // Build beat prompt
      const beatPrompt = this._buildBeatPrompt(arc, nextBeatNumber, worldContext);
      
      const response = await this.aiService.chat([
        { role: 'user', content: beatPrompt }
      ], {
        temperature: 0.85,
        max_tokens: 1500
      });
      
      // Parse beat response
      const beatData = this._parseBeatResponse(response, nextBeatNumber);
      
      this.logger.info(`[NarrativeGenerator] Generated beat ${nextBeatNumber}: "${beatData.description.substring(0, 50)}..."`);
      
      return beatData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error generating beat:', error);
      throw error;
    }
  }

  /**
   * Build prompt for beat generation
   * @private
   */
  _buildBeatPrompt(arc, beatNumber, worldContext) {
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

PREVIOUS BEATS:
${previousBeats.map((b, i) => `Beat ${i + 1} (${b.type}): ${b.description}`).join('\n\n')}

`;

    if (worldContext.opportunities && worldContext.opportunities.length > 0) {
      prompt += `\nRECENT WORLD EVENTS:\n`;
      prompt += worldContext.opportunities.slice(0, 3).map(o => `- ${o.description}`).join('\n');
      prompt += '\n';
    }

    prompt += `
Generate Beat ${beatNumber} of ${totalBeats}:
- This should be a ${beatType} beat
- Continue naturally from previous beats
- Show character development and story progression
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

Make this beat advance the story meaningfully while maintaining emotional resonance.`;

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
      
      return beatData;
      
    } catch (error) {
      this.logger.error('[NarrativeGenerator] Error parsing beat:', error);
      return {
        sequenceNumber: beatNumber,
        type: 'development',
        description: 'The story continues in CosyWorld...',
        location: 'Unknown',
        characters: [],
        visualPrompt: 'A scene from CosyWorld, whimsical fantasy art',
        emotionalNote: 'Continuing the journey'
      };
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
        temperature: 0.8,
        max_tokens: 300
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
        temperature: 0.7,
        max_tokens: 500
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
