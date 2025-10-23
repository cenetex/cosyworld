/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * StoryArchiveService
 * 
 * Manages story archive functionality:
 * - Groups beats into chapters for display
 * - Generates chapter summaries
 * - Handles "latest" vs "archive" views
 * - Manages character continuity across arcs
 */
export class StoryArchiveService {
  constructor({ storyStateService, aiService, logger }) {
    this.storyState = storyStateService;
    this.aiService = aiService;
    this.logger = logger || console;
    
    this.config = {
      beatsPerChapter: 3,
      latestChaptersCount: 3, // Show 3 most recent chapters in "latest" view
      archivePageSize: 10,
      coreCharactersCount: 12 // Track 12 core characters across arcs
    };
  }

  /**
   * Get archived arcs (paginated)
   * Returns one entry per arc with summary, counts, and a thumbnail.
   * @param {Object} options
   * @param {number} options.page - Page number (1-indexed)
   * @param {number} options.limit - Items per page
   * @returns {Promise<Object>} Paginated arc list
   */
  async getArchivedArcs(options = {}) {
    try {
      const {
        page = 1,
        limit = 10
      } = options;

      // Fetch arcs (active and completed), newest first
      const arcs = await this.storyState.getArcs(
        { status: { $in: ['completed', 'active'] } },
        { sort: { updatedAt: -1, createdAt: -1 } }
      );

      const arcCards = arcs.map((arc) => {
        const beats = arc.beats || [];
        const chapters = this._groupBeatsIntoChapters(arc);

        // Find a good thumbnail: prefer first image of the most recent completed chapter; fallback to first beat with image
        let thumbnail = null;
        for (let i = chapters.length - 1; i >= 0; i--) {
          const ch = chapters[i];
          if (ch.isComplete && ch.thumbnail) { thumbnail = ch.thumbnail; break; }
        }
        if (!thumbnail) {
          const firstWithImage = beats.find(b => b.generatedImageUrl);
          thumbnail = firstWithImage?.generatedImageUrl || null;
        }

        // Summary: prefer stored arc.summary; else derive from first completed chapter or first chapter
        let summary = arc.summary || '';
        if (!summary) {
          const firstCompleted = chapters.find(c => c.isComplete);
          summary = (firstCompleted?.summary) || (chapters[0]?.summary) || 'A CosyWorld adventure.';
        }

        // Last updated: prefer last beat's postedAt; else arc.updatedAt/createdAt
        const lastBeat = beats[beats.length - 1];
        const lastUpdated = lastBeat?.postedAt || arc.updatedAt || arc.createdAt || null;

        return {
          id: arc._id?.toString?.() || String(arc._id),
          title: arc.title,
          theme: arc.theme,
          emotionalTone: arc.emotionalTone,
          status: arc.status,
          createdAt: arc.createdAt,
          updatedAt: arc.updatedAt,
          lastUpdated,
          beatsCount: beats.length,
          chaptersCount: Math.ceil(beats.length / this.config.beatsPerChapter),
          completedChapters: chapters.filter(c => c.isComplete).length,
          thumbnail,
          summary,
          chapterVideos: arc.chapterVideos || {},
          episodeVideos: arc.episodeVideos || null
        };
      });

      // Paginate
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedArcs = arcCards.slice(startIndex, endIndex);

      return {
        success: true,
        arcs: paginatedArcs,
        pagination: {
          page,
          limit,
          total: arcCards.length,
          totalPages: Math.ceil(arcCards.length / limit),
          hasMore: endIndex < arcCards.length
        }
      };
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting archived arcs:', error);
      throw error;
    }
  }

