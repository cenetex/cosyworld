import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the model shipped in the standalone design preview.
const html = readFileSync(new URL('../docs/design/avatar-simulation-prototype.html', import.meta.url), 'utf8');
const model = html.split('// BEGIN CARD GAME MODEL')[1].split('// END CARD GAME MODEL')[0];
const createGame = vm.runInNewContext(`${model}\ncreateCardGame;`);
const snapshot = game => JSON.stringify(game.state);
const play = (game, card, target = 'self') => expect(game.play(card, target)).toBe(true);

describe('playable card game design', () => {
  it('keeps inspection free and rejects an unavailable or stale play', () => {
    const game = createGame();
    const before = snapshot(game);
    game.table();
    game.getOffer('mint', 'pip');
    expect(game.play('mint', 'mara')).toBe(false);
    expect(snapshot(game)).toBe(before);
    play(game, 'mint', 'pip');
    const traded = snapshot(game);
    expect(game.play('mint', 'rati')).toBe(false);
    expect(snapshot(game)).toBe(traded);
  });

  it('spends approaches and recovers them once through a paid rest', () => {
    const game = createGame();
    play(game, 'reach', 'pip');
    play(game, 'notice', 'garden');
    expect(game.state.spent).toEqual(['reach', 'notice']);
    expect(game.play('reach', 'rati')).toBe(false);
    play(game, 'breathe');
    expect(game.state.tick).toBe(3);
    expect(game.state.spent).toEqual([]);
    expect(game.state.hand.filter(id => id === 'reach')).toHaveLength(1);
    play(game, 'breathe');
    expect(game.state.hand.filter(id => id === 'notice')).toHaveLength(1);
    expect(game.state.hand).toContain('seed');
  });

  it('lets one traded ring create distinct lasting outcomes', () => {
    const lantern = createGame();
    play(lantern, 'mint', 'pip');
    play(lantern, 'ring', 'mara');
    play(lantern, 'breathe');
    play(lantern, 'breathe');
    expect(lantern.state.ring).toBe('lantern');
    expect(lantern.state.outdoorMeal).toBe(true);
    const chime = createGame();
    play(chime, 'mint', 'pip');
    play(chime, 'ring', 'garden');
    for (let i = 0; i < 4; i += 1) play(chime, 'breathe');
    expect(chime.state.ring).toBe('chime');
    expect(chime.state.chime).toBe(true);
    expect(chime.state.lamp).toBe('sheltered');
    expect(chime.state.outdoorMeal).toBe(false);
  });

  it('lets the cast finish its own plans during rest', () => {
    const game = createGame();
    for (let i = 0; i < 6; i += 1) play(game, 'breathe');
    expect(game.state.meal).toBe(true);
    expect(game.state.lamp).toBe('sheltered');
    expect(game.state.pipAtTable).toBe(true);
    expect(game.state.acorn).toBe(true);
    expect(game.state.activations).toEqual({ Rati: 6, Mara: 6, Pip: 6 });
  });

  it('keeps an invitation after a refusal and lets changed plans affect the reply', () => {
    const game = createGame();
    play(game, 'reach', 'rati');
    play(game, 'invite', 'pip');
    expect(game.state.hand).toContain('invite');
    expect(game.state.pipInvited).toBe(false);
    expect(game.state.acorn).toBe(true);
    play(game, 'invite', 'pip');
    expect(game.state.pipInvited).toBe(true);
    expect(game.state.hand).not.toContain('invite');
    play(game, 'breathe');
    expect(game.state.pipAtTable).toBe(true);
  });

  it('turns friendship and a gift into shared planting on Pip’s own turn', () => {
    const game = createGame();
    play(game, 'reach', 'pip');
    play(game, 'notice', 'garden');
    play(game, 'seed', 'pip');
    expect(game.state.sharedPlanting).toBe(true);
    expect(game.state.seeds).toBe('planted');
    expect(game.state.hand).not.toContain('seed');
    expect(game.play('seed', 'garden')).toBe(false);
  });

  it('changes the use of mint after soup is served', () => {
    const early = createGame();
    play(early, 'mint', 'rati');
    expect(early.state.potMint).toBe(true);
    const late = createGame();
    for (let i = 0; i < 3; i += 1) play(late, 'breathe');
    expect(late.getOffer('mint', 'rati').label).toBe('Make tea for Rati');
    play(late, 'mint', 'rati');
    expect(late.state.potMint).toBe(false);
  });

  it('replays a visit exactly from its card choices', () => {
    const game = createGame();
    play(game, 'reach', 'pip');
    play(game, 'mint', 'pip');
    play(game, 'ring', 'garden');
    play(game, 'breathe');
    const restored = createGame();
    game.state.moves.forEach(move => play(restored, move.card, move.target));
    expect(snapshot(restored)).toBe(snapshot(game));
  });

  it('conserves items and allows a next move across varied sequences', () => {
    let seed = 42;
    const random = count => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % count; };
    for (let run = 0; run < 100; run += 1) {
      const game = createGame();
      for (let turn = 0; turn < 40; turn += 1) {
        const choices = game.state.hand.flatMap(card => ['rati', 'mara', 'pip', 'garden', 'self'].filter(target => game.getOffer(card, target)).map(target => ({ card, target })));
        expect(choices.length).toBeGreaterThan(0);
        const move = choices[random(choices.length)];
        play(game, move.card, move.target);
        const state = game.state;
        expect(new Set(state.hand).size).toBe(state.hand.length);
        expect(state.hand.some(id => state.spent.includes(id))).toBe(false);
        expect(state.mintGrowing + Number(state.hand.includes('mint')) + state.mintUsed).toBe(2);
        expect(state.hand.includes('ring')).toBe(state.ring === 'Briony');
        expect(state.hand.includes('seed')).toBe(state.seeds === 'Briony');
        expect(Object.values(state.activations)).toEqual([state.tick, state.tick, state.tick]);
      }
    }
  });
});
