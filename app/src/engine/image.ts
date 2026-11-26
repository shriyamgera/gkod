import type { ImageInput } from './types';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SIDE = 1024;
const QUALITY = 0.85;

export const IMAGE_MESSAGES = {
  notImage: 'That file is not a picture. Use a JPEG, PNG or WebP image.',
  tooBig: 'That picture is over 15 MB. Pick a smaller one.',
  unreadable: 'That picture could not be opened. Use a JPEG, PNG or WebP image.',
} as const;

export function checkImageFile(file: { size: number; type: string }): string | null {
  if (file.type && !file.type.startsWith('image/')) return IMAGE_MESSAGES.notImage;
  if (file.size > MAX_FILE_BYTES) return IMAGE_MESSAGES.tooBig;
  if (file.size === 0) return IMAGE_MESSAGES.unreadable;
  return null;
}

// Scales down so the long side is at most maxSide; small pictures keep their size.
export function fitSize(width: number, height: number, maxSide = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

// JPEG has no transparency, so the picture is drawn on white.
function draw(context: Context | null, bitmap: ImageBitmap, width: number, height: number) {
  if (!context) throw new Error(IMAGE_MESSAGES.unreadable);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
}

async function toJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    draw(canvas.getContext('2d'), bitmap, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), bitmap, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(IMAGE_MESSAGES.unreadable))), 'image/jpeg', QUALITY),
  );
}

// Turns a chosen photo or sketch into a small JPEG to send with the request. Rejects with a plain message.
export async function prepareImage(file: File | Blob): Promise<ImageInput> {
  const problem = checkImageFile(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(IMAGE_MESSAGES.unreadable);
  }
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const jpeg = await toJpeg(bitmap, width, height);
    const base64 = bytesToBase64(new Uint8Array(await jpeg.arrayBuffer()));
    return { mimeType: 'image/jpeg', base64, width, height };
  } catch {
    throw new Error(IMAGE_MESSAGES.unreadable);
  } finally {
    bitmap.close();
  }
}
