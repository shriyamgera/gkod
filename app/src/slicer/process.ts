import { PLA, printerFacts, Z_HOP_MM } from './printers';
import { INFILLS, LAYER_MM, QUALITIES, type SliceSettings } from './types';

// Thick enough top and bottom skins at either layer height.
const TOP_MM = 0.8;
const BOTTOM_MM = 0.6;

/**
 * Kiri:Moto process settings for a slice. Only our own code chooses these, inside fixed ranges:
 * PLA temperatures, grid infill at 10 to 30 percent (never gyroid, which stalls at 80 percent), no arcs.
 */
export function kiriProcess(settings: SliceSettings) {
  const { printerId, quality, infill, supports } = settings;
  const facts = printerFacts(printerId);
  if (!facts) throw new RangeError(`Unknown printer: ${printerId}`);
  if (!QUALITIES.includes(quality)) throw new RangeError(`Unknown quality: ${String(quality)}`);
  if (!INFILLS.includes(infill)) throw new RangeError(`Infill must be one of ${INFILLS.join(', ')} percent.`);
  if (typeof supports !== 'boolean') throw new RangeError('Supports must be on or off.');
  const layer = LAYER_MM[quality];
  return {
    processName: 'gkod',
    sliceHeight: layer,
    firstSliceHeight: 0.2,
    sliceShells: 3,
    sliceTopLayers: Math.ceil(TOP_MM / layer - 1e-9),
    sliceBottomLayers: Math.ceil(BOTTOM_MM / layer - 1e-9),
    sliceFillType: 'grid',
    sliceFillSparse: infill / 100,
    sliceSupportType: supports ? 'automatic' : 'disabled',
    sliceAdaptive: false,
    fdmArcEnabled: false,
    outputTemp: PLA.nozzle,
    outputBedTemp: PLA.bed,
    firstLayerNozzleTemp: 0,
    firstLayerBedTemp: 0,
    // the fan lines are ours (postprocess.ts); these only keep Kiri's own idea of the fan in step
    outputFanSpeed: 255,
    outputFanLayer: 1,
    firstLayerFanSpeed: 0,
    outputFeedrate: 50,
    outputFinishrate: 50,
    outputSeekrate: 80,
    firstLayerRate: 30,
    firstLayerFillRate: 35,
    outputRetractDist: facts.retractMm,
    outputRetractSpeed: 40,
    zHopDistance: Z_HOP_MM,
    // No skirt: Anycubic's own Kobra 2 Neo profile has none (skirt_loops 0), the purge line in the start code primes
    // the nozzle, and a part as wide as the bed still fits. Kiri's default draws two loops 2 mm outside the part.
    outputBrimCount: 0,
    firstLayerBrim: 0,
    outputRaft: false,
    outputDraftShield: false,
    outputPurgeTower: 0,
    outputLoops: 0,
    outputScarfLength: 0,
    outputInvertX: false,
    outputInvertY: false,
    ranges: [],
  };
}
