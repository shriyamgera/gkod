// Test meshes built in code. Every face is wound so its normal points out of the solid.

export type Point = [number, number, number];
export type Triangle = [Point, Point, Point];

export function toPositions(triangles: Triangle[]): Float32Array {
  return new Float32Array(triangles.flat(2));
}

/** A binary STL file with the stored normals left as zero. */
export function toStl(triangles: Triangle[]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((corners, t) => {
    corners.flat().forEach((value, i) => view.setFloat32(84 + t * 50 + 12 + i * 4, value, true));
  });
  return bytes;
}

// a, b, c, d go round the face anticlockwise, seen from outside.
function quad(a: Point, b: Point, c: Point, d: Point): Triangle[] {
  return [
    [a, b, c],
    [a, c, d],
  ];
}

type Side = '-x' | '+x' | '-y' | '+y' | '-z' | '+z';

function boxSide(side: Side, [x0, y0, z0]: Point, [x1, y1, z1]: Point): Triangle[] {
  switch (side) {
    case '-z':
      return quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    case '+z':
      return quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    case '-y':
      return quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    case '+y':
      return quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    case '-x':
      return quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    case '+x':
      return quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  }
}

const sides: Side[] = ['-z', '+z', '-y', '+y', '-x', '+x'];

export function box(min: Point, max: Point): Triangle[] {
  return sides.flatMap((side) => boxSide(side, min, max));
}

/** A box with one side left out, or with that side turned inside out. */
export function brokenBox(min: Point, max: Point, side: Side, how: 'missing' | 'flipped'): Triangle[] {
  return sides.flatMap((s) => {
    if (s !== side) return boxSide(s, min, max);
    return how === 'missing' ? [] : boxSide(s, min, max).map(([a, b, c]): Triangle => [a, c, b]);
  });
}

export function insideOut(triangles: Triangle[]): Triangle[] {
  return triangles.map(([a, b, c]) => [a, c, b]);
}

/**
 * A solid made of grid cells. Cell (i, j, k) spans xs[i]..xs[i+1] and so on.
 * Only the sides between a filled and an empty cell become faces, so the result is one closed surface.
 */
export function cells(xs: number[], ys: number[], zs: number[], filled: (i: number, j: number, k: number) => boolean): Triangle[] {
  const isFilled = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < xs.length - 1 && j < ys.length - 1 && k < zs.length - 1 && filled(i, j, k);
  const out: Triangle[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      for (let k = 0; k < zs.length - 1; k++) {
        if (!isFilled(i, j, k)) continue;
        const min: Point = [xs[i]!, ys[j]!, zs[k]!];
        const max: Point = [xs[i + 1]!, ys[j + 1]!, zs[k + 1]!];
        const next: Record<Side, boolean> = {
          '-x': isFilled(i - 1, j, k),
          '+x': isFilled(i + 1, j, k),
          '-y': isFilled(i, j - 1, k),
          '+y': isFilled(i, j + 1, k),
          '-z': isFilled(i, j, k - 1),
          '+z': isFilled(i, j, k + 1),
        };
        for (const side of sides) if (!next[side]) out.push(...boxSide(side, min, max));
      }
    }
  }
  return out;
}

/** An outline in the XZ plane (anticlockwise, X right, Z up, convex or not), pushed along Y from 0 to depth. */
export function prism(outline: [number, number][], depth: number): Triangle[] {
  const front = outline.map(([x, z]): Point => [x, 0, z]);
  const back = outline.map(([x, z]): Point => [x, depth, z]);
  const out: Triangle[] = [];
  for (const [a, b, c] of ears(outline)) {
    out.push([front[a]!, front[b]!, front[c]!]);
    out.push([back[a]!, back[c]!, back[b]!]);
  }
  for (let i = 0; i < outline.length; i++) {
    const n = (i + 1) % outline.length;
    out.push(...quad(front[i]!, back[i]!, back[n]!, front[n]!));
  }
  return out;
}

