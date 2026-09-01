import { describe, expect, it } from 'vitest';
import {
  cycle, dirForCode, eventCode, flatIndexOf, isBack, isConfirm, moveGrid,
  moveList, moveRagged, moveSkippingDisabled, rowColOf, tabDeltaForCode,
} from '../../src/ui/focus';

describe('rowColOf / flatIndexOf', () => {
  it('decomposes a ragged grid', () => {
    const rows = [4, 4, 2];
    expect(rowColOf(0, rows)).toEqual({ row: 0, col: 0 });
    expect(rowColOf(5, rows)).toEqual({ row: 1, col: 1 });
    expect(rowColOf(9, rows)).toEqual({ row: 2, col: 1 });
  });

  it('clamps out-of-range indices', () => {
    const rows = [3, 3];
    expect(rowColOf(-4, rows)).toEqual({ row: 0, col: 0 });
    expect(rowColOf(99, rows)).toEqual({ row: 1, col: 2 });
  });

  it('clamps the column into the destination row', () => {
    const rows = [4, 4, 2];
    expect(flatIndexOf(2, 3, rows)).toBe(9); // row 2 only has 2 entries
    expect(flatIndexOf(1, 0, rows)).toBe(4);
  });
});

describe('moveGrid — uneven last row', () => {
  const COUNT = 10; // rows of 4, 4, 2
  const COLS = 4;

  it('moves down within full rows', () => {
    expect(moveGrid(2, 'down', COUNT, COLS)).toBe(6);
    expect(moveGrid(0, 'down', COUNT, COLS)).toBe(4);
  });

  it('clamps into the short last row instead of vanishing', () => {
    expect(moveGrid(6, 'down', COUNT, COLS)).toBe(9);
    expect(moveGrid(7, 'down', COUNT, COLS)).toBe(9);
    expect(moveGrid(5, 'down', COUNT, COLS)).toBe(9);
    expect(moveGrid(4, 'down', COUNT, COLS)).toBe(8);
  });

  it('keeps the column coming back up out of the short row', () => {
    expect(moveGrid(9, 'up', COUNT, COLS)).toBe(5);
    expect(moveGrid(8, 'up', COUNT, COLS)).toBe(4);
  });

  it('blocks at edges unless wrapping is requested', () => {
    expect(moveGrid(3, 'right', COUNT, COLS)).toBe(3);
    expect(moveGrid(3, 'right', COUNT, COLS, { wrapX: true })).toBe(0);
    expect(moveGrid(0, 'up', COUNT, COLS)).toBe(0);
    expect(moveGrid(0, 'up', COUNT, COLS, { wrapY: true })).toBe(8);
    expect(moveGrid(9, 'right', COUNT, COLS)).toBe(9);
    expect(moveGrid(9, 'down', COUNT, COLS)).toBe(9);
  });

  it('handles a 4x4 team grid exactly', () => {
    expect(moveGrid(0, 'right', 16, 4)).toBe(1);
    expect(moveGrid(3, 'down', 16, 4)).toBe(7);
    expect(moveGrid(15, 'down', 16, 4)).toBe(15);
    expect(moveGrid(12, 'left', 16, 4)).toBe(12);
  });
});

describe('moveRagged', () => {
  it('skips empty rows', () => {
    const rows = [2, 0, 3];
    expect(moveRagged(0, 'down', rows)).toBe(2);
    expect(moveRagged(3, 'up', rows)).toBe(1);
  });

  it('returns 0 for an empty layout', () => {
    expect(moveRagged(3, 'down', [])).toBe(0);
    expect(moveGrid(0, 'down', 0, 3)).toBe(0);
  });
});

describe('moveList', () => {
  it('wraps vertically by default and ignores horizontal input', () => {
    expect(moveList(0, 'down', 3)).toBe(1);
    expect(moveList(2, 'down', 3)).toBe(0);
    expect(moveList(0, 'up', 3)).toBe(2);
    expect(moveList(1, 'left', 3)).toBe(1);
  });

  it('can be told not to wrap', () => {
    expect(moveList(2, 'down', 3, { wrapY: false })).toBe(2);
  });
});

describe('moveSkippingDisabled', () => {
  const rows = [1, 1, 1, 1];

  it('jumps over disabled entries', () => {
    const enabled = (i: number): boolean => i === 0 || i === 3;
    expect(moveSkippingDisabled(0, 'down', rows, enabled)).toBe(3);
  });

  it('stays put when everything ahead is disabled', () => {
    const enabled = (i: number): boolean => i === 0;
    expect(moveSkippingDisabled(0, 'down', rows, enabled, { wrapY: false })).toBe(0);
  });

  it('wraps around to an enabled entry', () => {
    const enabled = (i: number): boolean => i !== 1 && i !== 2;
    expect(moveSkippingDisabled(3, 'down', rows, enabled, { wrapY: true })).toBe(0);
  });
});

describe('key mapping', () => {
  it('maps arrows and WASD to directions', () => {
    expect(dirForCode('ArrowUp')).toBe('up');
    expect(dirForCode('KeyW')).toBe('up');
    expect(dirForCode('KeyD')).toBe('right');
    expect(dirForCode('KeyZ')).toBeNull();
  });

  it('recognises confirm and back', () => {
    expect(isConfirm('Enter')).toBe(true);
    expect(isConfirm('Space')).toBe(true);
    expect(isBack('Escape')).toBe(true);
    expect(isBack('Enter')).toBe(false);
  });

  it('maps Q/E to tab deltas and cycles', () => {
    expect(tabDeltaForCode('KeyQ')).toBe(-1);
    expect(tabDeltaForCode('KeyE')).toBe(1);
    expect(tabDeltaForCode('KeyR')).toBe(0);
    expect(cycle(0, -1, 5)).toBe(4);
    expect(cycle(4, 1, 5)).toBe(0);
    expect(cycle(0, 1, 0)).toBe(0);
  });
});

describe('eventCode fallback', () => {
  it('prefers KeyboardEvent.code', () => {
    expect(eventCode({ code: 'KeyW', key: 'w' })).toBe('KeyW');
  });

  it('derives a code from .key for synthetic events', () => {
    expect(eventCode({ key: 'w' })).toBe('KeyW');
    expect(eventCode({ code: '', key: 'W' })).toBe('KeyW');
    expect(eventCode({ key: '3' })).toBe('Digit3');
    expect(eventCode({ key: ' ' })).toBe('Space');
    expect(eventCode({ key: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(eventCode({ key: 'Enter' })).toBe('Enter');
    expect(eventCode({ key: 'Escape' })).toBe('Escape');
  });

  it('returns an empty code it cannot map', () => {
    expect(eventCode({})).toBe('');
    expect(eventCode({ key: 'Dead' })).toBe('');
    expect(eventCode({ key: '/' })).toBe('');
  });
});
