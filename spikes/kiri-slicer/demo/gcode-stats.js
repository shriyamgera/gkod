// Independent reading of the G-code text: layers, filament length, a simple time estimate
// (distance / feedrate, no acceleration) and the extrusion segments per layer, which is
// what a three.js layer preview needs (THREE.LineSegments per layer).
export function analyseGcode(text, { keepSegments = false } = {}) {
  let x = 0, y = 0, z = 0, e = 0, f = 1500, absE = true, absXYZ = true;
  let filament = 0, time = 0, moves = 0, extrudeMoves = 0;
  const layers = new Map(); // z -> { segments, length, coords? }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(';')[0].trim();
    if (!line) continue;
    const m = line.match(/^(G0|G1|G28|G90|G91|G92|M82|M83|G4)\b/);
    if (!m) continue;
    const a = {};
    for (const t of line.split(/\s+/).slice(1)) a[t[0]] = parseFloat(t.slice(1));
    switch (m[1]) {
      case 'G90': absXYZ = true; break;
      case 'G91': absXYZ = false; break;
      case 'M82': absE = true; break;
      case 'M83': absE = false; break;
      case 'G92': if ('E' in a) e = a.E; if ('X' in a) x = a.X; if ('Y' in a) y = a.Y; if ('Z' in a) z = a.Z; break;
      case 'G4': time += (a.P || 0) / 1000 + (a.S || 0); break;
      case 'G0': case 'G1': {
        if ('F' in a) f = a.F;
        const nx = 'X' in a ? (absXYZ ? a.X : x + a.X) : x;
        const ny = 'Y' in a ? (absXYZ ? a.Y : y + a.Y) : y;
        const nz = 'Z' in a ? (absXYZ ? a.Z : z + a.Z) : z;
        let de = 0;
        if ('E' in a) { de = absE ? a.E - e : a.E; e = absE ? a.E : e + a.E; }
        const d = Math.hypot(nx - x, ny - y, nz - z);
        if (d > 0) { time += d / (f / 60); moves++; }
        else if (de !== 0) time += Math.abs(de) / (f / 60);
        filament += de;
        if (de > 0 && d > 0) {
          extrudeMoves++;
          const key = nz.toFixed(3);
          let L = layers.get(key);
          if (!L) layers.set(key, L = { z: nz, segments: 0, length: 0, coords: keepSegments ? [] : undefined });
          L.segments++; L.length += d;
          if (keepSegments) L.coords.push(x, y, z, nx, ny, nz);
        }
        x = nx; y = ny; z = nz;
        break;
      }
    }
  }
  const list = [...layers.values()].sort((p, q) => p.z - q.z);
  return { layers: list.length, layerZ: list.map(l => l.z), filamentMM: filament, timeSecNoAccel: time,
           moves, extrudeMoves, perLayer: list };
}