  /**
   * Get the latest chapters (current + recent completed)
   * @param {string|ObjectId} arcId - Arc ID (optional, uses active arc if not provided)
   * @returns {Promise<Object>} Latest chapters with metadata
   */
  async getLatestChapters(arcId = null) {
    try {
      // Get active arc if arcId not provided
      let arc;
      if (arcId) {
        arc = await this.storyState.getArc(arcId);
      } else {
        const activeArcs = await this.storyState.getActiveArcs();
        arc = activeArcs[0] || null;
      }
      
      if (!arc) {
        return {
          success: false,
          message: 'No active story found',
          chapters: []
        };
      }
      
      // Group beats into chapters
      const allChapters = this._groupBeatsIntoChapters(arc);
      
      // Get latest N chapters
      const latestChapters = allChapters.slice(-this.config.latestChaptersCount);
      
      return {
        success: true,
        arc: {
          id: arc._id.toString(),
          title: arc.title,
          theme: arc.theme,
          emotionalTone: arc.emotionalTone,
          status: arc.status,
          totalBeats: arc.beats?.length || 0,
          plannedBeats: arc.plannedBeats
        },
        chapters: latestChapters,
        totalChapters: allChapters.length,
        isComplete: arc.status === 'completed'
      };
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting latest chapters:', error);
      throw error;
    }
  }

  /**
   * Get archived chapters (paginated)
   * @param {Object} options - Query options
   * @param {string} options.arcId - Arc ID (optional)
   * @param {number} options.page - Page number (1-indexed)
   * @param {number} options.limit - Items per page
   * @returns {Promise<Object>} Paginated archive
   */
  async getArchivedChapters(options = {}) {
    try {
      const {
        arcId = null,
        page = 1,
        limit = this.config.archivePageSize
      } = options;
      
      let arcs;
      if (arcId) {
        const arc = await this.storyState.getArc(arcId);
        arcs = arc ? [arc] : [];
      } else {
        // Get all arcs (excluding latest/active which is shown in "latest" view)
        arcs = await this.storyState.getArcs(
          { status: { $in: ['completed', 'active'] } },
          { sort: { createdAt: -1 } }
        );
      }
      
      // Group all chapters from all arcs
      const allChapters = [];
      for (const arc of arcs) {
        const chapters = this._groupBeatsIntoChapters(arc);
        
        // Add arc metadata to each chapter
        for (const chapter of chapters) {
          allChapters.push({
            ...chapter,
            arcId: arc._id.toString(),
            arcTitle: arc.title,
            arcTheme: arc.theme,
            arcStatus: arc.status
          });
        }
      }
      
      // Sort by completion date (newest first)
      allChapters.sort((a, b) => 
        new Date(b.completedAt || 0) - new Date(a.completedAt || 0)
      );
      
      // Paginate
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedChapters = allChapters.slice(startIndex, endIndex);
      
      return {
        success: true,
        chapters: paginatedChapters,
        pagination: {
          page,
          limit,
          total: allChapters.length,
          totalPages: Math.ceil(allChapters.length / limit),
          hasMore: endIndex < allChapters.length
        }
      };
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting archived chapters:', error);
      throw error;
    }
  }

  /**
   * Get a specific chapter by number
   * @param {string|ObjectId} arcId - Arc ID
   * @param {number} chapterNumber - Chapter number (1-indexed)
   * @returns {Promise<Object>} Chapter data
   */
  async getChapter(arcId, chapterNumber) {
    try {
      const arc = await this.storyState.getArc(arcId);
      if (!arc) {
        throw new Error('Arc not found');
      }
      
      const chapters = this._groupBeatsIntoChapters(arc);
      const chapter = chapters.find(c => c.chapterNumber === chapterNumber);
      
      if (!chapter) {
        throw new Error(`Chapter ${chapterNumber} not found`);
      }
      
      return {
        success: true,
        arc: {
          id: arc._id.toString(),
          title: arc.title,
          theme: arc.theme,
          emotionalTone: arc.emotionalTone
        },
        chapter
      };
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting chapter:', error);
      throw error;
    }
  }

