/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ChapterContextService
 * 
 * Builds evolving context for chapter generation by analyzing:
 * - Prior chapters featuring the same avatars/locations/items
 * - Recent story arcs providing broader world context
 * 
 * This creates continuity and allows characters/locations to have
 * ongoing storylines across multiple arcs.
 */
export class ChapterContextService {
  constructor({ 
    storyStateService,
    avatarService,
    locationService,
    itemService,
    logger 
  }) {
    this.storyState = storyStateService;
    this.avatarService = avatarService;
    this.locationService = locationService;
    this.itemService = itemService;
    this.logger = logger || console;
    
    this.config = {
      maxRelevantChapters: 3, // Last N chapters with same elements
      maxWorldContextChapters: 2, // Last N chapters without those elements
      beatsPerChapter: 3
    };
  }

  /**
   * Build evolving context for chapter generation
   * @param {Object} currentArc - Current story arc
   * @param {Object} options - Context options
   * @returns {Promise<Object>} Chapter context
   */
  async buildChapterContext(currentArc, options = {}) {
    try {
      const {
        currentChapter = 0,
        excludeCurrentArc = true
      } = options;

      this.logger.info(`[ChapterContext] Building context for arc "${currentArc.title}", chapter ${currentChapter + 1}`);

      // Get elements from current arc
      const avatarIds = currentArc.characters?.map(c => c.avatarId?.toString()).filter(Boolean) || [];
      const locationIds = currentArc.locations?.map(l => l.locationId?.toString()).filter(Boolean) || [];
      
      // Get all completed and active arcs (excluding current if specified)
      const filter = { 
        status: { $in: ['completed', 'active'] }
      };
      
      if (excludeCurrentArc && currentArc._id) {
        filter._id = { $ne: currentArc._id };
      }
      
      const allArcs = await this.storyState.getArcs(filter, {
        sort: { createdAt: -1 },
        limit: 20 // Look back at last 20 arcs
      });

      // Separate arcs into relevant (featuring same elements) and world context (other arcs)
      const relevantArcs = [];
      const worldContextArcs = [];

      for (const arc of allArcs) {
        const hasMatchingAvatar = arc.characters?.some(c => 
          avatarIds.includes(c.avatarId?.toString())
        );
        const hasMatchingLocation = arc.locations?.some(l => 
          locationIds.includes(l.locationId?.toString())
        );

        if (hasMatchingAvatar || hasMatchingLocation) {
          relevantArcs.push(arc);
        } else {
          worldContextArcs.push(arc);
        }
      }

      // Extract chapters from relevant arcs
      const relevantChapters = this._extractChapters(
        relevantArcs, 
        this.config.maxRelevantChapters,
        avatarIds,
        locationIds
      );

      // Extract chapters from world context arcs
      const worldChapters = this._extractChapters(
        worldContextArcs,
        this.config.maxWorldContextChapters
      );

      // Build context summary
      const context = {
        currentArc: {
          id: currentArc._id?.toString(),
          title: currentArc.title,
          theme: currentArc.theme,
          emotionalTone: currentArc.emotionalTone,
          currentChapter
        },
        characters: await this._enrichCharacterContext(currentArc.characters || []),
        locations: await this._enrichLocationContext(currentArc.locations || []),
        relevantHistory: {
          chapters: relevantChapters,
          summary: this._summarizeChapters(relevantChapters, 'relevant')
        },
        worldContext: {
          chapters: worldChapters,
          summary: this._summarizeChapters(worldChapters, 'world')
        },
        continuityNotes: this._generateContinuityNotes(relevantChapters, currentArc)
      };

      this.logger.info(`[ChapterContext] Built context with ${relevantChapters.length} relevant chapters, ${worldChapters.length} world chapters`);

      return context;

    } catch (error) {
      this.logger.error('[ChapterContext] Error building chapter context:', error);
      throw error;
    }
  }

