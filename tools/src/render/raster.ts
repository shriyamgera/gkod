import type { Vec3 } from './view.ts';

export type Rgb = [number, number, number];

/** A picture with a depth buffer. Points are in pixels, with depth growing towards the camera. */
export class Raster {
  readonly color: Uint8ClampedArray;
  readonly depth: Float32Array;
  /** The triangle seen at each pixel, or -1. */
  readonly face: Int32Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.color = new Uint8ClampedArray(width * height * 3);
    for (let i = 0; i < width * height; i++) this.color.set(background, i * 3);
    this.depth = new Float32Array(width * height).fill(-Infinity);
    this.face = new Int32Array(width * height).fill(-1);
  }

  /** Fills a triangle where it is nearer than what is already drawn. With a mask, it only marks the pixels it covers there. */
  triangle(a: Vec3, b: Vec3, c: Vec3, rgb: Rgb, id: number, mask?: Uint8Array): void {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(this.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    // weights of corners a and b at a pixel centre: w = (dx * px + dy * py + k) / area
    const ax = (b[1] - c[1]) / area, ay = (c[0] - b[0]) / area, ak = (b[0] * c[1] - c[0] * b[1]) / area;
    const bx = (c[1] - a[1]) / area, by = (a[0] - c[0]) / area, bk = (c[0] * a[1] - a[0] * c[1]) / area;
    const slack = -1e-7;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const wa = ax * px + ay * py + ak;
        const wb = bx * px + by * py + bk;
        const wc = 1 - wa - wb;
        if (wa < slack || wb < slack || wc < slack) continue;
        const i = y * this.width + x;
        if (mask) {
          mask[i] = 1;
          continue;
        }
        const z = wa * a[2] + wb * b[2] + wc * c[2];
        if (z <= this.depth[i]!) continue;
        this.depth[i] = z;
        this.face[i] = id;
        this.color[i * 3] = rgb[0];
        this.color[i * 3 + 1] = rgb[1];
        this.color[i * 3 + 2] = rgb[2];
      }
    }
  }

  /**
   * A line `thickness` pixels wide that does not change the depth buffer.
   * test 'pixel': each pixel shows unless a surface there is more than `slack` nearer.
   * test 'middle': the line shows where a surface around its middle is not more than `slack` nearer, so its
   * own faces never cut into it. A null slack draws it over everything.
   */
  line(a: Vec3, b: Vec3, thickness: number, rgb: Rgb, test: 'pixel' | 'middle', slack: number | null): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    const r = thickness / 2;
    const reach = Math.ceil(r) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      if (test === 'middle' && slack !== null && z + slack < this.farthestAround(x, y, reach)) continue;
      for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
        if (py < 0 || py >= this.height) continue;
        for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
          if (px < 0 || px >= this.width) continue;
          const dx = px + 0.5 - x, dy = py + 0.5 - y;
          if (dx * dx + dy * dy > r * r) continue;
          const i = py * this.width + px;
          if (test === 'pixel' && slack !== null && z + slack < this.depth[i]!) continue;
          this.color[i * 3] = rgb[0];
          this.color[i * 3 + 1] = rgb[1];
          this.color[i * 3 + 2] = rgb[2];
        }
      }
    }
  }

  private farthestAround(x: number, y: number, reach: number): number {
    let far = Infinity;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let py = cy - reach; py <= cy + reach; py++) {
      for (let px = cx - reach; px <= cx + reach; px++) {
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) return -Infinity;
        far = Math.min(far, this.depth[py * this.width + px]!);
      }
    }
    return far;
  }

  blend(i: number, rgb: Rgb, alpha: number): void {
    for (let k = 0; k < 3; k++) this.color[i * 3 + k] = this.color[i * 3 + k]! * (1 - alpha) + rgb[k]! * alpha;
  }

  /** Averages each factor x factor block into one pixel, which smooths the edges. */
  shrink(factor: number): Uint8Array {
    const w = Math.floor(this.width / factor), h = Math.floor(this.height / factor);
    const out = new Uint8Array(w * h * 3);
    const n = factor * factor;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < factor; sy++) {
          let i = ((y * factor + sy) * this.width + x * factor) * 3;
          for (let sx = 0; sx < factor; sx++, i += 3) {
            r += this.color[i]!;
            g += this.color[i + 1]!;
            b += this.color[i + 2]!;
          }
        }
        const o = (y * w + x) * 3;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
      }
    }
    return out;
  }
}
