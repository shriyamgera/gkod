// Thin wrapper around the self-hosted Kiri:Moto engine build in ../kiri/ .
// sliceToGcode() takes mesh bytes + plain settings and resolves with G-code text and numbers.
import { Engine, load_data } from '../kiri/kiri-eng.js';

const KIRI = new URL('../kiri/', import.meta.url);
let devicesPromise;
export function devices() {
  return devicesPromise ||= fetch(new URL('devices.json', KIRI)).then(r => r.json()).then(d => d.fdm);
}

// Kiri ships two device formats. Old one (pre/post/cmd/settings) is used by the generic profiles.
function toDevice(d) {
  if (!d.pre) return structuredClone(d);
  return {
    gcodePre: d.pre, gcodePost: d.post,
    gcodeFan: d.cmd?.fan_power ? [d.cmd.fan_power] : [],
    originCenter: !!d.settings?.origin_center,
    extrudeAbs: !!d.settings?.extrude_abs,
    bedWidth: d.settings?.bed_width ?? 220, bedDepth: d.settings?.bed_depth ?? 220, maxHeight: d.settings?.build_height ?? 250,
    extruders: d.extruders.slice(0, 1).map(e => ({
      extFilament: e.filament, extNozzle: e.nozzle, extSelect: ['T0'], extDeselect: [], extOffsetX: 0, extOffsetY: 0 })),
  };
}

/**
 * @param {ArrayBuffer|string} data  mesh bytes (stl, 3mf) or text (obj)
 * @param {object} o  { format, printer, layerHeight, walls, infill (0..1), infillType, supports,
 *                      bed:{w,d,h}, nozzle, startGcode[], endGcode[], zones:[{fromLayer,toLayer,walls,infill}],
 *                      process:{raw Kiri process fields}, filamentDensity (g/cm3), onProgress }
 */
export async function sliceToGcode(data, o = {}) {
  const t0 = performance.now();
  const eng = new Engine({
    workURL: new URL('kiri-work.js', KIRI).href,
    poolURL: new URL('kiri-pool.js', KIRI).href,
  });
  let report = null;
  eng.setListener(msg => {
    if (msg.export?.done) report = msg.export.done;
    o.onProgress?.(msg);
  });

  // mesh -> flat Float32Array of triangle vertices
  const format = (o.format || 'stl').toLowerCase();
  if (format === 'stl') {
    await eng.parse(data);
  } else {
    const parts = await load_data(data, `part.${format}`, format);
    const total = parts.reduce((n, p) => n + p.mesh.length, 0);
    const verts = new Float32Array(total);
    let off = 0;
    for (const p of parts) { verts.set(p.mesh, off); off += p.mesh.length; }
    eng.widget.loadVertices(verts).center();
  }
  const tLoad = performance.now();

  const all = await devices();
  const dev = toDevice(all[o.printer || 'Any.Generic.Marlin']);
  if (o.bed) Object.assign(dev, { bedWidth: o.bed.w, bedDepth: o.bed.d, maxHeight: o.bed.h });
  if (o.nozzle) dev.extruders[0].extNozzle = o.nozzle;
  if (o.startGcode) dev.gcodePre = o.startGcode;
  if (o.endGcode) dev.gcodePost = o.endGcode;
  eng.setDevice(dev);

  const proc = {
    sliceHeight: o.layerHeight ?? 0.2,
    firstSliceHeight: o.layerHeight ?? 0.2,
    sliceShells: o.walls ?? 2,
    sliceFillSparse: o.infill ?? 0.2,
    sliceFillType: o.infillType ?? 'gyroid',
    sliceSupportType: o.supports ? 'automatic' : 'disabled',   // third value is 'manual' (painted in Kiri's own UI)
    // per-zone overrides: Kiri "ranges" override any process field for a span of layer numbers
    ranges: (o.zones || []).map(z => ({
      lo: z.fromLayer, hi: z.toLayer,
      fields: {
        ...(z.walls != null ? { sliceShells: z.walls } : {}),
        ...(z.infill != null ? { sliceFillSparse: z.infill } : {}),
      },
    })),
  };
  if (o.render) eng.setRender(true);      // ask the worker to also stream per-layer drawing data
  Object.assign(proc, o.process || {});   // raw Kiri process fields, e.g. { outputFillMult: 1 }
  eng.setProcess(proc);

  await eng.slice();   const tSlice = performance.now();
  await eng.prepare(); const tPrep = performance.now();
  const gcode = await eng.export(); const tExp = performance.now();

  const fil = dev.extruders[0].extFilament || 1.75;
  const lengthMM = report?.distance ?? null;
  const density = o.filamentDensity ?? 1.24; // PLA
  return {
    gcode,
    kiri: {                       // numbers reported by the slicer itself
      printTimeSec: report?.time ?? null,
      filamentMM: lengthMM,
      lines: report?.lines ?? null,
      bytes: report?.bytes ?? null,
    },
    filamentGrams: lengthMM == null ? null : Math.PI * (fil / 2) ** 2 * lengthMM / 1000 * density,
    ms: { load: tLoad - t0, slice: tSlice - tLoad, prepare: tPrep - tSlice, export: tExp - tPrep, total: tExp - t0 },
    settings: { process: proc, device: { ...dev, gcodePre: `${dev.gcodePre.length} lines`, gcodePost: `${dev.gcodePost.length} lines` } },
  };
}
