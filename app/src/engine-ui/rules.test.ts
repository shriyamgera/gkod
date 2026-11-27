import { describe, expect, it } from 'vitest';
import {
  bridgeProblem,
  chips,
  isSubmitKey,
  keyHint,
  keyProblem,
  otherModel,
  NOT_REMEMBERED,
  NOT_REMEMBERED_CODE,
  pairingProblem,
  pairingRememberMessage,
  PHOTO_ONLY_REQUEST,
  rememberMessage,
  requestText,
  titleFromRequest,
} from './rules';

describe('isSubmitKey', () => {
  it('makes the part on Enter', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: false })).toBe(true);
  });

  it('keeps Shift+Enter for a new line', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('ignores Enter while an input method is choosing a word', () => {
    expect(isSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isSubmitKey({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('requestText', () => {
  it('sends the typed words without outer spaces', () => {
    expect(requestText('  Phone stand, 80 mm wide \n', false)).toBe('Phone stand, 80 mm wide');
  });

  it('sends nothing when nothing is typed and there is no picture', () => {
    expect(requestText('', false)).toBeNull();
    expect(requestText(' \n ', false)).toBeNull();
  });

  it('sends a stand-in sentence when there is only a picture', () => {
    expect(requestText('  ', true)).toBe(PHOTO_ONLY_REQUEST);
  });

  it('sends each chip as typed words', () => {
    expect(chips).toEqual(['Phone stand', 'Wall hook with two screw holes', 'Cable clip']);
    for (const chip of chips) expect(requestText(chip, false)).toBe(chip);
  });
});

describe('titleFromRequest', () => {
  it('keeps a short request as it is, with a capital letter', () => {
    expect(titleFromRequest('phone stand, 80 mm wide')).toBe('Phone stand, 80 mm wide');
  });

  it('takes the first sentence only', () => {
    expect(titleFromRequest('A cable clip. It should hold two 5 mm cables.')).toBe('A cable clip');
    expect(titleFromRequest('Wall hook\nwith two screw holes')).toBe('Wall hook');
  });

  it('does not cut at a decimal point', () => {
    expect(titleFromRequest('Phone stand, 80.5 mm wide')).toBe('Phone stand, 80.5 mm wide');
  });

  it('shortens a long request at a word break', () => {
    const title = titleFromRequest('a phone stand for a 9 mm thick phone, tilted back a little, with a slot');
    expect(title).toBe('A phone stand for a 9 mm thick phone…');
    expect(title.length).toBeLessThanOrEqual(41);
  });

  it('names a part made from a picture only', () => {
    expect(titleFromRequest(PHOTO_ONLY_REQUEST, true)).toBe('Part from a picture');
    expect(titleFromRequest('', false)).toBe('New part');
  });
});

describe('keyHint', () => {
  it('shows only the last four characters', () => {
    const key = 'AQ.Ab8RN6LtestOnlyNotARealKeyxab12';
    const hint = keyHint(key);
    expect(hint).toBe('Key set (ends in ab12)');
    expect(hint).not.toContain(key.slice(0, 5));
  });

  it('shows none of a short key', () => {
    expect(keyHint('short-key-123')).toBe('Key set');
  });

  it('says when no key is set', () => {
    expect(keyHint(null)).toBe('No key set');
    expect(keyHint('')).toBe('No key set');
  });
});

describe('keyProblem', () => {
  it('accepts a pasted key with outer spaces', () => {
    expect(keyProblem('  AQ.Ab8RN6LtestOnlyNotARealKey  ')).toBeNull();
  });

  it('asks for a key when the field is empty', () => {
    expect(keyProblem('   ')).toBe('Paste your key first.');
  });

  it('refuses spaces inside and keys that are too short', () => {
    expect(keyProblem('AQ.Ab8RN6L testOnlyNotARealKey')).toMatch(/no spaces/);
    expect(keyProblem('AQ.short')).toMatch(/too short/);
  });
});

describe('otherModel', () => {
  const models = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('suggests the first model that is not the busy one', () => {
    expect(otherModel(models, 'a')?.id).toBe('b');
    expect(otherModel(models, 'b')?.id).toBe('a');
  });

  it('has nothing to suggest when there is one model', () => {
    expect(otherModel([{ id: 'a' }], 'a')).toBeUndefined();
  });
});

describe('rememberMessage', () => {
  it('says what happened to a new key', () => {
    expect(rememberMessage('new-key', true, true)).toBe('Key set and remembered on this device');
    expect(rememberMessage('new-key', false, false)).toBe('Key set for this tab');
  });

  it('says when the browser would not store the key', () => {
    expect(rememberMessage('new-key', true, false)).toBe(`Key set. ${NOT_REMEMBERED}`);
    expect(rememberMessage('box', true, false)).toBe(NOT_REMEMBERED);
  });

  it('says what a click on the box did', () => {
    expect(rememberMessage('box', true, true)).toBe('Key remembered on this device');
    expect(rememberMessage('box', false, false)).toBe('Key kept for this tab only');
  });
});

describe('pairingProblem', () => {
  it('accepts a code in any case, with or without dashes and spaces', () => {
    expect(pairingProblem('ABCD-EFGH-JKMN')).toBeNull();
    expect(pairingProblem(' abcd efgh jkmn ')).toBeNull();
    expect(pairingProblem('ABCDEFGHJKMN')).toBeNull();
  });

  it('says what is wrong with anything else', () => {
    expect(pairingProblem('')).toBe('Type the pairing code first.');
    expect(pairingProblem('ABCD-EFGH')).toContain('12 letters and digits');
    expect(pairingProblem('ABCD-EFGH-JKM0')).toContain('not a pairing code');
  });
});

describe('pairingRememberMessage', () => {
  it('never says the code is saved on the device', () => {
    expect(pairingRememberMessage('new-code', true, true)).toBe('Code set and kept until you close this tab');
    expect(pairingRememberMessage('new-code', false, false)).toBe('Code set until the page reloads');
    expect(pairingRememberMessage('box', true, true)).toBe('Code kept until you close this tab');
    expect(pairingRememberMessage('box', true, false)).toBe(NOT_REMEMBERED_CODE);
    for (const change of ['new-code', 'box'] as const) {
      for (const remembered of [true, false]) expect(pairingRememberMessage(change, true, remembered)).not.toContain('device');
    }
  });
});

describe('bridgeProblem', () => {
  const ready = { claudeFound: true, claudeVersion: '2.1.276', loggedIn: true, toolsFound: true, busy: false };

  it('is nothing when the bridge can make parts', () => {
    expect(bridgeProblem(ready)).toBeNull();
    expect(bridgeProblem({ ...ready, loggedIn: null, toolsFound: null })).toBeNull();
  });

  it('says what is missing, the most basic first', () => {
    expect(bridgeProblem({ ...ready, claudeFound: false, toolsFound: false })).toContain('cannot find Claude Code');
    expect(bridgeProblem({ ...ready, loggedIn: false })).toContain('not logged in');
    expect(bridgeProblem({ ...ready, toolsFound: false })).toContain('GKod’s tools');
  });
});
