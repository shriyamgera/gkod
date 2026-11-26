const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;

/** Reads the corners of a binary STL: nine numbers per triangle. The stored normals are ignored. */
export function readStl(input: ArrayBuffer | Uint8Array): Float32Array {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error(`STL file is too short: ${bytes.byteLength} bytes, need at least ${HEADER_BYTES}.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const needed = HEADER_BYTES + triangles * TRIANGLE_BYTES;
  if (bytes.byteLength < needed) {
    const text = String.fromCharCode(...bytes.subarray(0, 5)) === 'solid';
    throw new Error(
      text
        ? 'This is a text STL file. Only binary STL is supported.'
        : `STL file is cut short: it says ${triangles} triangles (${needed} bytes) but has ${bytes.byteLength} bytes.`,
    );
  }
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const at = HEADER_BYTES + t * TRIANGLE_BYTES + 12;
    for (let i = 0; i < 9; i++) positions[t * 9 + i] = view.getFloat32(at + i * 4, true);
  }
  return positions;
}
