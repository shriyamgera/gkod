// Writes the test part: a 40 x 20 x 10 mm box with an 8 mm vertical through-hole
// in the middle, as a binary STL, and the same part as OBJ and 3MF. Also writes an
// overhang variant ("T" shape) used to test supports. usage: node make-stl.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));

function writeSTL(file, tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('gkod test part', 0);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a, b, c] of tris) {
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    for (const p of [n, a, b, c]) for (const x of p) { buf.writeFloatLE(x, o); o += 4; }
    o += 2;
  }
  fs.writeFileSync(file, buf);
  return tris.length;
}

// box (w x d x h) centred on XY, z from 0..h, with a round hole of radius r
function boxWithHole(w, d, h, r, seg = 64) {
  const corners = [Math.atan2(d, w), Math.atan2(d, -w), Math.atan2(-d, -w) + 2*Math.PI, Math.atan2(-d, w) + 2*Math.PI];
  const angles = [...new Set([...Array.from({ length: seg }, (_, i) => i * 2 * Math.PI / seg), ...corners])].sort((a, b) => a - b);
  const ring = angles.map(t => {
    const c = Math.cos(t), s = Math.sin(t);
    const k = Math.min(Math.abs(c) < 1e-12 ? Infinity : (w/2) / Math.abs(c), Math.abs(s) < 1e-12 ? Infinity : (d/2) / Math.abs(s));
    return { in: [r*c, r*s], out: [k*c, k*s] };
  });
  const tris = [], P = (xy, z) => [xy[0], xy[1], z];
  const quad = (a, b, c, e) => tris.push([a, b, c], [a, c, e]); // counter-clockwise seen from outside
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    quad(P(p.in, h), P(p.out, h), P(q.out, h), P(q.in, h));   // top
    quad(P(p.in, 0), P(q.in, 0), P(q.out, 0), P(p.out, 0));   // bottom
    quad(P(p.out, 0), P(q.out, 0), P(q.out, h), P(p.out, h)); // outer wall
    quad(P(p.in, 0), P(p.in, h), P(q.in, h), P(q.in, 0));     // hole wall
  }
  return tris;
}

// plain axis-aligned box from min to max corner
function box([x0, y0, z0], [x1, y1, z1]) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const f = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  return f.flatMap(([a,b,c,d]) => [[v[a],v[b],v[c]],[v[a],v[c],v[d]]]);
}

// shared-vertex form of a triangle list
function indexed(tris) {
  const map = new Map(), verts = [], faces = [];
  for (const t of tris) faces.push(t.map(p => {
    const k = p.map(x => x.toFixed(5)).join(' ');
    if (!map.has(k)) { map.set(k, verts.length); verts.push(p); }
    return map.get(k);
  }));
  return { verts, faces };
}

function writeOBJ(file, tris) {
  const { verts, faces } = indexed(tris);
  fs.writeFileSync(file, verts.map(v => `v ${v.join(' ')}`).join('\n') + '\n' + faces.map(f => `f ${f.map(i => i + 1).join(' ')}`).join('\n') + '\n');
}

// minimal zip writer (stored, no compression) so the 3MF needs no library
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), d = Buffer.from(text), crc = zlib.crc32(d);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, n, d); central.push(c, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function write3MF(file, tris) {
  const { verts, faces } = indexed(tris);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources><object id="1" type="model"><mesh>
  <vertices>${verts.map(v => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices>
  <triangles>${faces.map(f => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles>
 </mesh></object></resources>
 <build><item objectid="1"/></build>
</model>`;
  fs.writeFileSync(file, zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ['3D/3dmodel.model', model],
  ]));
}

const part = boxWithHole(40, 20, 10, 4);
const n1 = writeSTL(path.join(here, 'demo', 'part.stl'), part);
writeOBJ(path.join(here, 'demo', 'part.obj'), part);
write3MF(path.join(here, 'demo', 'part.3mf'), part);
// T shape: 10x10x10 post with a 40x10x4 slab on top -> 15 mm flat overhangs on both sides
const n2 = writeSTL(path.join(here, 'demo', 'overhang.stl'), [...box([-5,-5,0],[5,5,10]), ...box([-20,-5,10],[20,5,14])]);
console.log(`demo/part.stl (+ .obj, .3mf): ${n1} triangles, demo/overhang.stl: ${n2} triangles`);
