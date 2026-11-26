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

// The first other model on the list, to suggest when the chosen one is busy.
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