  /**
   * Extract chapters from arcs
   * @private
   * @param {Array} arcs - Story arcs
   * @param {number} maxChapters - Maximum chapters to extract
   * @param {Array} filterAvatarIds - Filter for avatars (optional)
   * @param {Array} filterLocationIds - Filter for locations (optional)
   * @returns {Array} Extracted chapters
   */
  _extractChapters(arcs, maxChapters, filterAvatarIds = null, filterLocationIds = null) {
    const chapters = [];

    for (const arc of arcs) {
      if (chapters.length >= maxChapters) break;

      const beats = arc.beats || [];
      if (beats.length === 0) continue;

      // Group beats into chapters (3 beats each)
      for (let i = 0; i < beats.length; i += this.config.beatsPerChapter) {
        if (chapters.length >= maxChapters) break;

        const chapterBeats = beats.slice(i, i + this.config.beatsPerChapter);
        if (chapterBeats.length === 0) continue;

        // If filtering by avatars/locations, check if chapter is relevant
        if (filterAvatarIds || filterLocationIds) {
          const hasRelevantContent = chapterBeats.some(beat => {
            const beatAvatars = beat.characters || [];
            const beatLocation = beat.location;

            const hasAvatar = filterAvatarIds?.some(id => 
              beatAvatars.some(name => {
                // Match by name (loose matching)
                return name.toLowerCase().includes(id.toLowerCase());
              })
            );

            const hasLocation = filterLocationIds?.some(id =>
              beatLocation?.toLowerCase().includes(id.toLowerCase())
            );

            return hasAvatar || hasLocation;
          });

          if (!hasRelevantContent) continue;
        }

        const chapterNumber = Math.floor(i / this.config.beatsPerChapter) + 1;

        chapters.push({
          arcId: arc._id?.toString(),
          arcTitle: arc.title,
          arcTheme: arc.theme,
          arcTone: arc.emotionalTone,
          chapterNumber,
          beats: chapterBeats.map(beat => ({
            sequenceNumber: beat.sequenceNumber,
            type: beat.type,
            description: beat.description,
            location: beat.location,
            characters: beat.characters || []
          })),
          summary: this._generateChapterSummary(chapterBeats),
          completedAt: chapterBeats[chapterBeats.length - 1]?.postedAt || arc.updatedAt
        });
      }
    }

    return chapters;
  }

  /**
   * Generate summary for a chapter
   * @private
   */
  _generateChapterSummary(beats) {
    if (beats.length === 0) return '';

    // Skip title cards for summary
    const storyBeats = beats.filter(b => b.type !== 'title');
    if (storyBeats.length === 0) return beats[0].description?.substring(0, 150) || '';

    // Combine beat descriptions
    const descriptions = storyBeats
      .map(beat => {
        const desc = beat.description || '';
        // Get first sentence
        const firstSentence = desc.match(/^[^.!?]+[.!?]/);
        return firstSentence ? firstSentence[0] : desc.substring(0, 100);
      })
      .filter(Boolean);

    return descriptions.join(' ');
  }

  /**
   * Summarize multiple chapters
   * @private
   */
  _summarizeChapters(chapters, type = 'relevant') {
    if (chapters.length === 0) {
      return `No recent ${type} chapters found.`;
    }

    const summaries = chapters.map((ch, i) => 
      `${i + 1}. [${ch.arcTitle}] ${ch.summary}`
    );

    const prefix = type === 'relevant' 
      ? 'Recent chapters featuring these characters/locations:'
      : 'Recent world events:';

    return `${prefix}\n${summaries.join('\n')}`;
  }

  /**
   * Enrich character context with historical data
   * @private
   */
  async _enrichCharacterContext(characters) {
    const enriched = [];

    for (const char of characters) {
      const enrichedChar = {
        avatarId: char.avatarId,
        avatarName: char.avatarName,
        role: char.role,
        characterArc: char.characterArc
      };

      // Get character state if available
      if (char.avatarId) {
        try {
          const state = await this.storyState.getCharacterState(char.avatarId);
          if (state) {
            enrichedChar.previousRoles = state.roleHistory?.slice(-3) || [];
            enrichedChar.totalArcs = state.storyStats?.totalArcsParticipated || 0;
            enrichedChar.lastFeatured = state.storyStats?.lastFeaturedAt;
          }
        } catch {
          this.logger.warn(`[ChapterContext] Could not load state for ${char.avatarName}`);
        }
      }

      enriched.push(enrichedChar);
    }

    return enriched;
  }

  /**
   * Enrich location context with historical data
   * @private
   */
  async _enrichLocationContext(locations) {
    const enriched = [];

    for (const loc of locations) {
      const enrichedLoc = {
        locationId: loc.locationId,
        locationName: loc.locationName,
        significance: loc.significance
      };

      // Get location details if available
      if (loc.locationId) {
        try {
          const location = await this.locationService.getLocationById(loc.locationId);
          if (location) {
            enrichedLoc.description = location.description;
            enrichedLoc.emoji = location.emoji;
          }
        } catch {
          this.logger.warn(`[ChapterContext] Could not load location ${loc.locationName}`);
        }
      }

      enriched.push(enrichedLoc);
    }

    return enriched;
  }