  /**
   * Group beats into chapters (3 beats per chapter)
   * @private
   * @param {Object} arc - Story arc
   * @returns {Array<Object>} Chapters with beats
   */
  _groupBeatsIntoChapters(arc) {
    const beats = arc.beats || [];
    const chapters = [];
    
    // Build character lookup map from arc characters
    const characterMap = new Map();
    if (arc.characters) {
      for (const char of arc.characters) {
        // Support both string names and character objects
        const name = typeof char === 'string' ? char : char.avatarName;
        characterMap.set(name.toLowerCase(), char);
      }
    }
    
    for (let i = 0; i < beats.length; i += this.config.beatsPerChapter) {
      const chapterBeats = beats.slice(i, i + this.config.beatsPerChapter);
      const chapterNumber = Math.floor(i / this.config.beatsPerChapter) + 1;
      
      // Get thumbnail (first beat's image)
      const thumbnail = chapterBeats[0]?.generatedImageUrl || null;
      
      // Generate chapter summary from beat descriptions
      const summary = this._generateChapterSummary(chapterBeats);
      
      // Get completion date (last beat's posted date)
      const completedAt = chapterBeats[chapterBeats.length - 1]?.postedAt || null;
      
      // Check if chapter has generated videos
      const chapterKey = `chapter_${chapterNumber}`;
      const hasVideos = !!(arc.chapterVideos && arc.chapterVideos[chapterKey] && 
                           arc.chapterVideos[chapterKey].videoUrls && 
                           arc.chapterVideos[chapterKey].videoUrls.length > 0);
      
      chapters.push({
        chapterNumber,
        arcId: arc._id?.toString?.() || String(arc._id),
        startBeatIndex: i,
        endBeatIndex: i + chapterBeats.length - 1,
        beatCount: chapterBeats.length,
        hasVideos,
        beats: chapterBeats.map(beat => {
          // Enrich character data if available
          const enrichedCharacters = [];
          if (beat.characters && Array.isArray(beat.characters)) {
            for (const charName of beat.characters) {
              const charData = characterMap.get(charName.toLowerCase());
              if (charData && typeof charData === 'object') {
                enrichedCharacters.push({
                  avatarId: charData.avatarId,
                  avatarName: charData.avatarName,
                  imageUrl: charData.imageUrl
                });
              }
            }
          }
          
          return {
            id: beat.id,
            sequenceNumber: beat.sequenceNumber,
            type: beat.type,
            title: beat.title, // Include title for title cards
            description: beat.description,
            location: beat.location,
            characters: enrichedCharacters.length > 0 ? enrichedCharacters : (beat.characters || []),
            visualPrompt: beat.visualPrompt,
            generatedImageUrl: beat.generatedImageUrl,
            caption: beat.caption,
            postedAt: beat.postedAt,
            socialPosts: beat.socialPosts
          };
        }),
        thumbnail,
        summary,
        completedAt,
        isComplete: chapterBeats.length === this.config.beatsPerChapter
      });
    }
    
    return chapters;
  }

  /**
   * Generate a summary for a chapter from its beats
   * @private
   * @param {Array<Object>} beats - Beats in the chapter
   * @returns {string} Chapter summary
   */
  _generateChapterSummary(beats) {
    if (beats.length === 0) return 'Empty chapter';
    
    // For title cards, use the caption
    if (beats[0].type === 'title') {
      return beats[0].caption || beats[0].description?.substring(0, 150) || 'Title card';
    }
    
    // Combine first sentences of each beat
    const sentences = beats
      .map(beat => {
        const desc = beat.description || '';
        const firstSentence = desc.match(/^[^.!?]+[.!?]/);
        return firstSentence ? firstSentence[0].trim() : desc.substring(0, 80);
      })
      .filter(Boolean);
    
    // Join and limit length
    const summary = sentences.join(' ');
    return summary.length > 200 
      ? summary.substring(0, 197) + '...'
      : summary;
  }

