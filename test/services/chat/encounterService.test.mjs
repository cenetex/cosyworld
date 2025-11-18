import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EncounterService } from '../../../src/services/chat/encounterService.mjs';

describe('EncounterService', () => {
  let encounterService;
  let mockAvatarService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockAvatarService = {
      rollInitiative: vi.fn().mockResolvedValue(15)
    };

    encounterService = new EncounterService({
      logger: mockLogger,
      databaseService: {},
      avatarService: mockAvatarService,
      presenceService: {},
      configService: {}
    });
  });

  it('should start an encounter with sorted participants', async () => {
    const avatars = [
      { id: '1', name: 'Fast' },
      { id: '2', name: 'Slow' }
    ];

    mockAvatarService.rollInitiative
      .mockResolvedValueOnce(20) // Fast
      .mockResolvedValueOnce(5); // Slow

    const encounter = await encounterService.startEncounter('channel-1', avatars);

    expect(encounter.participants).toHaveLength(2);
    expect(encounter.participants[0].name).toBe('Fast');
    expect(encounter.participants[0].initiative).toBe(20);
    expect(encounter.participants[1].name).toBe('Slow');
    expect(encounter.participants[1].initiative).toBe(5);
    expect(encounter.currentTurnIndex).toBe(0);
  });

  it('should cycle turns correctly', async () => {
    const avatars = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' }
    ];
    
    mockAvatarService.rollInitiative.mockResolvedValue(10);
    
    await encounterService.startEncounter('channel-1', avatars);
    
    // Turn 0: A
    let turn = encounterService.getCurrentTurn('channel-1');
    expect(turn.name).toBe('A');

    // Next Turn: B
    turn = encounterService.nextTurn('channel-1');
    expect(turn.name).toBe('B');

    // Next Turn: A (Round 2)
    turn = encounterService.nextTurn('channel-1');
    expect(turn.name).toBe('A');
    
    const encounter = encounterService.getEncounter('channel-1');
    expect(encounter.round).toBe(2);
  });

  it('should allow joining an existing encounter', async () => {
    const avatars = [{ id: '1', name: 'A' }];
    mockAvatarService.rollInitiative.mockResolvedValue(10);
    
    await encounterService.startEncounter('channel-1', avatars);
    
    const newAvatar = { id: '2', name: 'B' };
    mockAvatarService.rollInitiative.mockResolvedValue(20); // Higher initiative
    
    await encounterService.joinEncounter('channel-1', newAvatar);
    
    const encounter = encounterService.getEncounter('channel-1');
    expect(encounter.participants).toHaveLength(2);
    // B should be first now because of higher initiative
    expect(encounter.participants[0].name).toBe('B');
  });

  it('should timeout inactive encounters', async () => {
    const avatars = [{ id: '1', name: 'A' }];
    await encounterService.startEncounter('channel-1', avatars);
    
    const encounter = encounterService.getEncounter('channel-1');
    expect(encounter).not.toBeNull();

    // Mock time passing
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000); // +10 mins

    const expired = encounterService.getEncounter('channel-1');
    expect(expired).toBeNull();
  });
});
