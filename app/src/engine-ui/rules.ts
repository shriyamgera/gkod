export const chips = ['Phone stand', 'Wall hook with two screw holes', 'Cable clip'];

export const PHOTO_ONLY_REQUEST = 'The part in this picture';

type KeyEvent = { key: string; shiftKey: boolean; isComposing?: boolean };

// Enter makes the part; Shift+Enter adds a new line; Enter that confirms an input-method word does neither.
export function isSubmitKey(event: KeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

// What a "Make it" press sends: the typed words, or a stand-in sentence when only a picture is given.
export function requestText(prompt: string, hasImage: boolean): string | null {
  const words = prompt.trim();
  if (words) return words;
  return hasImage ? PHOTO_ONLY_REQUEST : null;
}

// A short title for a made part, from the request.
export function titleFromRequest(request: string, hasImage = false): string {
  const first = request.trim().split(/[\n!?;]|\.(?=\s|$)/)[0]?.trim().replace(/[,:\s]+$/, '') ?? '';
  if (!first || first === PHOTO_ONLY_REQUEST) return hasImage ? 'Part from a picture' : 'New part';
  const max = 40;
  let title = first;
  if (title.length > max) {
    const cut = title.slice(0, max + 1);
    const space = cut.lastIndexOf(' ');
    title = `${(space > 12 ? cut.slice(0, space) : title.slice(0, max)).replace(/[,:\s]+$/, '')}…`;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// Shows at most the last four characters, and none of a key too short to hide the rest.
export function keyHint(key: string | null): string {
  if (!key) return 'No key set';
  const trimmed = key.trim();
  return trimmed.length >= 16 ? `Key set (ends in ${trimmed.slice(-4)})` : 'Key set';
}

// Returns a plain message when the pasted text cannot be a key, else null.
export function keyProblem(input: string): string | null {
  const key = input.trim();
  if (!key) return 'Paste your key first.';
  if (/\s/.test(key)) return 'A key has no spaces. Copy it again from Google AI Studio.';
  if (key.length < 20) return 'This is too short to be a key. Copy the whole key.';
  return null;
}

// The first other model on the list, to suggest when one has hit its limit.
export function otherModel<T extends { id: string }>(models: T[], current: string | undefined): T | undefined {
  return models.find((model) => model.id !== current);
}

export const NOT_REMEMBERED = 'This browser would not let the key be remembered, so it is kept for this tab only.';

// What the key panel says after a new key or a click on the remember box, from what the key store really did.
export function rememberMessage(change: 'new-key' | 'box', asked: boolean, remembered: boolean): string {
  if (asked && !remembered) return change === 'new-key' ? `Key set. ${NOT_REMEMBERED}` : NOT_REMEMBERED;
  if (change === 'new-key') return remembered ? 'Key set and remembered on this device' : 'Key set for this tab';
  return remembered ? 'Key remembered on this device' : 'Key kept for this tab only';
}

// The bridge's codes use these letters and digits only (no 0, O, 1, I or L), in three groups of four.
const PAIRING_LETTERS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

// Returns a plain message when the typed text cannot be a pairing code, else null.
export function pairingProblem(input: string): string | null {
  const plain = input.toUpperCase().replace(/[\s-]/g, '');
  if (!plain) return 'Type the pairing code first.';
  if (plain.length !== 12) return 'A pairing code has 12 letters and digits, like ABCD-EFGH-JKMN.';
  if (!PAIRING_LETTERS.test(plain)) return 'This is not a pairing code. Copy it again from the bridge’s terminal.';
  return null;
}

export const NOT_REMEMBERED_CODE = 'This browser would not let the code be remembered, so it is kept for this tab only.';

export function pairingRememberMessage(change: 'new-code' | 'box', asked: boolean, remembered: boolean): string {
  if (asked && !remembered) return change === 'new-code' ? `Code set. ${NOT_REMEMBERED_CODE}` : NOT_REMEMBERED_CODE;
  if (change === 'new-code') return remembered ? 'Code set and remembered on this device' : 'Code set for this tab';
  return remembered ? 'Code remembered on this device' : 'Code kept for this tab only';
}

// What the status line says while Claude Code works, under the step it is on.
export const CLAUDE_SLOW_NOTE = 'Claude Code tests the part with GKod’s tools before it answers, so this can take a minute or two.';