// Cuts an anticlockwise outline into triangles, one corner at a time. For a convex outline this is a fan from the first corner.
function ears(outline: [number, number][]): [number, number, number][] {
  const left = outline.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (o: number, a: number, b: number) => {
    const [ox, oz] = outline[o]!, [ax, az] = outline[a]!, [bx, bz] = outline[b]!;
    return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);
  };
  while (left.length > 3) {
    const k = left.findIndex((b, i) => {
      if (i === 0) return false;
      const a = left[i - 1]!, c = left[(i + 1) % left.length]!;
      if (cross(a, b, c) <= 0) return false;
      return left.every((d) => d === a || d === b || d === c || cross(a, b, d) < 0 || cross(b, c, d) < 0 || cross(c, a, d) < 0);
    });
    out.push([left[k - 1]!, left[k]!, left[(k + 1) % left.length]!]);
    left.splice(k, 1);
  }
  out.push([left[0]!, left[1]!, left[2]!]);
  return out;
}

/** A wall standing on the bed, leaning `deg` degrees from vertical towards +X. */
export function leaningWall(deg: number, height = 20, thickness = 5, depth = 20): Triangle[] {
  const shift = height * Math.tan((deg * Math.PI) / 180);
  return prism(
    [
      [0, 0],
      [thickness, 0],
      [thickness + shift, height],
      [shift, height],
    ],
    depth,
  );
}

/** A globe with a single corner at each pole, so it touches the bed at one point. */
export function sphere(radius: number, segments: number, rings: number, centre: Point): Triangle[] {
  const at = (ring: number, segment: number): Point => {
    const polar = (Math.PI * ring) / rings;
    const around = (2 * Math.PI * (segment % segments)) / segments;
    const r = ring === 0 || ring === rings ? 0 : radius * Math.sin(polar);
    return [centre[0] + r * Math.cos(around), centre[1] + r * Math.sin(around), centre[2] + radius * Math.cos(polar)];
  };
  const out: Triangle[] = [];
  for (let ring = 0; ring < rings; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = at(ring, s);
      const b = at(ring + 1, s);
      const c = at(ring + 1, s + 1);
      const d = at(ring, s + 1);
      if (ring > 0) out.push([a, b, d]);
      if (ring < rings - 1) out.push([d, b, c]);
    }
  }
  return out;
}

/**
 * A square block lying on the bed, `length` long in X and `side` wide and tall, with a round hole along X.
 * segments must be a multiple of 8 so the block's corners are corners of the mesh.
 */
export function blockWithHole(length: number, side: number, holeDiameter: number, segments = 32): Triangle[] {
  const half = side / 2;
  const ring = (k: number) => {
    const angle = (2 * Math.PI * (k % segments)) / segments;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const toSquare = half / Math.max(Math.abs(c), Math.abs(s));
    return { inner: [c * holeDiameter / 2, s * holeDiameter / 2], outer: [c * toSquare, s * toSquare] };
  };
  const point = (x: number, [y, z]: number[]): Point => [x, y!, z! + half];
  const out: Triangle[] = [];
  for (let k = 0; k < segments; k++) {
    const now = ring(k);
    const next = ring(k + 1);
    out.push(...quad(point(0, now.outer), point(0, now.inner), point(0, next.inner), point(0, next.outer)));
    out.push(...quad(point(length, now.outer), point(length, next.outer), point(length, next.inner), point(length, now.inner)));
    out.push(...quad(point(0, now.outer), point(0, next.outer), point(length, next.outer), point(length, now.outer)));
    out.push(...quad(point(0, now.inner), point(length, now.inner), point(length, next.inner), point(0, next.inner)));
  }
  return out;
}

/** A deck on two pillars, `span` apart: the underside of the deck is held at both ends. */
export function bridge(span: number, pillar = 10, depth = 20, height = 20, deck = 5): Triangle[] {
  const xs = [0, pillar, pillar + span, 2 * pillar + span];
  return cells(xs, [0, depth], [0, height, height + deck], (i, _j, k) => k === 1 || i !== 1);
}

/** A T standing on its stem: a 60 x 20 x 5 mm top on a 10 mm stem, 30 mm tall. */
export function tShape(): Triangle[] {
  return cells([0, 25, 35, 60], [0, 20], [0, 30, 35], (i, _j, k) => k === 1 || i === 1);
}