  /**
   * Get core characters used across multiple arcs
   * Tracks character usage to maintain continuity
   * @returns {Promise<Object>} Core characters with usage stats
   */
  async getCoreCharacters() {
    try {
      // Get all completed and active arcs
      const arcs = await this.storyState.getArcs(
        { status: { $in: ['completed', 'active'] } },
        { sort: { createdAt: -1 }, limit: 10 } // Last 10 arcs
      );
      
      // Count character appearances
      const characterMap = new Map();
      
      for (const arc of arcs) {
        if (!arc.characters) continue;
        
        for (const char of arc.characters) {
          if (!char.avatarId) continue;
          
          const key = char.avatarId.toString();
          if (!characterMap.has(key)) {
            characterMap.set(key, {
              avatarId: char.avatarId,
              avatarName: char.avatarName,
              appearances: 0,
              roles: [],
              lastFeatured: null,
              arcs: []
            });
          }
          
          const charData = characterMap.get(key);
          charData.appearances++;
          charData.roles.push(char.role);
          charData.arcs.push({
            arcId: arc._id,
            arcTitle: arc.title,
            role: char.role
          });
          
          // Track most recent appearance
          if (!charData.lastFeatured || arc.createdAt > charData.lastFeatured) {
            charData.lastFeatured = arc.createdAt;
          }
        }
      }
      
      // Convert to array and sort by appearances
      const characters = Array.from(characterMap.values())
        .sort((a, b) => b.appearances - a.appearances);
      
      // Get top N core characters
      const coreCharacters = characters.slice(0, this.config.coreCharactersCount);
      
      return {
        success: true,
        coreCharacters,
        totalCharacters: characters.length,
        arcsAnalyzed: arcs.length
      };
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting core characters:', error);
      throw error;
    }
  }

  /**
   * Generate AI summary for an entire arc
   * @param {string|ObjectId} arcId - Arc ID
   * @returns {Promise<string>} Arc summary
   */
  async generateArcSummary(arcId) {
    try {
      const arc = await this.storyState.getArc(arcId);
      if (!arc) {
        throw new Error('Arc not found');
      }
      
      // If already has summary, return it
      if (arc.summary) {
        return arc.summary;
      }
      
      // Generate summary using AI
      const chapters = this._groupBeatsIntoChapters(arc);
      
      const summaryPrompt = `Generate a compelling 2-3 sentence summary of this story arc.

Arc: "${arc.title}"
Theme: ${arc.theme}
Tone: ${arc.emotionalTone}
Total Chapters: ${chapters.length}

Chapter summaries:
${chapters.map((ch, i) => `Chapter ${i + 1}: ${ch.summary}`).join('\n')}

Create a summary that captures the essence of the story, key character developments, and emotional journey.`;

      const response = await this.aiService.chat([
        { role: 'user', content: summaryPrompt }
      ], {
        temperature: 0.7
      });
      
      const summary = response.trim();
      
      // Save summary to arc
      await this.storyState.updateArc(arcId, { summary });
      
      return summary;
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error generating arc summary:', error);
      // Return fallback summary
      const arc = await this.storyState.getArc(arcId);
      return `${arc.title}: A ${arc.theme} story in CosyWorld featuring ${arc.characters?.length || 0} characters across ${Math.ceil((arc.beats?.length || 0) / 3)} chapters.`;
    }
  }

  /**
   * Get statistics for the archive
   * @returns {Promise<Object>} Archive statistics
   */
  async getArchiveStats() {
    try {
      const stats = await this.storyState.getStatistics();
      const coreChars = await this.getCoreCharacters();
      
      // Count total chapters
      const arcs = await this.storyState.getArcs({});
      let totalChapters = 0;
      for (const arc of arcs) {
        totalChapters += Math.ceil((arc.beats?.length || 0) / this.config.beatsPerChapter);
      }
      
      return {
        success: true,
        totalArcs: stats.totalArcs,
        totalChapters,
        totalBeats: arcs.reduce((sum, arc) => sum + (arc.beats?.length || 0), 0),
        activeArcs: stats.activeArcs,
        completedArcs: stats.completedArcs,
        coreCharacters: coreChars.coreCharacters.length,
        avgChaptersPerArc: totalChapters / (stats.totalArcs || 1)
      };
      
    } catch (error) {
      this.logger.error('[StoryArchive] Error getting archive stats:', error);
      throw error;
    }
  }
}

export default StoryArchiveService;
