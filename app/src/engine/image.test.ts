import { describe, expect, it } from 'vitest';
import { bytesToBase64, checkImageFile, fitSize, IMAGE_MESSAGES, MAX_FILE_BYTES, prepareImage } from './image';

describe('fitSize', () => {
  it('scales the long side down to 1024 and keeps the shape', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1024, height: 768 });
    expect(fitSize(1000, 3000)).toEqual({ width: 341, height: 1024 });
  });

  it('leaves small pictures as they are', () => {
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('never returns a zero size', () => {
    expect(fitSize(10000, 1)).toEqual({ width: 1024, height: 1 });
  });
});

describe('checkImageFile', () => {
  it('accepts pictures under the limit', () => {
    expect(checkImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    // some systems give no type; the decoder decides then
    expect(checkImageFile({ type: '', size: 1000 })).toBeNull();
  });

  it('refuses other files, big files and empty files', () => {
    expect(checkImageFile({ type: 'application/pdf', size: 1000 })).toBe(IMAGE_MESSAGES.notImage);
    expect(checkImageFile({ type: 'image/jpeg', size: MAX_FILE_BYTES + 1 })).toBe(IMAGE_MESSAGES.tooBig);
    expect(checkImageFile({ type: 'image/jpeg', size: 0 })).toBe(IMAGE_MESSAGES.unreadable);
  });
});

describe('bytesToBase64', () => {
  it('matches the standard encoding, also for long inputs', () => {
    expect(bytesToBase64(new TextEncoder().encode('GKod!'))).toBe('R0tvZCE=');
    expect(bytesToBase64(new Uint8Array())).toBe('');
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const back = Uint8Array.from(atob(bytesToBase64(bytes)), (char) => char.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});

describe('prepareImage', () => {
  it('rejects a file that is not a picture with a plain message', async () => {
    await expect(prepareImage(new Blob(['hello'], { type: 'text/plain' }))).rejects.toThrow(IMAGE_MESSAGES.notImage);
  });

  it('rejects a picture over 15 MB before decoding it', async () => {
    const big = new Blob([new Uint8Array(MAX_FILE_BYTES + 1)], { type: 'image/png' });
    await expect(prepareImage(big)).rejects.toThrow(IMAGE_MESSAGES.tooBig);
  });
});