  /**
   * Generate continuity notes for storytelling
   * @private
   */
  _generateContinuityNotes(relevantChapters, currentArc) {
    const notes = [];

    if (relevantChapters.length === 0) {
      notes.push('This is a fresh start for these characters and locations.');
      return notes;
    }

    // Analyze character development
    const characterNames = currentArc.characters?.map(c => c.avatarName) || [];
    const characterAppearances = new Map();

    for (const chapter of relevantChapters) {
      for (const beat of chapter.beats) {
        for (const charName of beat.characters) {
          if (characterNames.some(name => charName.includes(name))) {
            characterAppearances.set(charName, (characterAppearances.get(charName) || 0) + 1);
          }
        }
      }
    }

    // Note recurring characters
    for (const [name, count] of characterAppearances.entries()) {
      if (count >= 2) {
        notes.push(`${name} has appeared in ${count} recent chapter(s) - consider their ongoing journey.`);
      }
    }

    // Analyze location recurrence
    const locationNames = currentArc.locations?.map(l => l.locationName) || [];
    const locationAppearances = new Map();

    for (const chapter of relevantChapters) {
      for (const beat of chapter.beats) {
        const beatLoc = beat.location;
        if (beatLoc && locationNames.some(name => beatLoc.includes(name))) {
          locationAppearances.set(beatLoc, (locationAppearances.get(beatLoc) || 0) + 1);
        }
      }
    }

    for (const [loc, count] of locationAppearances.entries()) {
      if (count >= 2) {
        notes.push(`${loc} has been featured ${count} time(s) recently - build on its established atmosphere.`);
      }
    }

    // Analyze themes
    const recentThemes = relevantChapters
      .map(ch => ch.arcTheme)
      .filter(Boolean)
      .slice(0, 3);

    if (recentThemes.length > 0) {
      const uniqueThemes = [...new Set(recentThemes)];
      if (uniqueThemes.length === 1) {
        notes.push(`Recent chapters have focused on "${uniqueThemes[0]}" - consider evolving or contrasting this theme.`);
      }
    }

    return notes;
  }

  /**
   * Format context for AI prompt
   * @param {Object} context - Chapter context
   * @returns {string} Formatted prompt section
   */
  formatContextForPrompt(context) {
    let prompt = '';

    // Current arc info
    prompt += `CURRENT ARC: "${context.currentArc.title}"\n`;
    prompt += `Chapter ${context.currentArc.currentChapter + 1}\n`;
    prompt += `Theme: ${context.currentArc.theme}\n`;
    prompt += `Tone: ${context.currentArc.emotionalTone}\n\n`;

    // Characters with history
    if (context.characters.length > 0) {
      prompt += 'CHARACTERS:\n';
      for (const char of context.characters) {
        prompt += `- ${char.avatarName} (${char.role})`;
        if (char.previousRoles && char.previousRoles.length > 0) {
          prompt += ` [Previously: ${char.previousRoles.join(', ')}]`;
        }
        if (char.totalArcs > 0) {
          prompt += ` [Featured in ${char.totalArcs} arc(s)]`;
        }
        prompt += '\n';
      }
      prompt += '\n';
    }

    // Locations with history
    if (context.locations.length > 0) {
      prompt += 'LOCATIONS:\n';
      for (const loc of context.locations) {
        prompt += `- ${loc.locationName}`;
        if (loc.description) {
          prompt += `: ${loc.description}`;
        }
        prompt += '\n';
      }
      prompt += '\n';
    }

    // Relevant history
    if (context.relevantHistory.chapters.length > 0) {
      prompt += '--- RECENT HISTORY WITH THESE CHARACTERS/LOCATIONS ---\n';
      prompt += context.relevantHistory.summary + '\n\n';
    }

    // World context
    if (context.worldContext.chapters.length > 0) {
      prompt += '--- RECENT WORLD EVENTS ---\n';
      prompt += context.worldContext.summary + '\n\n';
    }

    // Continuity notes
    if (context.continuityNotes.length > 0) {
      prompt += '--- CONTINUITY NOTES ---\n';
      prompt += context.continuityNotes.join('\n') + '\n\n';
    }

    return prompt;
  }
}

export default ChapterContextService;
